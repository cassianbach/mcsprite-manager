/**
 * GIF export using `gifenc`. Encodes a list of frames as an animated GIF.
 * Frames are nearest-neighbor upscaled to `outScale * srcW / srcH`.
 * Variable timing is preserved (1 tick = 50ms by default).
 *
 * Notes on the gifenc API (verified against the README + source):
 *  - Use `auto: true` (default). It writes the GIF header on the first frame.
 *    Using `auto: false` requires `first: true` on frame 0, otherwise the
 *    output has no magic bytes and most decoders reject it.
 *  - `delay` is in milliseconds (NOT centiseconds).
 *  - `repeat` is set on the FIRST frame only. 0 = forever, -1 = once.
 *  - `transparentIndex` is the index into the palette that becomes transparent.
 *    The palette's first entry sits at index 0, so we use a known transparent
 *    index by reserving palette[0] for fully-transparent pixels.
 *  - `format: 'rgba4444'` keeps alpha during quantize+applyPalette so the
 *    fully-transparent pixels stay grouped and get a stable palette entry.
 */
import { GIFEncoder, quantize, applyPalette, type WriteFrameOptions } from 'gifenc';

export interface GifFrame {
  pixels: Uint8ClampedArray; // RGBA
  width: number;
  height: number;
  tickDuration: number;       // MC ticks (1 = 50ms)
}

export interface GifOptions {
  outScale?: number;            // upscale factor (1 = no upscale)
  ticksToMs?: number;           // ms per tick (default 50)
  loop?: number;                // 0 = forever, -1 = once, N = N times
  maxColors?: number;           // default 256
  transparent?: boolean;        // preserve alpha=0 as transparent
  interpolate?: boolean;        // expand transitions into per-pixel interpolated sub-frames
}

export async function encodeFramesToGif(frames: GifFrame[], options: GifOptions = {}): Promise<Uint8Array> {
  const outScale = Math.max(1, options.outScale ?? 1);
  const ticksToMs = options.ticksToMs ?? 50;
  const loop = options.loop ?? 0;
  const maxColors = options.maxColors ?? 256;
  const transparent = options.transparent ?? true;

  if (frames.length === 0) throw new Error('No frames to encode');

  const effFrames = options.interpolate ? expandInterpolated(frames) : frames;

  const outW = effFrames[0].width * outScale;
  const outH = effFrames[0].height * outScale;

  const encoder = GIFEncoder({ initialCapacity: 1024 * effFrames.length });

  for (let i = 0; i < effFrames.length; i++) {
    const f = effFrames[i];
    const rgba = scaleNearest(f.pixels, f.width, f.height, outW, outH);

    // Reserve palette index 0 for the transparent color so transparentIndex=0
    // is always meaningful. Quantize with the rgba4444 format so alpha is
    // respected and we get a stable grouped bin for transparent pixels.
    const palette = quantize(rgba, maxColors, {
      format: 'rgba4444',
      clearAlpha: transparent,
      clearAlphaThreshold: transparent ? 0 : -1,
      clearAlphaColor: 0,
    });
    const indices = applyPalette(rgba, palette, 'rgba4444');

    // delay is in milliseconds — convert MC ticks to ms (1 tick = 50ms).
    const delayMs = Math.max(20, Math.round(f.tickDuration * ticksToMs));

    const frameOpts: WriteFrameOptions = {
      palette,
      delay: delayMs,
      // Restore to background between frames so transparent areas don't
      // accumulate previous frames (otherwise animated textures layer/ghost).
      dispose: transparent ? 2 : 0,
    };
    if (i === 0) {
      frameOpts.repeat = loop;
      frameOpts.first = true;
    }
    if (transparent) {
      frameOpts.transparent = true;
      frameOpts.transparentIndex = 0;
    }
    encoder.writeFrame(indices, outW, outH, frameOpts);
  }

  encoder.finish();
  return encoder.bytesView();
}

function scaleNearest(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      const si = (sy * sw + sx) * 4;
      const di = (y * dw + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return out;
}

/** Compose a vertical animation strip PNG bytes from frames (no GIF). */
export async function encodeFramesToStripPng(
  frames: GifFrame[],
  options: { transparent?: boolean } = {},
): Promise<Uint8Array> {
  if (frames.length === 0) throw new Error('No frames to encode');
  const w = frames[0].width;
  const h = frames[0].height;
  for (const f of frames) {
    if (f.width !== w || f.height !== h) throw new Error('All frames must have the same dimensions');
  }

  // Construct via OffscreenCanvas to get a real PNG
  const totalH = h * frames.length;
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, totalH);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    for (let i = 0; i < frames.length; i++) {
      const tmp = new OffscreenCanvas(w, h);
      const tctx = tmp.getContext('2d');
      if (!tctx) throw new Error('No 2D context');
      tctx.putImageData(new ImageData(new Uint8ClampedArray(frames[i].pixels), w, h), 0, 0);
      ctx.drawImage(tmp, 0, i * h);
    }
    const blob = await c.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  }

  // Fallback: HTMLCanvasElement
  const c = document.createElement('canvas');
  c.width = w;
  c.height = totalH;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('No 2D context');
  for (let i = 0; i < frames.length; i++) {
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const tctx = tmp.getContext('2d');
    if (!tctx) throw new Error('No 2D context');
    tctx.putImageData(new ImageData(new Uint8ClampedArray(frames[i].pixels), w, h), 0, 0);
    ctx.drawImage(tmp, 0, i * h);
  }
  const blob = await new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Expand an animation into per-pixel (RGBA) interpolated sub-frames so a GIF
 * plays smoothly without alpha-compositing overlap artifacts. Between each
 * frame `i` and `i+1` we emit `tickDuration_i` sub-frames; the final frame is
 * not duplicated because the next iteration begins with frame `i+1` itself.
 */
function expandInterpolated(frames: GifFrame[]): GifFrame[] {
  const out: GifFrame[] = [];
  for (let i = 0; i < frames.length; i++) {
    const a = frames[i];
    const b = frames[(i + 1) % frames.length];
    const steps = Math.max(1, Math.round(a.tickDuration));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const buf = new Uint8ClampedArray(a.pixels.length);
      for (let p = 0; p < a.pixels.length; p += 4) {
        buf[p] = a.pixels[p] + (b.pixels[p] - a.pixels[p]) * t;
        buf[p + 1] = a.pixels[p + 1] + (b.pixels[p + 1] - a.pixels[p + 1]) * t;
        buf[p + 2] = a.pixels[p + 2] + (b.pixels[p + 2] - a.pixels[p + 2]) * t;
        buf[p + 3] = a.pixels[p + 3] + (b.pixels[p + 3] - a.pixels[p + 3]) * t;
      }
      out.push({ pixels: buf, width: a.width, height: a.height, tickDuration: 1 });
    }
  }
  return out;
}

export async function downloadBytes(bytes: Uint8Array, filename: string, mime: string): Promise<void> {
  // Copy into a fresh ArrayBuffer-backed Uint8Array so the Blob constructor
  // doesn't see SharedArrayBuffer in the union.
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  const blob = new Blob([copy], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
