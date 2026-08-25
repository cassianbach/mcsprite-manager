import { useEffect, useRef, useState } from 'react';
import { rescalePixels, type RescaleMode } from '../lib/canvas';
import { Button } from './Button';
import './ResizeDialog.css';

interface Props {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  onApply: (newPixels: Uint8ClampedArray, newWidth: number, newHeight: number, mode: RescaleMode) => void;
  onClose: () => void;
}

const PRESETS = [8, 16, 32, 64, 128, 256];

export function ResizeDialog({ pixels, width, height, onApply, onClose }: Props): JSX.Element {
  const [newW, setNewW] = useState(width);
  const [newH, setNewH] = useState(height);
  const [mode, setMode] = useState<RescaleMode>('nearest');
  const [keepAspect, setKeepAspect] = useState(true);
  const previewRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cvs = previewRef.current;
    if (!cvs) return;
    const previewMax = 220;
    const scale = Math.min(1, previewMax / Math.max(newW, newH));
    const cw = Math.max(1, Math.round(newW * scale));
    const ch = Math.max(1, Math.round(newH * scale));
    cvs.width = cw;
    cvs.height = ch;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = mode === 'bilinear';
    const tmp = document.createElement('canvas');
    tmp.width = width;
    tmp.height = height;
    const tctx = tmp.getContext('2d');
    if (!tctx) return;
    tctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    ctx.drawImage(tmp, 0, 0, cw, ch);
  }, [pixels, width, height, newW, newH, mode]);

  function handleWidthChange(v: number): void {
    const w = Math.max(1, Math.min(4096, v || 1));
    setNewW(w);
    if (keepAspect && width > 0) {
      setNewH(Math.max(1, Math.round((w * height) / width)));
    }
  }

  function handleHeightChange(v: number): void {
    const h = Math.max(1, Math.min(4096, v || 1));
    setNewH(h);
    if (keepAspect && height > 0) {
      setNewW(Math.max(1, Math.round((h * width) / height)));
    }
  }

  function handleApply(): void {
    if (newW === width && newH === height) {
      onClose();
      return;
    }
    const out = rescalePixels(pixels, width, height, newW, newH, mode);
    onApply(out, newW, newH, mode);
  }

  function handleKey(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter') handleApply();
  }

  return (
    <div className="resize-backdrop" onKeyDown={handleKey} tabIndex={-1}>
      <div className="resize-dialog" role="dialog" aria-label="Resize canvas">
        <h3>Resize canvas</h3>

        <div className="resize-row">
          <label htmlFor="resize-w">W</label>
          <input
            id="resize-w"
            className="resize-input"
            type="number"
            min={1}
            max={4096}
            value={newW}
            onChange={(e) => handleWidthChange(parseInt(e.target.value, 10) || 1)}
            autoFocus
          />
          <label htmlFor="resize-h">H</label>
          <input
            id="resize-h"
            className="resize-input"
            type="number"
            min={1}
            max={4096}
            value={newH}
            onChange={(e) => handleHeightChange(parseInt(e.target.value, 10) || 1)}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <input
              type="checkbox"
              checked={keepAspect}
              onChange={(e) => setKeepAspect(e.target.checked)}
            />
            Aspect
          </label>
        </div>

        <div className="resize-presets">
          {PRESETS.map((p) => (
            <button key={p} className="resize-preset" onClick={() => handleWidthChange(p)}>
              {p}
            </button>
          ))}
        </div>

        <div className="resize-mode-row">
          <button
            className={'resize-mode' + (mode === 'nearest' ? ' active' : '')}
            onClick={() => setMode('nearest')}
            title="Pixel-perfect, no smoothing"
          >
            Nearest
            <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>Pixel-perfect</div>
          </button>
          <button
            className={'resize-mode' + (mode === 'bilinear' ? ' active' : '')}
            onClick={() => setMode('bilinear')}
            title="Smooth resample"
          >
            Bilinear
            <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>Smooth</div>
          </button>
        </div>

        <div className="resize-preview">
          <canvas ref={previewRef} />
        </div>

        <div style={{ fontSize: 11, color: 'var(--fg-3)', textAlign: 'center' }}>
          {width}×{height} → {newW}×{newH}
          {newW * newH > 262144 && (
            <span style={{ color: 'var(--warning)', marginLeft: 8 }}>· Large texture</span>
          )}
        </div>

        <div className="resize-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleApply}>
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
