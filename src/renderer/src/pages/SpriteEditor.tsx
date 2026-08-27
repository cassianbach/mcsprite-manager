import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditorUi, setTool, cycleMirror, setSecondaryColor, setGradientMode } from '../store/editor';
import type { ToolId } from '../store/editor';
import { useProject } from '../store/project';
import { CanvasViewport, type CanvasViewportHandle } from '../components/CanvasViewport';
import { ActionGlyph } from '../components/ActionGlyph';
import {
  bresenhamLine,
  clearRect,
  copyRect,
  erasePixel,
  floodFill,
  getPixel,
  gradientAlongPath,
  gradientRect,
  hexToTuple,
  mirrorRect,
  mirrorX,
  mirrorY,
  paintPixel,
  pasteRect,
  recolorPixels,
  rescalePixels,
  shadePixels,
  smushPixels,
} from '../lib/canvas';
import type { RescaleMode } from '../lib/canvas';
import { rgbaToHex, hexToRgba, rgbaToHex as rgbaToHexFull } from '../lib/color';
import { Button } from '../components/Button';
import { ColorPicker } from '../components/ColorPicker';
import { ResizeDialog } from '../components/ResizeDialog';
import { SpriteSheetDialog } from '../components/SpriteSheetDialog';
import { ShadePanel } from '../components/ShadePanel';
import { RecolorPanel } from '../components/RecolorPanel';
import { FramesPanel } from '../components/FramesPanel';
import { StampOverlay, type StampState } from '../components/StampOverlay';
import { encodeFramesToGif, encodeFramesToStripPng, downloadBytes } from '../lib/gif';
import './Editor.css';

const SPRITE_PROJECT_ID = '__sprite_default';

async function downloadSpritePng(pixels: Uint8ClampedArray, width: number, height: number): Promise<void> {
  let blob: Blob;
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(width, height);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    blob = await c.convertToBlob({ type: 'image/png' });
  } else {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    blob = await new Promise<Blob>((resolve, reject) =>
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
    );
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sprite-${width}x${height}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


interface PointerState {
  drawing: boolean;
  last: { x: number; y: number } | null;
  selMode:
    | null
    | { kind: 'new'; anchor: { x: number; y: number } }
    | { kind: 'move'; origin: { x: number; y: number }; originalRect: { x: number; y: number; w: number; h: number }; originalBackup: Uint8ClampedArray | null }
    | { kind: 'resize'; anchor: { x: number; y: number }; original: { x: number; y: number; w: number; h: number } };
}

export function SpriteEditor(): JSX.Element {
  const activeTool = useEditorUi((s) => s.activeTool);
  const brushSize = useEditorUi((s) => s.brushSize);
  const primaryColor = useEditorUi((s) => s.primaryColor);
  const secondaryColor = useEditorUi((s) => s.secondaryColor);
  const gradientMode = useEditorUi((s) => s.gradientMode);
  const [activeColor, setActiveColor] = useState<'primary' | 'secondary'>('primary');
  const zoom = useEditorUi((s) => s.zoom);
  const mirror = useEditorUi((s) => s.mirror);

  const texture = useProject((s) => s.texture);
  const loadProject = useProject((s) => s.load);
  const applyEdit = useProject((s) => s.applyEdit);
  const beginStroke = useProject((s) => s.beginStroke);
  const applyStrokeEdit = useProject((s) => s.applyStrokeEdit);
  const endStroke = useProject((s) => s.endStroke);
  const closeProject = useProject((s) => s.close);
  const resizeTexture = useProject((s) => s.resize);
  const renameTexture = useProject((s) => s.rename);

  const [size, setSize] = useState(64);
  const [resizeOpen, setResizeOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [stamp, setStamp] = useState<StampState | null>(null);
  const stampFileInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<CanvasViewportHandle>(null);

  const brushSizeRef = useRef(brushSize);
  const primaryColorRef = useRef(primaryColor);
  const secondaryColorRef = useRef(secondaryColor);
  const activeToolRef = useRef(activeTool);
  const zoomRef = useRef(zoom);
  const pointer = useRef<PointerState>({ drawing: false, last: null, selMode: null });
  const gradientPathRef = useRef<Array<{ x: number; y: number }>>([]);
  const [tick, forceTick] = useState(0);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);
  useEffect(() => {
    brushSizeRef.current = brushSize;
  }, [brushSize]);
  useEffect(() => {
    primaryColorRef.current = primaryColor;
  }, [primaryColor]);
  useEffect(() => {
    secondaryColorRef.current = secondaryColor;
  }, [secondaryColor]);
  useEffect(() => {
    if (activeTool !== 'gradient') setActiveColor('primary');
  }, [activeTool]);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Lazy create a default sprite canvas
  useEffect(() => {
    if (texture) return;
    const w = size;
    const h = size;
    const pixels = new Uint8ClampedArray(w * h * 4);
    loadProject(SPRITE_PROJECT_ID, {
      textureId: `sprite-${w}x${h}`,
      source: 'user',
      name: `Sprite ${w}x${h}`,
      path: `sprite/${w}x${h}`,
      width: w,
      height: h,
      pixels,
      base: new Uint8ClampedArray(pixels),
      modified: false,
    });
    return () => closeProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handlePointer(e: {
    type: 'down' | 'move' | 'up' | 'leave';
    pixel: { x: number; y: number };
    button: number;
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
  }): void {
    if (!texture) return;
    if (e.type === 'leave') {
      if (pointer.current.drawing) {
        pointer.current.drawing = false;
        pointer.current.last = null;
        endStroke();
      }
      pointer.current.selMode = null;
      return;
    }
    const tool = activeToolRef.current;
    const color = primaryColorRef.current;

    const mirrorMode = useEditorUi.getState().mirror;
    const w = texture.width;
    const h = texture.height;
    const applyMirror = (x: number, y: number): Array<[number, number]> => {
      const pts: Array<[number, number]> = [[x, y]];
      if (mirrorMode === 'horizontal' || mirrorMode === 'quad') pts.push([mirrorX(x, w), y]);
      if (mirrorMode === 'vertical' || mirrorMode === 'quad') pts.push([x, mirrorY(y, h)]);
      if (mirrorMode === 'quad') pts.push([mirrorX(x, w), mirrorY(y, h)]);
      return pts;
    };
    const mirrorPath = (
      path: Array<{ x: number; y: number }>,
    ): Array<Array<{ x: number; y: number }>> => {
      const variants: Array<Array<{ x: number; y: number }>> = [path];
      if (mirrorMode === 'horizontal' || mirrorMode === 'quad') {
        variants.push(path.map((p) => ({ x: mirrorX(p.x, w), y: p.y })));
      }
      if (mirrorMode === 'vertical' || mirrorMode === 'quad') {
        variants.push(path.map((p) => ({ x: p.x, y: mirrorY(p.y, h) })));
      }
      if (mirrorMode === 'quad') {
        variants.push(path.map((p) => ({ x: mirrorX(p.x, w), y: mirrorY(p.y, h) })));
      }
      return variants;
    };

    if (tool === 'pencil' || tool === 'eraser') {
      if (e.type === 'down') {
        pointer.current.drawing = true;
        pointer.current.last = e.pixel;
        beginStroke();
        const pixels = new Uint8ClampedArray(texture.current);
        const tuple = hexToTuple(color);
        let rect: { x: number; y: number; w: number; h: number } | null = null;
        for (const [px, py] of applyMirror(e.pixel.x, e.pixel.y)) {
          const r =
            tool === 'eraser'
              ? erasePixel(pixels, px, py, texture.width, texture.height, brushSizeRef.current)
              : paintPixel(pixels, px, py, texture.width, texture.height, tuple, brushSizeRef.current);
          if (r) rect = unionRect(rect, r);
        }
        if (rect) applyStrokeEdit(pixels, rect);
      } else if (e.type === 'move' && pointer.current.drawing) {
        const last = pointer.current.last ?? e.pixel;
        const basePts: Array<[number, number]> = e.shiftKey
          ? [[last.x, last.y], [e.pixel.x, e.pixel.y]]
          : bresenhamLine(last.x, last.y, e.pixel.x, e.pixel.y);
        const segments: Array<Array<[number, number]>> = [basePts];
        if (mirrorMode === 'horizontal' || mirrorMode === 'quad') {
          const a = mirrorX(last.x, w);
          const b = mirrorX(e.pixel.x, w);
          segments.push(e.shiftKey ? [[a, last.y], [b, e.pixel.y]] : bresenhamLine(a, last.y, b, e.pixel.y));
        }
        if (mirrorMode === 'vertical' || mirrorMode === 'quad') {
          const a = mirrorY(last.y, h);
          const b = mirrorY(e.pixel.y, h);
          segments.push(e.shiftKey ? [[last.x, a], [e.pixel.x, b]] : bresenhamLine(last.x, a, e.pixel.x, b));
        }
        if (mirrorMode === 'quad') {
          const a = mirrorX(last.x, w);
          const b = mirrorY(last.y, h);
          const c = mirrorX(e.pixel.x, w);
          const d = mirrorY(e.pixel.y, h);
          segments.push(e.shiftKey ? [[a, b], [c, d]] : bresenhamLine(a, b, c, d));
        }
        let combined: { x: number; y: number; w: number; h: number } | null = null;
        const pixels = new Uint8ClampedArray(texture.current);
        const tuple = hexToTuple(color);
        for (const seg of segments) {
          for (const point of seg) {
            const r =
              tool === 'eraser'
                ? erasePixel(pixels, point[0], point[1], texture.width, texture.height, brushSizeRef.current)
                : paintPixel(pixels, point[0], point[1], texture.width, texture.height, tuple, brushSizeRef.current);
            if (r) combined = unionRect(combined, r);
          }
        }
        pointer.current.last = e.pixel;
        if (combined) applyStrokeEdit(pixels, combined);
      } else if (e.type === 'up') {
        pointer.current.drawing = false;
        pointer.current.last = null;
        endStroke();
      }
    } else if (tool === 'fill') {
      if (e.type === 'down') {
        const pixels = new Uint8ClampedArray(texture.current);
        const tuple = hexToTuple(color);
        let combined: { x: number; y: number; w: number; h: number } | null = null;
        for (const [px, py] of applyMirror(e.pixel.x, e.pixel.y)) {
          const r = floodFill(pixels, texture.width, texture.height, px, py, tuple);
          if (r) combined = unionRect(combined, r);
        }
        if (combined) applyEdit(pixels, combined);
      }
    } else if (tool === 'shade') {
      if (e.type === 'down') {
        pointer.current.drawing = true;
        pointer.current.last = e.pixel;
        beginStroke();
        const pixels = new Uint8ClampedArray(texture.current);
        const ui = useEditorUi.getState();
        const tint = hexToTuple(ui.primaryColor);
        const rect = shadePixels(
          pixels,
          texture.width,
          texture.height,
          e.pixel.x,
          e.pixel.y,
          brushSizeRef.current,
          ui.shadeMode,
          ui.shadeMode === 'fade' ? Math.max(1, Math.round(ui.shadeStrength * 2.55)) : ui.shadeStrength,
          tint,
        );
        if (rect) applyStrokeEdit(pixels, rect);
      } else if (e.type === 'move' && pointer.current.drawing) {
        const last = pointer.current.last ?? e.pixel;
        const linePts = e.shiftKey
          ? [[last.x, last.y], [e.pixel.x, e.pixel.y]] as Array<[number, number]>
          : bresenhamLine(last.x, last.y, e.pixel.x, e.pixel.y);
        const pixels = new Uint8ClampedArray(texture.current);
        const ui = useEditorUi.getState();
        const tint = hexToTuple(ui.primaryColor);
        let combined: { x: number; y: number; w: number; h: number } | null = null;
        for (const [px, py] of linePts) {
          const r = shadePixels(
            pixels,
            texture.width,
            texture.height,
            px,
            py,
            brushSizeRef.current,
            ui.shadeMode,
            ui.shadeMode === 'fade' ? Math.max(1, Math.round(ui.shadeStrength * 2.55)) : ui.shadeStrength,
            tint,
          );
          if (r) combined = unionRect(combined, r);
        }
        pointer.current.last = e.pixel;
        if (combined) applyStrokeEdit(pixels, combined);
      } else if (e.type === 'up') {
        pointer.current.drawing = false;
        pointer.current.last = null;
        endStroke();
      }
    } else if (tool === 'gradient') {
      if (e.type === 'down') {
        gradientPathRef.current = [e.pixel];
        pointer.current.drawing = true;
      } else if (e.type === 'move' && pointer.current.drawing) {
        const path = gradientPathRef.current;
        const last = path[path.length - 1];
        if (!last || last.x !== e.pixel.x || last.y !== e.pixel.y) {
          path.push(e.pixel);
          forceTick((n) => n + 1);
        }
      } else if (e.type === 'up' && pointer.current.drawing) {
        pointer.current.drawing = false;
        const ui = useEditorUi.getState();
        const from = hexToTuple(primaryColorRef.current);
        const to = hexToTuple(secondaryColorRef.current);

        if (ui.gradientMode === 'rectangle') {
          const sel = texture.selection;
          if (!sel) return;
          const pixels = new Uint8ClampedArray(texture.current);
          const axis = sel.w > sel.h ? 'horizontal' : 'vertical';
          let combined: { x: number; y: number; w: number; h: number } | null = null;
          for (const r of mirrorRect(sel, ui.mirror, texture.width, texture.height)) {
            const rr = gradientRect(pixels, texture.width, texture.height, r, from, to, axis);
            combined = unionRect(combined, rr);
          }
          if (combined) applyEdit(pixels, combined);
          return;
        }

        const path = gradientPathRef.current;
        gradientPathRef.current = [];
        if (path.length < 2) return;
        const pixels = new Uint8ClampedArray(texture.current);
        const selRect = texture.selection ?? undefined;
        const thickness = brushSizeRef.current;
        let combined: { x: number; y: number; w: number; h: number } | null = null;
        for (const vp of mirrorPath(path)) {
          const r = gradientAlongPath(pixels, texture.width, texture.height, vp, from, to, selRect, thickness);
          if (r) combined = unionRect(combined, r);
        }
        if (combined) applyEdit(pixels, combined);
      }
    } else if (tool === 'smush') {
      if (e.type === 'down') {
        pointer.current.drawing = true;
        pointer.current.last = e.pixel;
        beginStroke();
        const pixels = new Uint8ClampedArray(texture.current);
        let combined: { x: number; y: number; w: number; h: number } | null = null;
        for (const [px, py] of applyMirror(e.pixel.x, e.pixel.y)) {
          const r = smushPixels(pixels, texture.width, texture.height, px, py, brushSizeRef.current, 0.6);
          if (r) combined = unionRect(combined, r);
        }
        if (combined) applyStrokeEdit(pixels, combined);
      } else if (e.type === 'move' && pointer.current.drawing) {
        const last = pointer.current.last ?? e.pixel;
        const linePts = e.shiftKey
          ? ([[last.x, last.y], [e.pixel.x, e.pixel.y]] as Array<[number, number]>)
          : bresenhamLine(last.x, last.y, e.pixel.x, e.pixel.y);
        const pixels = new Uint8ClampedArray(texture.current);
        let combined: { x: number; y: number; w: number; h: number } | null = null;
        for (const vp of mirrorPath(linePts.map((p) => ({ x: p[0], y: p[1] })))) {
          for (const pt of vp) {
            const r = smushPixels(pixels, texture.width, texture.height, pt.x, pt.y, brushSizeRef.current, 0.6);
            if (r) combined = unionRect(combined, r);
          }
        }
        pointer.current.last = e.pixel;
        if (combined) applyStrokeEdit(pixels, combined);
      } else if (e.type === 'up') {
        pointer.current.drawing = false;
        pointer.current.last = null;
        endStroke();
      }
    } else if (tool === 'eyedropper') {
      if (e.type === 'down') {
        const px = getPixel(texture.current, e.pixel.x, e.pixel.y, texture.width);
        useEditorUi.setState({ primaryColor: rgbaToHex({ r: px[0], g: px[1], b: px[2], a: px[3] }) });
      }
    } else if (tool === 'select') {
      const sel = texture.selection;
      if (e.type === 'down') {
        pointer.current.selMode = { kind: 'new', anchor: { ...e.pixel } };
        useProject.getState().setSelection({ x: e.pixel.x, y: e.pixel.y, w: 1, h: 1 });
      } else if (e.type === 'move' && pointer.current.selMode?.kind === 'new') {
        const m = pointer.current.selMode;
        const x0 = Math.min(m.anchor.x, e.pixel.x);
        const y0 = Math.min(m.anchor.y, e.pixel.y);
        const x1 = Math.max(m.anchor.x, e.pixel.x);
        const y1 = Math.max(m.anchor.y, e.pixel.y);
        useProject.getState().setSelection({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
      } else if (e.type === 'up') {
        pointer.current.selMode = null;
      }
    }
  }

  const drawOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, scale: number) => {
      if (activeToolRef.current === 'gradient' && gradientPathRef.current.length > 0) {
        const path = gradientPathRef.current;
        ctx.strokeStyle = 'rgba(108, 240, 214, 0.95)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(path[0].x * scale + scale / 2, path[0].y * scale + scale / 2);
        for (let i = 1; i < path.length; i++) {
          ctx.lineTo(path[i].x * scale + scale / 2, path[i].y * scale + scale / 2);
        }
        ctx.stroke();
      }
      const sel = texture?.selection;
      if (!sel) return;
      const x = sel.x * scale;
      const y = sel.y * scale;
      const w = sel.w * scale;
      const h = sel.h * scale;
      ctx.strokeStyle = 'rgba(108, 240, 214, 0.95)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.setLineDash([]);
      const handleR = Math.max(4, Math.min(8, 8 / Math.max(scale, 0.01)));
      const half = handleR / 2;
      const handles: Array<[number, number]> = [
        [sel.x, sel.y],
        [sel.x + sel.w - 1, sel.y],
        [sel.x, sel.y + sel.h - 1],
        [sel.x + sel.w - 1, sel.y + sel.h - 1],
      ];
      ctx.fillStyle = '#6cf0d6';
      ctx.strokeStyle = '#0b0d10';
      ctx.lineWidth = 1;
      for (const [hx, hy] of handles) {
        const px = hx * scale - half;
        const py = hy * scale - half;
        ctx.fillRect(px, py, handleR, handleR);
        ctx.strokeRect(px + 0.5, py + 0.5, handleR - 1, handleR - 1);
      }
    },
    [texture, tick],
  );

  function resizeSpriteTo(newW: number, newH: number): void {
    if (texture && newW === texture.width && newH === texture.height) return;
    const pixels = new Uint8ClampedArray(newW * newH * 4);
    if (texture) {
      // Copy existing content into the new buffer (top-left), preserving what fits
      for (let y = 0; y < Math.min(texture.height, newH); y++) {
        for (let x = 0; x < Math.min(texture.width, newW); x++) {
          const si = (y * texture.width + x) * 4;
          const di = (y * newW + x) * 4;
          pixels[di] = texture.current[si];
          pixels[di + 1] = texture.current[si + 1];
          pixels[di + 2] = texture.current[si + 2];
          pixels[di + 3] = texture.current[si + 3];
        }
      }
    }
    loadProject(SPRITE_PROJECT_ID, {
      textureId: `sprite-${newW}x${newH}`,
      source: 'user',
      name: `Sprite ${newW}x${newH}`,
      path: `sprite/${newW}x${newH}`,
      width: newW,
      height: newH,
      pixels,
      base: new Uint8ClampedArray(pixels),
      modified: false,
    });
  }

  async function loadStampFile(file: File): Promise<void> {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height);
      setStamp({
        pixels: new Uint8ClampedArray(data.data),
        width: img.width,
        height: img.height,
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 1,
      });
      setTool('stamp');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function rotateStamp(s: StampState): { pixels: Uint8ClampedArray; width: number; height: number } | null {
    if (s.rotation === 0) return { pixels: s.pixels, width: s.width, height: s.height };
    const c = document.createElement('canvas');
    const swap = s.rotation === 90 || s.rotation === 270;
    c.width = swap ? s.height : s.width;
    c.height = swap ? s.width : s.height;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((s.rotation * Math.PI) / 180);
    const tmp = document.createElement('canvas');
    tmp.width = s.width;
    tmp.height = s.height;
    const tctx = tmp.getContext('2d');
    if (!tctx) return null;
    tctx.putImageData(new ImageData(new Uint8ClampedArray(s.pixels), s.width, s.height), 0, 0);
    ctx.drawImage(tmp, -s.width / 2, -s.height / 2);
    const out = ctx.getImageData(0, 0, c.width, c.height);
    return { pixels: new Uint8ClampedArray(out.data), width: c.width, height: c.height };
  }

  function applyStampOpacity(
    pixels: Uint8ClampedArray,
    opacity: number,
  ): Uint8ClampedArray {
    if (opacity >= 1) return pixels;
    const out = new Uint8ClampedArray(pixels);
    for (let i = 3; i < out.length; i += 4) {
      out[i] = Math.round(out[i] * opacity);
    }
    return out;
  }

  return (
    <div className="editor-shell">
      <div className="toolbar">
        <div className="toolbar-group">
          {(['pencil', 'eraser', 'fill', 'eyedropper', 'select', 'shade', 'recolor', 'stamp', 'gradient', 'smush'] as const).map(
            (t) => (
              <button
                key={t}
                className={'tool-btn' + (activeTool === t ? ' active' : '')}
                onClick={() => setTool(t)}
                aria-label={t}
                title={t}
                data-tooltip={t}
              >
                <span style={{ textTransform: 'capitalize', fontSize: 11 }}>{t.slice(0, 4)}</span>
              </button>
            ),
          )}
        </div>
        <div className="toolbar-spacer" />
        <div className="toolbar-group">
          <button
            className={'tool-btn' + (mirror !== 'none' ? ' active' : '')}
            title={`Mirror: ${mirror}`}
            data-tooltip={`Mirror: ${mirror}`}
            onClick={() => cycleMirror()}
          >
            <span style={{ fontSize: 11 }}>Mir</span>
          </button>
        </div>
        <div className="toolbar-spacer" />
        <div className="toolbar-group">
          <button
            className="tool-btn"
            title="Rotate 90° CW"
            data-tooltip="Rotate 90° CW"
            onClick={() => useProject.getState().transform('rotate-cw')}
            disabled={!texture}
          >
            <ActionGlyph name="rotate-cw" />
          </button>
          <button
            className="tool-btn"
            title="Rotate 90° CCW"
            data-tooltip="Rotate 90° CCW"
            onClick={() => useProject.getState().transform('rotate-ccw')}
            disabled={!texture}
          >
            <ActionGlyph name="rotate-ccw" />
          </button>
          <button
            className="tool-btn"
            title="Rotate 180°"
            data-tooltip="Rotate 180°"
            onClick={() => useProject.getState().transform('rotate-180')}
            disabled={!texture}
          >
            <ActionGlyph name="rotate-180" />
          </button>
          <button
            className="tool-btn"
            title="Flip horizontal"
            data-tooltip="Flip horizontal"
            onClick={() => useProject.getState().transform('flip-h')}
            disabled={!texture}
          >
            <ActionGlyph name="flip-h" />
          </button>
          <button
            className="tool-btn"
            title="Flip vertical"
            data-tooltip="Flip vertical"
            onClick={() => useProject.getState().transform('flip-v')}
            disabled={!texture}
          >
            <ActionGlyph name="flip-v" />
          </button>
        </div>
        <div className="toolbar-spacer" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          Size
          <input
            className="brush-input"
            type="number"
            min={8}
            max={512}
            value={size}
            onChange={(e) => setSize(parseInt(e.target.value, 10) || 64)}
          />
          <Button variant="ghost" onClick={() => resizeSpriteTo(size, size)}>
            Apply
          </Button>
          <Button variant="ghost" onClick={() => setResizeOpen(true)} disabled={!texture}>
            Resize
          </Button>
        </label>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Button variant="ghost" onClick={() => setSheetOpen(true)} disabled={!texture}>
            Sprite Sheet
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!texture) return;
              void downloadSpritePng(texture.current, texture.width, texture.height);
            }}
          >
            Save PNG
          </Button>
        </div>
      </div>
      <div className="canvas-area">
        {texture && <CanvasViewport ref={viewportRef} onPointer={handlePointer} overlay={drawOverlay} />}
        {texture && stamp && activeTool === 'stamp' && (
          <StampOverlay
            stamp={stamp}
            zoom={zoom}
            onChange={(next) => setStamp((s) => (s ? { ...s, ...next } : s))}
            onCommit={() => {
              const rotated = rotateStamp(stamp);
              if (rotated) {
                const pixels = new Uint8ClampedArray(texture.current);
                const scaledW = Math.round(rotated.width * stamp.scale);
                const scaledH = Math.round(rotated.height * stamp.scale);
                const scaled =
                  scaledW === rotated.width && scaledH === rotated.height
                    ? rotated.pixels
                    : rescalePixels(rotated.pixels, rotated.width, rotated.height, scaledW, scaledH, 'nearest');
                const tinted = applyStampOpacity(scaled, stamp.opacity);
                const rect = pasteRect(pixels, texture.width, texture.height, tinted, scaledW, scaledH, stamp.x, stamp.y);
                if (rect) applyEdit(pixels, rect);
              }
              setStamp(null);
            }}
            onCancel={() => setStamp(null)}
          />
        )}
      </div>
      <aside className="side">
        <div className="panel">
          <h4 className="panel-title">Color</h4>
          {activeTool === 'gradient' && (
            <>
              <div className="gradient-mode-row">
                <span className="panel-title-sm">Gradient mode</span>
                <div className="seg">
                  <button
                    className={gradientMode === 'curve' ? 'active' : ''}
                    onClick={() => setGradientMode('curve')}
                  >
                    Curve
                  </button>
                  <button
                    className={gradientMode === 'rectangle' ? 'active' : ''}
                    onClick={() => setGradientMode('rectangle')}
                  >
                    Rectangle
                  </button>
                </div>
              </div>
              <div className="secondary-color-row">
                <button
                  className="secondary-color-block"
                  style={{ background: primaryColor }}
                  data-tooltip="Primary color"
                  onClick={() => setActiveColor('primary')}
                />
                <button
                  className="secondary-swap"
                  data-tooltip="Swap colors"
                  onClick={() => {
                    const p = primaryColor;
                    useEditorUi.setState({ primaryColor: secondaryColor });
                    setSecondaryColor(p);
                  }}
                >
                  ⇄
                </button>
                <button
                  className="secondary-color-block"
                  style={{ background: secondaryColor }}
                  data-tooltip="Secondary color"
                  onClick={() => setActiveColor('secondary')}
                />
              </div>
            </>
          )}
          <ColorPicker
            value={activeColor === 'primary' ? primaryColor : secondaryColor}
            onChange={(hex) =>
              useEditorUi.setState(activeColor === 'primary' ? { primaryColor: hex } : { secondaryColor: hex })
            }
            onCommit={(hex) => {
              const rgba = hexToRgba(hex);
              const finalHex = rgba.a === 255 ? hex : rgbaToHexFull({ ...rgba, a: rgba.a });
              useEditorUi.setState(
                activeColor === 'primary' ? { primaryColor: finalHex } : { secondaryColor: finalHex },
              );
            }}
          />
          <div className="brush-size-row">
            <input
              className="brush-input"
              type="number"
              min={1}
              max={64}
              value={brushSize}
              onChange={(e) => useEditorUi.setState({ brushSize: parseInt(e.target.value, 10) || 1 })}
            />
            <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>brush</span>
          </div>
        </div>

        {activeTool === 'shade' && (
          <div className="panel">
            <h4 className="panel-title">Shade</h4>
            <ShadePanel />
          </div>
        )}

        {activeTool === 'recolor' && texture && (
          <div className="panel">
            <h4 className="panel-title">Recolor</h4>
            <RecolorPanel
              onApply={() => {
                const opts = useEditorUi.getState().recolor;
                const next = recolorPixels(texture.current, texture.width, texture.height, opts);
                const rect = { x: 0, y: 0, w: texture.width, h: texture.height };
                applyEdit(next, rect);
                useEditorUi.setState((s) => {
                  s.recolor = { hue: 0, saturation: 0, brightness: 0, contrast: 0, invert: false, grayscale: false };
                });
              }}
            />
          </div>
        )}

        {activeTool === 'stamp' && (
          <div className="panel">
            <h4 className="panel-title">Stamp</h4>
            <div className="stamp-upload-row">
              <p style={{ margin: 0, fontSize: 11 }}>Drop a PNG to stamp onto the canvas.</p>
              <button className="stamp-upload-btn" onClick={() => stampFileInputRef.current?.click()}>
                Choose PNG…
              </button>
              <input
                ref={stampFileInputRef}
                type="file"
                accept="image/png"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadStampFile(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        )}

        <div className="panel">
          <h4 className="panel-title">Animation</h4>
          <FramesPanel
            onExportGif={async () => {
              if (!texture?.animation) return;
              const outScale = Math.max(1, Math.round(window.devicePixelRatio));
              const gif = await encodeFramesToGif(
                texture.animation.frames.map((f) => ({
                  pixels: f.pixels,
                  width: texture.width,
                  height: texture.height,
                  tickDuration: f.tickDuration,
                })),
                { outScale },
              );
              await downloadBytes(gif, `${texture.name || 'sprite'}.gif`, 'image/gif');
            }}
            onExportStrip={async () => {
              if (!texture?.animation) return;
              const png = await encodeFramesToStripPng(
                texture.animation.frames.map((f) => ({
                  pixels: f.pixels,
                  width: texture.width,
                  height: texture.height,
                  tickDuration: f.tickDuration,
                })),
              );
              await downloadBytes(png, `${texture.name || 'sprite'}.png`, 'image/png');
            }}
          />
        </div>

        <div className="panel">
          <h4 className="panel-title">Sprite</h4>
          <p style={{ fontSize: 12, color: 'var(--fg-2)', margin: '0 0 8px 0' }}>
            {texture ? `${texture.width}×${texture.height}` : 'No sprite'}
          </p>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <Button
              variant="ghost"
              onClick={() => {
                if (!texture) return;
                setRenameValue(texture.name.startsWith('Sprite') ? '' : texture.name);
                setRenaming(true);
              }}
            >
              Rename
            </Button>
          </div>
          {renaming && texture && (
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                className="color-input"
                style={{ background: 'var(--bg-1)', flex: 1, padding: '4px 6px', fontSize: 12 }}
                value={renameValue}
                placeholder="Sprite name"
                autoFocus
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    renameTexture(renameValue || texture.name);
                    setRenaming(false);
                  }
                  if (e.key === 'Escape') setRenaming(false);
                }}
              />
              <button
                onClick={() => {
                  renameTexture(renameValue || texture.name);
                  setRenaming(false);
                }}
                style={{
                  padding: '4px 8px',
                  borderRadius: 4,
                  background: 'var(--accent)',
                  color: 'var(--accent-fg)',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                Save
              </button>
            </div>
          )}
        </div>
      </aside>
      <div className="statusbar">
        <span>
          Sprite mode · {texture ? `${texture.width}×${texture.height}` : '—'} · {zoom}x
        </span>
        <span>{useEditorUi.getState().mirror === 'none' ? '' : `Mirror: ${useEditorUi.getState().mirror}`}</span>
      </div>

      {resizeOpen && texture && (
        <ResizeDialog
          pixels={texture.current}
          width={texture.width}
          height={texture.height}
          onApply={(newPixels, newWidth, newHeight, _mode: RescaleMode) => {
            resizeTexture(newPixels, newWidth, newHeight);
            setResizeOpen(false);
          }}
          onClose={() => setResizeOpen(false)}
        />
      )}

      {sheetOpen && texture && (
        <SpriteSheetDialog
          projectId={SPRITE_PROJECT_ID}
          activeTexture={{
            id: texture.id,
            name: texture.name,
            width: texture.width,
            height: texture.height,
            current: texture.current,
            animation: texture.animation,
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}



function unionRect(
  a: { x: number; y: number; w: number; h: number } | null,
  b: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: x1 - x, h: y1 - y };
}
