import { useEffect, useRef, useState } from 'react';
import { useProject } from '../store/project';
import { Button } from './Button';
import './FramesPanel.css';

interface Props {
  onExportGif: () => void;
  onExportStrip: () => void;
}

export function FramesPanel({ onExportGif, onExportStrip }: Props): JSX.Element {
  const texture = useProject((s) => s.texture);
  const addFrame = useProject((s) => s.addFrame);
  const duplicateFrame = useProject((s) => s.duplicateFrame);
  const deleteFrame = useProject((s) => s.deleteFrame);
  const setActiveFrame = useProject((s) => s.setActiveFrame);
  const setFrameTickDuration = useProject((s) => s.setFrameTickDuration);
  const setInterpolate = useProject((s) => s.setInterpolate);
  const setDefaultFrameTicks = useProject((s) => s.setDefaultFrameTicks);
  const animateStatic = useProject((s) => s.animateStatic);

  const [playing, setPlaying] = useState(false);
  const previewRef = useRef<HTMLCanvasElement>(null);

  // Live preview loop
  useEffect(() => {
    if (!playing || !texture || !texture.animation || texture.animation.frames.length === 0) return;
    // Build the playback list. When interpolating, expand each frame transition
    // into per-pixel (RGBA) interpolated sub-frames — this avoids the
    // "overlap makes pixels opaque" artifact you get from alpha-compositing.
    const frames = texture.animation.frames;
    const interp = texture.animation.interpolate;
    const playback: { pixels: Uint8ClampedArray; dur: number }[] = [];
    if (interp) {
      for (let i = 0; i < frames.length; i++) {
        const a = frames[i];
        const b = frames[(i + 1) % frames.length];
        const steps = Math.max(1, Math.round(a.tickDuration));
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          const buf = new Uint8ClampedArray(a.pixels.length);
          lerpPixels(a.pixels, b.pixels, t, buf);
          playback.push({ pixels: buf, dur: 1 });
        }
      }
    } else {
      for (const f of frames) playback.push({ pixels: f.pixels, dur: f.tickDuration });
    }

    let frameIndex = 0;
    let acc = 0;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      acc += dt;
      const cur = playback[frameIndex];
      const dur = cur.dur * 50;
      while (acc >= dur) {
        acc -= dur;
        frameIndex = (frameIndex + 1) % playback.length;
      }
      drawFrameTo(previewRef.current, playback[frameIndex].pixels, texture.width, texture.height);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, texture]);

  // Render static (paused) preview when not playing
  useEffect(() => {
    if (playing) return;
    if (!texture || !texture.animation || texture.animation.frames.length === 0) return;
    const f = texture.animation.frames[texture.currentFrameIndex] ?? texture.animation.frames[0];
    drawFrameTo(previewRef.current, f.pixels, texture.width, texture.height);
  }, [playing, texture]);

  if (!texture) return <p style={{ fontSize: 11, color: 'var(--fg-3)' }}>No texture</p>;

  // Static texture → offer to animate
  if (!texture.animation) {
    return (
      <div className="frames-panel">
        <p style={{ fontSize: 11, color: 'var(--fg-2)', margin: 0 }}>
          This texture has no animation. Click below to start.
        </p>
        <Button variant="primary" onClick={() => animateStatic()}>
          ✨ Animate
        </Button>
      </div>
    );
  }

  const frames = texture.animation.frames;
  const idx = Math.max(0, Math.min(texture.currentFrameIndex, frames.length - 1));
  const cur = frames[idx];

  return (
    <div className="frames-panel">
      <div
        className="frames-preview-canvas"
        onClick={() => setPlaying((p) => !p)}
        title={playing ? 'Pause preview' : 'Play preview'}
      >
        <canvas ref={previewRef} />
      </div>
      <div className="frames-row">
        <label>Preview</label>
        <button
          className="btn btn-ghost"
          style={{ padding: '4px 10px', fontSize: 12 }}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
      </div>

      <div className="frames-strip">
        {frames.map((f, i) => (
          <button
            key={i}
            className={'frame-thumb' + (i === idx ? ' active' : '')}
            onClick={() => setActiveFrame(i)}
            title={`Frame ${i + 1} · ${f.tickDuration} ticks`}
          >
            <FrameThumb pixels={f.pixels} width={texture.width} height={texture.height} />
            <span className="frame-num">{i + 1}</span>
            <span className="frame-tick">{f.tickDuration}t</span>
          </button>
        ))}
      </div>

      <div className="frames-controls">
        <Button onClick={() => addFrame()}>+ Add</Button>
        <Button onClick={() => duplicateFrame(idx)} disabled={frames.length === 0}>
          Duplicate
        </Button>
        <Button onClick={() => deleteFrame(idx)} disabled={frames.length <= 1}>
          Delete
        </Button>
      </div>

      <div className="frames-row">
        <label>Tick (this frame)</label>
        <input
          type="number"
          min={1}
          max={1000}
          value={cur.tickDuration}
          onChange={(e) => setFrameTickDuration(idx, parseInt(e.target.value, 10) || 1)}
        />
      </div>
      <div className="frames-row">
        <label>Default tick (new frames)</label>
        <input
          type="number"
          min={1}
          max={1000}
          value={texture.animation.defaultFrameTicks}
          onChange={(e) => setDefaultFrameTicks(parseInt(e.target.value, 10) || 1)}
        />
      </div>
      <div className="frames-row">
        <label>Interpolate</label>
        <input
          type="checkbox"
          checked={texture.animation.interpolate}
          onChange={(e) => setInterpolate(e.target.checked)}
        />
      </div>

      <div className="frames-export-row">
        <Button onClick={onExportGif}>⬇ GIF</Button>
        <Button onClick={onExportStrip}>⬇ Strip PNG</Button>
      </div>
    </div>
  );
}

function FrameThumb({ pixels, width, height }: { pixels: Uint8ClampedArray; width: number; height: number }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cvs = ref.current;
    if (!cvs) return;
    cvs.width = width;
    cvs.height = height;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  }, [pixels, width, height]);
  return <canvas ref={ref} style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }} />;
}

/**
 * Per-pixel RGBA interpolation between two frames (straight/non-premultiplied).
 * This is how Minecraft blends animation frames; unlike alpha-compositing one
 * frame over another, it never accumulates opacity, so pixels fade correctly
 * instead of turning opaque.
 */
function lerpPixels(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  t: number,
  out: Uint8ClampedArray,
): void {
  for (let i = 0; i < a.length; i += 4) {
    out[i] = a[i] + (b[i] - a[i]) * t;
    out[i + 1] = a[i + 1] + (b[i + 1] - a[i + 1]) * t;
    out[i + 2] = a[i + 2] + (b[i + 2] - a[i + 2]) * t;
    out[i + 3] = a[i + 3] + (b[i + 3] - a[i + 3]) * t;
  }
}

function drawFrameTo(cvs: HTMLCanvasElement | null, pixels: Uint8ClampedArray, w: number, h: number): void {
  if (!cvs) return;
  // Match the visible cell to the natural aspect ratio; let CSS scale it down
  const maxDim = 128;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  cvs.width = Math.max(1, Math.round(w * scale));
  cvs.height = Math.max(1, Math.round(h * scale));
  const ctx = cvs.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext('2d');
  if (!tctx) return;
  tctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), w, h), 0, 0);
  // Explicitly clear first so a previous frame never shows through where the
  // new one is transparent (no layering/ghosting).
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  ctx.drawImage(tmp, 0, 0, cvs.width, cvs.height);
}
