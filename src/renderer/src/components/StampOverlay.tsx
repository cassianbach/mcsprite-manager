import { useEffect, useRef, useState, useCallback } from 'react';

export interface StampState {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /** Position in texture pixel coords */
  x: number;
  y: number;
  /** Scale factor (1 = original) */
  scale: number;
  /** Rotation 0/90/180/270 */
  rotation: 0 | 90 | 180 | 270;
  /** Opacity 0..1 */
  opacity: number;
}

interface Props {
  stamp: StampState;
  zoom: number;
  onChange: (next: Partial<StampState>) => void;
  onCommit: () => void;
  onCancel: () => void;
}

interface DragState {
  mode: 'move' | 'resize' | 'bar';
  startX: number;
  startY: number;
  startStampX: number;
  startStampY: number;
  startScale: number;
}

export function StampOverlay({ stamp, zoom, onChange, onCommit, onCancel }: Props): JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragState = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  const displayW = stamp.width * stamp.scale;
  const displayH = stamp.height * stamp.scale;
  const W = displayW * zoom;
  const H = displayH * zoom;
  const rotateCss = stamp.rotation === 0 ? '' : `rotate(${stamp.rotation}deg)`;

  // Render the stamp onto the canvas
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    cvs.width = W;
    cvs.height = H;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;

    // Source pixels, rotated as needed
    const swap = stamp.rotation === 90 || stamp.rotation === 270;
    const srcW = swap ? stamp.height : stamp.width;
    const srcH = swap ? stamp.width : stamp.height;
    const tmp = document.createElement('canvas');
    tmp.width = srcW;
    tmp.height = srcH;
    const tctx = tmp.getContext('2d');
    if (!tctx) return;
    const img = new ImageData(new Uint8ClampedArray(stamp.pixels), stamp.width, stamp.height);
    tctx.putImageData(img, 0, 0);

    if (stamp.rotation === 0) {
      ctx.globalAlpha = stamp.opacity;
      ctx.drawImage(tmp, 0, 0, W, H);
      ctx.globalAlpha = 1;
    } else {
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate((stamp.rotation * Math.PI) / 180);
      ctx.globalAlpha = stamp.opacity;
      ctx.drawImage(tmp, -W / 2, -H / 2, W, H);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }, [stamp.pixels, stamp.width, stamp.height, stamp.scale, stamp.rotation, stamp.opacity, W, H]);

  const startDrag = useCallback(
    (mode: DragState['mode']) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      dragState.current = {
        mode,
        startX: e.clientX,
        startY: e.clientY,
        startStampX: stamp.x,
        startStampY: stamp.y,
        startScale: stamp.scale,
      };
      setDragging(true);
    },
    [stamp.x, stamp.y, stamp.scale],
  );

  function handlePointerMove(e: React.PointerEvent): void {
    const ds = dragState.current;
    if (!ds) return;
    const dxScreen = e.clientX - ds.startX;
    const dyScreen = e.clientY - ds.startY;
    const dx = dxScreen / zoom;
    const dy = dyScreen / zoom;
    if (ds.mode === 'move') {
      onChange({ x: Math.round(ds.startStampX + dx), y: Math.round(ds.startStampY + dy) });
    } else if (ds.mode === 'resize') {
      const factor = Math.max(0.1, Math.min(16, ds.startScale + (dx + dy) / 16));
      onChange({ scale: Math.round(factor * 100) / 100 });
    }
  }

  function handlePointerUp(e: React.PointerEvent): void {
    if (dragState.current) {
      dragState.current = null;
      setDragging(false);
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  // Keyboard nudges
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -1;
      else if (e.key === 'ArrowRight') dx = 1;
      else if (e.key === 'ArrowUp') dy = -1;
      else if (e.key === 'ArrowDown') dy = 1;
      if (dx || dy) {
        e.preventDefault();
        onChange({ x: stamp.x + dx, y: stamp.y + dy });
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        const next = ((stamp.rotation + 90) % 360) as 0 | 90 | 180 | 270;
        onChange({ rotation: next });
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stamp.x, stamp.y, stamp.rotation, onChange]);

  return (
    <div
      ref={overlayRef}
      className={'stamp-overlay' + (dragging ? ' dragging' : '')}
      style={{
        left: stamp.x * zoom,
        top: stamp.y * zoom,
        transform: rotateCss,
      }}
      onPointerDown={startDrag('move')}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <canvas ref={canvasRef} style={{ width: W, height: H }} />
      <div
        className="stamp-handle br"
        onPointerDown={startDrag('resize')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      <div
        className="stamp-control-bar"
        onPointerDown={startDrag('bar')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <span style={{ color: 'var(--fg-3)' }}>Size</span>
        <input
          type="range"
          min={10}
          max={400}
          value={Math.round(stamp.scale * 100)}
          onChange={(e) => onChange({ scale: parseInt(e.target.value, 10) / 100 })}
          onPointerDown={(e) => e.stopPropagation()}
        />
        <span style={{ color: 'var(--fg-3)' }}>Opacity</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(stamp.opacity * 100)}
          onChange={(e) => onChange({ opacity: parseInt(e.target.value, 10) / 100 })}
          onPointerDown={(e) => e.stopPropagation()}
        />
        <button onClick={onCancel} title="Cancel (Esc)">✕</button>
        <button className="primary" onClick={onCommit} title="Apply (Enter)">
          Apply
        </button>
      </div>
    </div>
  );
}
