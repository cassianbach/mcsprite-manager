import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useProject } from '../store/project';
import { useEditorUi, setZoom } from '../store/editor';
import './CanvasViewport.css';

export interface CanvasViewportHandle {
  /** Returns the texture-pixel coords (x,y) under the given mouse event. Null if outside canvas. */
  pickPixel: (e: { clientX: number; clientY: number }) => { x: number; y: number } | null;
  /** Imperative render trigger (e.g. after a programmatic pixel change). */
  repaint: () => void;
  /** Compute a zoom that fits the texture inside the viewport, and apply it. */
  fitToScreen: () => void;
  /** Reset zoom to a sensible default (8x). */
  resetZoom: () => void;
}

interface Props {
  onPointer: (e: {
    type: 'down' | 'move' | 'up' | 'leave';
    pixel: { x: number; y: number };
    button: number;
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
  }) => void;
  /** Optional overlay layer (selection rect, brush preview). */
  overlay?: (ctx: CanvasRenderingContext2D, scale: number) => void;
}

export const CanvasViewport = forwardRef<CanvasViewportHandle, Props>(function CanvasViewport(
  { onPointer, overlay },
  ref,
) {
  // Conservative upper bound for a single canvas dimension that is safe across
  // Chromium, Gecko, and WebKit. Beyond this, the browser silently fails to
  // allocate the backing store and the canvas renders as a blank/white area
  // (the "white flash" bug), which is also what made the drawn texture appear
  // to "scroll away" — the pixels were there in the buffer but the canvas
  // never received them.
  const MAX_CANVAS_DIM = 16384;

  const texture = useProject((s) => s.texture);
  const zoom = useEditorUi((s) => s.zoom);
  const showGrid = useEditorUi((s) => s.showGrid);
  const activeTool = useEditorUi((s) => s.activeTool);

  const containerRef = useRef<HTMLDivElement>(null);
  const pixelsRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [panning, setPanning] = useState(false);
  const panState = useRef<{ startX: number; startY: number; scrollX: number; scrollY: number } | null>(null);

  // Maximum zoom that keeps the canvas backing store within browser limits.
  const w = texture ? texture.width : 0;
  // `texture.height` is already the per-frame height (frameHeight); the full
  // strip is width × (height × frameCount). Don't divide again.
  const h = texture ? texture.height : 0;
  const maxZoomFor = (texW: number, texH: number): number => {
    if (texW <= 0 || texH <= 0) return 64;
    const m = Math.max(texW, texH);
    return Math.max(1, Math.floor(MAX_CANVAS_DIM / m));
  };

  const scale = Math.max(1, Math.min(zoom, maxZoomFor(w, h)));
  // Animated textures store the full strip in `width` x `height`, but
  // `current` holds only the active frame. Display at frame dimensions so the
  // canvas size and the pixel buffer always agree (otherwise repaint throws and
  // the canvas flashes black).
  const animFrames = texture?.animation?.frames.length ?? 0;

  // Resize canvases when texture or zoom changes
  useEffect(() => {
    const px = pixelsRef.current;
    const gr = gridRef.current;
    const ov = overlayRef.current;
    if (!px || !gr || !ov) return;
    // Hard cap the backing-store dimensions at MAX_CANVAS_DIM as a safety net,
    // even though `scale` is already clamped. This guarantees the canvas
    // never silently fails to allocate (which would render as a blank/white
    // area — the "white flash" / "scrolls away" bug).
    const cssW = w * scale;
    const cssH = h * scale;
    px.width = cssW;
    px.height = cssH;
    gr.width = cssW;
    gr.height = cssH;
    ov.width = cssW;
    ov.height = cssH;
    repaint();
  }, [w, h, scale]);

  // Repaint pixels layer
  const repaint = useCallback(() => {
    const px = pixelsRef.current;
    if (!px || !texture) return;
    const ctx = px.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    // Build the source image first so we never clear the canvas without a
    // successful redraw (a throw after clearRect would flash it black).
    const expected = w * h * 4;
    if (texture.current.length !== expected) return;
    const img = new ImageData(new Uint8ClampedArray(texture.current), w, h);
    // We need to scale manually since canvas has w*scale dimensions
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const tctx = tmp.getContext('2d');
    if (!tctx) return;
    tctx.putImageData(img, 0, 0);
    ctx.clearRect(0, 0, px.width, px.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, px.width, px.height);

    // Grid
    const gr = gridRef.current;
    if (gr) {
      const gctx = gr.getContext('2d');
      if (gctx) {
        gctx.clearRect(0, 0, gr.width, gr.height);
        if (showGrid && scale >= 4) {
          gctx.strokeStyle = 'rgba(128,128,128,0.35)';
          gctx.lineWidth = 1;
          for (let x = 0; x <= w; x++) {
            gctx.beginPath();
            gctx.moveTo(x * scale + 0.5, 0);
            gctx.lineTo(x * scale + 0.5, gr.height);
            gctx.stroke();
          }
          for (let y = 0; y <= h; y++) {
            gctx.beginPath();
            gctx.moveTo(0, y * scale + 0.5);
            gctx.lineTo(gr.width, y * scale + 0.5);
            gctx.stroke();
          }
        }
      }
    }

    // Overlay
    const ov = overlayRef.current;
    if (ov) {
      const octx = ov.getContext('2d');
      if (octx) {
        octx.clearRect(0, 0, ov.width, ov.height);
        overlay?.(octx, scale);
      }
    }
  }, [texture, scale, showGrid, overlay]);

  useImperativeHandle(ref, () => ({
    pickPixel: (e) => {
      const px = pixelsRef.current;
      if (!px) return null;
      const rect = px.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / scale);
      const y = Math.floor((e.clientY - rect.top) / scale);
      if (x < 0 || y < 0 || x >= w || y >= h) return null;
      return { x, y };
    },
    fitToScreen: () => {
      const el = containerRef.current;
      if (!el || w === 0 || h === 0) return;
      const padding = 32;
      const cw = el.clientWidth - padding;
      const ch = el.clientHeight - padding;
      if (cw <= 0 || ch <= 0) return;
      const fitZ = Math.max(1, Math.floor(Math.min(cw / w, ch / h)));
      setZoom(Math.min(fitZ, maxZoomFor(w, h)));
    },
    resetZoom: () => setZoom(Math.min(8, maxZoomFor(w, h))),
    repaint,
  }));

  // Repaint when the pixel buffer or selection changes. (Avoiding a dependency
  // on the whole `texture` object prevents a repaint on every store update,
  // e.g. autosave status changes, which previously caused a black flash.)
  useEffect(() => {
    repaint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texture?.current, texture?.selection]);

  function eventToPixel(e: React.PointerEvent): { x: number; y: number } | null {
    const px = pixelsRef.current;
    if (!px) return null;
    const rect = px.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / scale);
    const y = Math.floor((e.clientY - rect.top) / scale);
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    return { x, y };
  }

  function handlePointerDown(e: React.PointerEvent): void {
    const px = pixelsRef.current;
    if (!px) return;
    px.setPointerCapture(e.pointerId);

    // Right-click pan (or middle-click) always pans regardless of tool
    if (e.button === 2 || e.button === 1) {
      e.preventDefault();
      setPanning(true);
      const el = containerRef.current;
      if (el) {
        panState.current = {
          startX: e.clientX,
          startY: e.clientY,
          scrollX: el.scrollLeft,
          scrollY: el.scrollTop,
        };
      }
      return;
    }

    // Hand tool: pan
    if (activeTool === 'hand') {
      setPanning(true);
      const el = containerRef.current;
      if (el) {
        panState.current = {
          startX: e.clientX,
          startY: e.clientY,
          scrollX: el.scrollLeft,
          scrollY: el.scrollTop,
        };
      }
      return;
    }

    const pixel = eventToPixel(e);
    if (!pixel) return;
    onPointer({
      type: 'down',
      pixel,
      button: e.button,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
    });
  }

  function handlePointerMove(e: React.PointerEvent): void {
    if (panning && panState.current && containerRef.current) {
      const dx = e.clientX - panState.current.startX;
      const dy = e.clientY - panState.current.startY;
      containerRef.current.scrollLeft = panState.current.scrollX - dx;
      containerRef.current.scrollTop = panState.current.scrollY - dy;
      return;
    }
    const pixel = eventToPixel(e);
    if (!pixel) return;
    onPointer({
      type: e.buttons === 0 ? 'leave' : 'move',
      pixel,
      button: e.button,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
    });
  }

  function handlePointerUp(e: React.PointerEvent): void {
    if (panning) {
      setPanning(false);
      panState.current = null;
      return;
    }
    const pixel = eventToPixel(e);
    if (!pixel) return;
    onPointer({
      type: 'up',
      pixel,
      button: e.button,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
    });
  }

  function handlePointerLeave(e: React.PointerEvent): void {
    if (panning) {
      setPanning(false);
      panState.current = null;
      return;
    }
    onPointer({
      type: 'leave',
      pixel: { x: -1, y: -1 },
      button: e.button,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
    });
  }

  function handleWheel(e: React.WheelEvent): void {
    e.preventDefault();
    if (e.deltaY === 0) return;
    const dir = e.deltaY > 0 ? -1 : 1;
    const step = Math.max(1, Math.floor(zoom / 4));
    // Clamp to the maximum zoom that keeps the canvas backing store within
    // browser limits. This prevents the "white flash / scrolls away" bug
    // when zooming too far into a large texture.
    const cap = maxZoomFor(w, h);
    setZoom(Math.max(1, Math.min(cap, zoom + dir * step)));
  }

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault();
  }

  const cursorClass = panning
    ? 'cursor-hand-grabbing'
    : activeTool === 'hand'
      ? 'cursor-hand'
      : 'cursor-crosshair';

  if (!texture) {
    return <div className="viewport cursor-crosshair" />;
  }

  return (
    <div
      ref={containerRef}
      className={`viewport ${cursorClass}`}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onWheel={handleWheel}
    >
      <div
        className="canvas-stack"
        style={{ width: w * scale, height: h * scale }}
      >
        <canvas ref={pixelsRef} className="pixels" style={{ width: w * scale, height: h * scale }} />
        <canvas ref={gridRef} className="grid" style={{ width: w * scale, height: h * scale }} />
        <canvas ref={overlayRef} className="overlay" style={{ width: w * scale, height: h * scale }} />
      </div>
    </div>
  );
});
