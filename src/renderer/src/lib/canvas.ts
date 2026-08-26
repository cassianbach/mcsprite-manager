/** Wrap an ImageData's pixel buffer into a fresh Uint8ClampedArray (decoupled from ImageData). */
export function clonePixels(pixels: Uint8ClampedArray): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels);
}

export function makeImageData(pixels: Uint8ClampedArray, w: number, h: number): ImageData {
  return new ImageData(new Uint8ClampedArray(pixels), w, h);
}

/** Pack RGBA from a hex string into a 4-tuple ready for direct pixel writes. */
export function hexToTuple(hex: string): [number, number, number, number] {
  let s = hex.replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (s.length === 6) s += 'ff';
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
    parseInt(s.slice(6, 8), 16),
  ];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function paintPixel(
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
  w: number,
  h: number,
  color: [number, number, number, number],
  brushSize: number,
): Rect | null {
  const r = brushSize === 1 ? 0 : Math.floor(brushSize / 2);
  const x0 = Math.max(0, x - r);
  const y0 = Math.max(0, y - r);
  const x1 = Math.min(w - 1, x - r + brushSize - 1);
  const y1 = Math.min(h - 1, y - r + brushSize - 1);
  if (x1 < x0 || y1 < y0) return null;
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const i = (py * w + px) * 4;
      pixels[i] = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
      pixels[i + 3] = color[3];
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function erasePixel(
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
  w: number,
  h: number,
  brushSize: number,
): Rect | null {
  const r = brushSize === 1 ? 0 : Math.floor(brushSize / 2);
  const x0 = Math.max(0, x - r);
  const y0 = Math.max(0, y - r);
  const x1 = Math.min(w - 1, x - r + brushSize - 1);
  const y1 = Math.min(h - 1, y - r + brushSize - 1);
  if (x1 < x0 || y1 < y0) return null;
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const i = (py * w + px) * 4;
      pixels[i] = 0;
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
      pixels[i + 3] = 0;
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Bresenham line. Returns array of pixel coords. */
export function bresenhamLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1;
  let sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  while (true) {
    pts.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return pts;
}

/**
 * Rescale a texture's pixels to a new width/height.
 * Modes:
 *  - 'nearest': pick the closest source pixel (pixel-perfect upscale/downscale, no smoothing).
 *  - 'bilinear': smooth resample — good for shrinking, blurry for upscaling.
 * Returns a new Uint8ClampedArray of length newW * newH * 4. Source is unchanged.
 */
export type RescaleMode = 'nearest' | 'bilinear';

export function rescalePixels(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  mode: RescaleMode = 'nearest',
): Uint8ClampedArray {
  if (dstW <= 0 || dstH <= 0) {
    throw new Error('Rescale: dimensions must be positive');
  }
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  if (srcW === dstW && srcH === dstH) {
    out.set(src);
    return out;
  }
  if (mode === 'nearest') {
    for (let y = 0; y < dstH; y++) {
      const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
      for (let x = 0; x < dstW; x++) {
        const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
        const si = (sy * srcW + sx) * 4;
        const di = (y * dstW + x) * 4;
        out[di] = src[si];
        out[di + 1] = src[si + 1];
        out[di + 2] = src[si + 2];
        out[di + 3] = src[si + 3];
      }
    }
    return out;
  }
  // Bilinear
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const sy = y * yRatio;
    const sy0 = Math.floor(sy);
    const sy1 = Math.min(srcH - 1, sy0 + 1);
    const fy = sy - sy0;
    for (let x = 0; x < dstW; x++) {
      const sx = x * xRatio;
      const sx0 = Math.floor(sx);
      const sx1 = Math.min(srcW - 1, sx0 + 1);
      const fx = sx - sx0;

      const i00 = (sy0 * srcW + sx0) * 4;
      const i10 = (sy0 * srcW + sx1) * 4;
      const i01 = (sy1 * srcW + sx0) * 4;
      const i11 = (sy1 * srcW + sx1) * 4;
      const di = (y * dstW + x) * 4;

      for (let c = 0; c < 4; c++) {
        const a = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
        const b = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
        out[di + c] = Math.round(a * (1 - fy) + b * fy);
      }
    }
  }
  return out;
}

/** Scanline flood fill (4-connected). Mutates `pixels`. Returns dirty rect or null. */
export function floodFill(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  fill: [number, number, number, number],
  tolerance = 0,
  skipTransparent = false,
): { x: number; y: number; w: number; h: number } | null {
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const startIdx = (sy * w + sx) * 4;
  const tr = pixels[startIdx];
  const tg = pixels[startIdx + 1];
  const tb = pixels[startIdx + 2];
  const ta = pixels[startIdx + 3];

  if (
    tr === fill[0] &&
    tg === fill[1] &&
    tb === fill[2] &&
    ta === fill[3]
  ) {
    return null; // same color, no-op
  }

  const matches = (i: number): boolean => {
    if (skipTransparent && pixels[i + 3] === 0) return false;
    return (
      Math.abs(pixels[i] - tr) <= tolerance &&
      Math.abs(pixels[i + 1] - tg) <= tolerance &&
      Math.abs(pixels[i + 2] - tb) <= tolerance &&
      Math.abs(pixels[i + 3] - ta) <= tolerance
    );
  };

  const stack: number[] = [sx, sy];
  let minX = sx, minY = sy, maxX = sx, maxY = sy;

  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = (y * w + x) * 4;
    if (!matches(i)) continue;
    pixels[i] = fill[0];
    pixels[i + 1] = fill[1];
    pixels[i + 2] = fill[2];
    pixels[i + 3] = fill[3];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }

  if (maxX < minX) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Get RGBA at a pixel. */
export function getPixel(
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
  w: number,
): [number, number, number, number] {
  const i = (y * w + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}

/** Copy a rect (inclusive). Returns a new Uint8ClampedArray. */
export function copyRect(
  pixels: Uint8ClampedArray,
  w: number,
  x: number,
  y: number,
  cw: number,
  ch: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let row = 0; row < ch; row++) {
    const srcStart = ((y + row) * w + x) * 4;
    const dstStart = row * cw * 4;
    out.set(pixels.subarray(srcStart, srcStart + cw * 4), dstStart);
  }
  return out;
}

/** Paste a rect of pixels (clipped). Returns dirty rect or null. */
export function pasteRect(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
): { x: number; y: number; w: number; h: number } | null {
  const x0 = Math.max(0, dx);
  const y0 = Math.max(0, dy);
  const x1 = Math.min(w, dx + sw);
  const y1 = Math.min(h, dy + sh);
  if (x1 <= x0 || y1 <= y0) return null;
  for (let row = y0; row < y1; row++) {
    for (let col = x0; col < x1; col++) {
      const si = ((row - dy) * sw + (col - dx)) * 4;
      const sa = src[si + 3];
      if (sa === 0) continue; // transparent skip
      const di = (row * w + col) * 4;
      pixels[di] = src[si];
      pixels[di + 1] = src[si + 1];
      pixels[di + 2] = src[si + 2];
      pixels[di + 3] = src[si + 3];
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Clear a rect (set to transparent). */
export function clearRect(
  pixels: Uint8ClampedArray,
  w: number,
  x: number,
  y: number,
  cw: number,
  ch: number,
): { x: number; y: number; w: number; h: number } {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(w, x + cw);
  const y1 = Math.min(y + ch);
  for (let row = y0; row < y1; row++) {
    const start = (row * w + x0) * 4;
    const end = (row * w + x1) * 4;
    pixels.fill(0, start, end);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ===== Advanced paint ops =====

export type ShadeMode = 'lighten' | 'darken' | 'tint' | 'fade';

/**
 * Apply the shade tool to pixels in a brush-sized square.
 * - lighten/darken: add/subtract from RGB by `strength` (0..255).
 * - tint: blend toward `tintColor` by `strength`/100.
 * - fade: reduce alpha by `strength` (0..255) per pass.
 * Skips fully transparent pixels. Returns the dirty rect (or null if nothing changed).
 */
export function shadePixels(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  brushSize: number,
  mode: ShadeMode,
  strength: number,
  tintColor: [number, number, number, number],
): Rect | null {
  const r = brushSize === 1 ? 0 : Math.floor(brushSize / 2);
  const x0 = Math.max(0, cx - r);
  const y0 = Math.max(0, cy - r);
  const x1 = Math.min(w - 1, cx - r + brushSize - 1);
  const y1 = Math.min(h - 1, cy - r + brushSize - 1);
  if (x1 < x0 || y1 < y0) return null;
  let changed = false;
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const i = (py * w + px) * 4;
      const a = pixels[i + 3];
      if (a === 0) continue;
      changed = true;
      if (mode === 'lighten') {
        pixels[i] = Math.min(255, pixels[i] + strength);
        pixels[i + 1] = Math.min(255, pixels[i + 1] + strength);
        pixels[i + 2] = Math.min(255, pixels[i + 2] + strength);
      } else if (mode === 'darken') {
        pixels[i] = Math.max(0, pixels[i] - strength);
        pixels[i + 1] = Math.max(0, pixels[i + 1] - strength);
        pixels[i + 2] = Math.max(0, pixels[i + 2] - strength);
      } else if (mode === 'tint') {
        const t = strength / 100;
        pixels[i] = Math.round(pixels[i] * (1 - t) + tintColor[0] * t);
        pixels[i + 1] = Math.round(pixels[i + 1] * (1 - t) + tintColor[1] * t);
        pixels[i + 2] = Math.round(pixels[i + 2] * (1 - t) + tintColor[2] * t);
        pixels[i + 3] = Math.round(pixels[i + 3] * (1 - t) + tintColor[3] * t);
      } else if (mode === 'fade') {
        pixels[i + 3] = Math.max(0, pixels[i + 3] - strength);
      }
    }
  }
  if (!changed) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export interface RecolorOptions {
  hue?: number;        // -180..180
  saturation?: number; // -100..100 (percent)
  brightness?: number; // -100..100 (percent)
  contrast?: number;   // -100..100
  invert?: boolean;
  grayscale?: boolean;
  colorize?: [number, number, number]; // rgb of tint, used with grayscale
}

/** Apply a recolor operation to the entire pixel buffer (or a sub-rect if `rect` given). */
export function recolorPixels(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  options: RecolorOptions,
  rect?: Rect,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  const x0 = rect ? Math.max(0, rect.x) : 0;
  const y0 = rect ? Math.max(0, rect.y) : 0;
  const x1 = rect ? Math.min(width, rect.x + rect.w) : width;
  const y1 = rect ? Math.min(height, rect.y + rect.h) : height;
  const hueShift = (options.hue ?? 0) / 360;
  const satMul = 1 + (options.saturation ?? 0) / 100;
  const brightAdd = (options.brightness ?? 0) * 2.55;
  const contrast = (options.contrast ?? 0) / 100;
  const invert = options.invert ?? false;
  const grayscale = options.grayscale ?? false;
  const colorize = options.colorize;

  // Pre-compute contrast factor: contrast = (c + 1) / (1 - c * 0.5)
  const cf = contrast === 0 ? 1 : (contrast + 1) / (1 - contrast * 0.5);
  const offset = 128 * (1 - cf);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      let r = out[i];
      let g = out[i + 1];
      let b = out[i + 2];

      if (invert) {
        r = 255 - r; g = 255 - g; b = 255 - b;
      }

      if (grayscale) {
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        r = g = b = gray;
      } else if (hueShift !== 0 || satMul !== 1) {
        // RGB → HSL
        const rn = r / 255;
        const gn = g / 255;
        const bn = b / 255;
        const max = Math.max(rn, gn, bn);
        const min = Math.min(rn, gn, bn);
        const l = (max + min) / 2;
        let h = 0;
        let s = 0;
        if (max !== min) {
          const d = max - min;
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          switch (max) {
            case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)); break;
            case gn: h = ((bn - rn) / d + 2); break;
            case bn: h = ((rn - gn) / d + 4); break;
          }
          h /= 6;
        }
        // Apply shifts
        h = (h + hueShift + 1) % 1;
        s = Math.max(0, Math.min(1, s * satMul));
        // HSL → RGB
        if (s === 0) {
          const gray = Math.round(l * 255);
          r = g = b = gray;
        } else {
          const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
          const p = 2 * l - q;
          const hue2rgb = (t: number): number => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
          };
          r = Math.round(hue2rgb(h + 1 / 3) * 255);
          g = Math.round(hue2rgb(h) * 255);
          b = Math.round(hue2rgb(h - 1 / 3) * 255);
        }
      }

      if (colorize && grayscale) {
        r = Math.round(r * colorize[0] / 255);
        g = Math.round(g * colorize[1] / 255);
        b = Math.round(b * colorize[2] / 255);
      }

      if (contrast !== 0) {
        r = Math.max(0, Math.min(255, Math.round(r * cf + offset)));
        g = Math.max(0, Math.min(255, Math.round(g * cf + offset)));
        b = Math.max(0, Math.min(255, Math.round(b * cf + offset)));
      }

      if (brightAdd !== 0) {
        r = Math.max(0, Math.min(255, Math.round(r + brightAdd)));
        g = Math.max(0, Math.min(255, Math.round(g + brightAdd)));
        b = Math.max(0, Math.min(255, Math.round(b + brightAdd)));
      }

      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
    }
  }
  return out;
}

/** Replace one RGBA color with another across the whole texture (or rect), with a tolerance 0..255. */
export function replaceColor(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  from: [number, number, number, number],
  to: [number, number, number, number],
  tolerance = 0,
  rect?: Rect,
): { pixels: Uint8ClampedArray; changed: number } {
  const out = new Uint8ClampedArray(src);
  const x0 = rect ? Math.max(0, rect.x) : 0;
  const y0 = rect ? Math.max(0, rect.y) : 0;
  const x1 = rect ? Math.min(width, rect.x + rect.w) : width;
  const y1 = rect ? Math.min(height, rect.y + rect.h) : height;
  let changed = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      if (
        Math.abs(out[i] - from[0]) <= tolerance &&
        Math.abs(out[i + 1] - from[1]) <= tolerance &&
        Math.abs(out[i + 2] - from[2]) <= tolerance &&
        Math.abs(out[i + 3] - from[3]) <= tolerance
      ) {
        out[i] = to[0];
        out[i + 1] = to[1];
        out[i + 2] = to[2];
        out[i + 3] = to[3];
        changed++;
      }
    }
  }
  return { pixels: out, changed };
}

/** Mirror a pixel coordinate within bounds. */
export function mirrorX(x: number, w: number): number {
  return w - 1 - x;
}
export function mirrorY(y: number, h: number): number {
  return h - 1 - y;
}

/**
 * Fill a region with a linear gradient. The gradient axis is the line from
 * (x0,y0) to (x1,y1); each pixel's distance along that axis (clamped to 0..1)
 * interpolates `from` → `to`. If `rect` is given, only that region is written
 * (but the axis is still the global one). Mutates `pixels`, returns dirty rect.
 */
export function gradientFill(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  from: [number, number, number, number],
  to: [number, number, number, number],
  rect?: Rect,
): Rect {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  const rx = rect ? Math.max(0, rect.x) : 0;
  const ry = rect ? Math.max(0, rect.y) : 0;
  const rx1 = rect ? Math.min(w, rect.x + rect.w) : w;
  const ry1 = rect ? Math.min(h, rect.y + rect.h) : h;
  const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);
  for (let py = ry; py < ry1; py++) {
    for (let px = rx; px < rx1; px++) {
      const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
      const i = (py * w + px) * 4;
      pixels[i] = lerp(from[0], to[0], t);
      pixels[i + 1] = lerp(from[1], to[1], t);
      pixels[i + 2] = lerp(from[2], to[2], t);
      pixels[i + 3] = lerp(from[3], to[3], t);
    }
  }
  return { x: rx, y: ry, w: rx1 - rx, h: ry1 - ry };
}

/**
 * Fill a region with a gradient that follows a freehand path. For each pixel
 * we find the nearest point on the polyline and its arc-length distance from
 * the path start; `from` → `to` is interpolated by that normalized distance, so
 * the color bands run perpendicular to the stroke. Mutates `pixels`.
 */
export function gradientAlongPath(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  pts: Array<{ x: number; y: number }>,
  from: [number, number, number, number],
  to: [number, number, number, number],
  rect?: Rect,
  thickness = 8,
): Rect | null {
  if (pts.length === 0) return null;
  // `thickness` is an odd diameter (1,3,5,...). Radius = (diameter-1)/2 so a
  // stroke of thickness 1 is exactly one pixel wide and thickness 3 is 3 wide
  // (no silent rounding). Clamp to at least 0 for a 1px dot.
  const r = Math.max(0, Math.floor((Math.max(1, Math.round(thickness)) - 1) / 2));
  const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);

  // Bounding box of the path, expanded by the stroke radius.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  let x0 = Math.max(0, Math.floor(minX) - r);
  let y0 = Math.max(0, Math.floor(minY) - r);
  let x1 = Math.min(w, Math.ceil(maxX) + r + 1);
  let y1 = Math.min(h, Math.ceil(maxY) + r + 1);
  // Clip to the selection if one exists, so the gradient stays inside it.
  if (rect) {
    x0 = Math.max(x0, Math.floor(rect.x));
    y0 = Math.max(y0, Math.floor(rect.y));
    x1 = Math.min(x1, Math.floor(rect.x + rect.w));
    y1 = Math.min(y1, Math.floor(rect.y + rect.h));
  }
  if (x1 <= x0 || y1 <= y0) return null;

  if (pts.length === 1) {
    // Single click: stamp a soft dot of the start color.
    const cx = pts[0].x;
    const cy = pts[0].y;
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        if (Math.hypot(px - cx, py - cy) <= r) {
          const i = (py * w + px) * 4;
          pixels[i] = from[0]; pixels[i + 1] = from[1]; pixels[i + 2] = from[2]; pixels[i + 3] = from[3];
        }
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // Precompute cumulative arc lengths so the color follows the curve's length.
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  const total = cum[cum.length - 1] || 1;

  // Paint only pixels within `r` of the curve, giving a gradient stroke that
  // traces the path instead of flooding the whole region (no "cube" fill).
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      let bestT = 0;
      let bestDist = Infinity;
      for (let i = 1; i < pts.length; i++) {
        const ax = pts[i - 1].x;
        const ay = pts[i - 1].y;
        const bx = pts[i].x;
        const by = pts[i].y;
        const abx = bx - ax;
        const aby = by - ay;
        const ab2 = abx * abx + aby * aby;
        let t = ab2 === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / ab2;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + abx * t;
        const cy = ay + aby * t;
        const d = Math.hypot(px - cx, py - cy);
        if (d < bestDist) {
          bestDist = d;
          bestT = (cum[i - 1] + t * (cum[i] - cum[i - 1])) / total;
        }
      }
      if (bestDist <= r) {
        const tt = Math.max(0, Math.min(1, bestT));
        const i = (py * w + px) * 4;
        pixels[i] = lerp(from[0], to[0], tt);
        pixels[i + 1] = lerp(from[1], to[1], tt);
        pixels[i + 2] = lerp(from[2], to[2], tt);
        pixels[i + 3] = lerp(from[3], to[3], tt);
      }
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Like `gradientAlongPath` (stroke follows the freehand curve) but the gradient
 * color is interpolated along a fixed `angleDeg` axis instead of the curve's
 * arc length. So the stroke traces your path while the color fades in a
 * consistent direction across the whole region.
 */
export function gradientAlongPathAngle(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  pts: Array<{ x: number; y: number }>,
  from: [number, number, number, number],
  to: [number, number, number, number],
  rect: Rect | undefined,
  thickness: number,
  angleDeg: number,
): Rect | null {
  if (pts.length === 0) return null;
  const r = Math.max(0, Math.floor((Math.max(1, Math.round(thickness)) - 1) / 2));
  const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);

  // Bounding box of the path expanded by the stroke radius.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  let x0 = Math.max(0, Math.floor(minX) - r);
  let y0 = Math.max(0, Math.floor(minY) - r);
  let x1 = Math.min(w, Math.ceil(maxX) + r + 1);
  let y1 = Math.min(h, Math.ceil(maxY) + r + 1);
  if (rect) {
    x0 = Math.max(x0, Math.floor(rect.x));
    y0 = Math.max(y0, Math.floor(rect.y));
    x1 = Math.min(x1, Math.floor(rect.x + rect.w));
    y1 = Math.min(y1, Math.floor(rect.y + rect.h));
  }
  if (x1 <= x0 || y1 <= y0) return null;

  // Project the bounding-box corners onto the angle axis for [min,max].
  const corners = [
    [x0, y0],
    [x1 - 1, y0],
    [x0, y1 - 1],
    [x1 - 1, y1 - 1],
  ];
  let mn = Infinity;
  let mx = -Infinity;
  for (const [cx, cy] of corners) {
    const proj = cx * dx + cy * dy;
    if (proj < mn) mn = proj;
    if (proj > mx) mx = proj;
  }
  const span = mx - mn || 1;

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      // Nearest distance to the polyline (same as gradientAlongPath).
      let bestDist = Infinity;
      for (let i = 1; i < pts.length; i++) {
        const ax = pts[i - 1].x;
        const ay = pts[i - 1].y;
        const bx = pts[i].x;
        const by = pts[i].y;
        const abx = bx - ax;
        const aby = by - ay;
        const ab2 = abx * abx + aby * aby;
        let t = ab2 === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / ab2;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
        if (d < bestDist) bestDist = d;
      }
      if (bestDist <= r) {
        const tt = Math.max(0, Math.min(1, (px * dx + py * dy - mn) / span));
        const i = (py * w + px) * 4;
        pixels[i] = lerp(from[0], to[0], tt);
        pixels[i + 1] = lerp(from[1], to[1], tt);
        pixels[i + 2] = lerp(from[2], to[2], tt);
        pixels[i + 3] = lerp(from[3], to[3], tt);
      }
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Fill a rectangular region with a linear gradient from `from` (at the start
 * edge) to `to` (at the end edge). `axis` controls the direction:
 * 'vertical' fades top -> bottom, 'horizontal' fades left -> right.
 * Only pixels inside `rect` (clamped to the canvas) are touched.
 */
export function gradientRect(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  rect: Rect,
  from: [number, number, number, number],
  to: [number, number, number, number],
  axis: 'vertical' | 'horizontal' = 'vertical',
): Rect {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(w, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(h, Math.ceil(rect.y + rect.h));
  if (x1 <= x0 || y1 <= y0) return { x: x0, y: y0, w: 0, h: 0 };
  const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);
  if (axis === 'vertical') {
    const total = y1 - y0 - 1 || 1;
    for (let py = y0; py < y1; py++) {
      const t = (py - y0) / total;
      for (let px = x0; px < x1; px++) {
        const i = (py * w + px) * 4;
        pixels[i] = lerp(from[0], to[0], t);
        pixels[i + 1] = lerp(from[1], to[1], t);
        pixels[i + 2] = lerp(from[2], to[2], t);
        pixels[i + 3] = lerp(from[3], to[3], t);
      }
    }
  } else {
    const total = x1 - x0 - 1 || 1;
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const t = (px - x0) / total;
        const i = (py * w + px) * 4;
        pixels[i] = lerp(from[0], to[0], t);
        pixels[i + 1] = lerp(from[1], to[1], t);
        pixels[i + 2] = lerp(from[2], to[2], t);
        pixels[i + 3] = lerp(from[3], to[3], t);
      }
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Fill a rectangular region with a linear gradient oriented at `angleDeg`
 * (0 = left→right, 90 = top→bottom). The gradient's position along the axis is
 * projected onto the direction vector so the fade runs at an arbitrary angle.
 */
export function gradientRectAngle(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  rect: Rect,
  from: [number, number, number, number],
  to: [number, number, number, number],
  angleDeg: number,
): Rect {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(w, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(h, Math.ceil(rect.y + rect.h));
  if (x1 <= x0 || y1 <= y0) return { x: x0, y: y0, w: 0, h: 0 };
  const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  // Project corners onto the gradient axis to get the [min,max] range.
  const corners = [
    [x0, y0],
    [x1 - 1, y0],
    [x0, y1 - 1],
    [x1 - 1, y1 - 1],
  ];
  let mn = Infinity;
  let mx = -Infinity;
  for (const [cx, cy] of corners) {
    const p = cx * dx + cy * dy;
    if (p < mn) mn = p;
    if (p > mx) mx = p;
  }
  const span = mx - mn || 1;
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const t = Math.max(0, Math.min(1, (px * dx + py * dy - mn) / span));
      const i = (py * w + px) * 4;
      pixels[i] = lerp(from[0], to[0], t);
      pixels[i + 1] = lerp(from[1], to[1], t);
      pixels[i + 2] = lerp(from[2], to[2], t);
      pixels[i + 3] = lerp(from[3], to[3], t);
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Radial gradient from a single clicked point: color fades from `from` (at the
 * center) to `to` (at the edge). `maxR` is the radius to the nearest edge so the
 * falloff covers the whole reachable area. Optionally rotated by `angleDeg`.
 */
export function gradientPoint(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  from: [number, number, number, number],
  to: [number, number, number, number],
  maxR?: number,
): Rect {
  const r = maxR ?? Math.max(1, Math.max(cx, w - cx, cy, h - cy));
  const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(w, Math.ceil(cx + r));
  const y1 = Math.min(h, Math.ceil(cy + r));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const d = Math.hypot(px - cx, py - cy);
      if (d > r) continue;
      const t = Math.max(0, Math.min(1, d / r));
      const i = (py * w + px) * 4;
      pixels[i] = lerp(from[0], to[0], t);
      pixels[i + 1] = lerp(from[1], to[1], t);
      pixels[i + 2] = lerp(from[2], to[2], t);
      pixels[i + 3] = lerp(from[3], to[3], t);
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Gradient across a set of clicked pixels ("dots"). Only the clicked pixels are
 * painted; nothing between them is affected. Color interpolates from `from` to
 * `to` based on the pixel's projected position along the `angleDeg` axis
 * (falling back to the order clicked if no angle). Each dot gets a small radius
 * so single pixels are visible.
 */
export function gradientDots(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  dots: Array<{ x: number; y: number }>,
  from: [number, number, number, number],
  to: [number, number, number, number],
  angleDeg?: number,
  radius = 0,
): Rect | null {
  if (dots.length === 0) return null;
  const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);

  // Determine each dot's gradient position.
  let tByDot: number[];
  if (angleDeg !== undefined) {
    const rad = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    let mn = Infinity;
    let mx = -Infinity;
    for (const d of dots) {
      const p = d.x * dx + d.y * dy;
      if (p < mn) mn = p;
      if (p > mx) mx = p;
    }
    const span = mx - mn || 1;
    tByDot = dots.map((d) => Math.max(0, Math.min(1, (d.x * dx + d.y * dy - mn) / span)));
  } else {
    tByDot = dots.map((_, i) => (dots.length === 1 ? 0 : i / (dots.length - 1)));
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const d of dots) {
    minX = Math.min(minX, d.x - radius);
    minY = Math.min(minY, d.y - radius);
    maxX = Math.max(maxX, d.x + radius);
    maxY = Math.max(maxY, d.y + radius);
  }

  for (let k = 0; k < dots.length; k++) {
    const d = dots[k];
    const t = tByDot[k];
    for (let py = Math.max(0, d.y - radius); py <= Math.min(h - 1, d.y + radius); py++) {
      for (let px = Math.max(0, d.x - radius); px <= Math.min(w - 1, d.x + radius); px++) {
        if (radius > 0 && Math.hypot(px - d.x, py - d.y) > radius) continue;
        const i = (py * w + px) * 4;
        pixels[i] = lerp(from[0], to[0], t);
        pixels[i + 1] = lerp(from[1], to[1], t);
        pixels[i + 2] = lerp(from[2], to[2], t);
        pixels[i + 3] = lerp(from[3], to[3], t);
      }
    }
  }
  return {
    x: Math.max(0, Math.floor(minX)),
    y: Math.max(0, Math.floor(minY)),
    w: Math.min(w, Math.ceil(maxX)) - Math.max(0, Math.floor(minX)),
    h: Math.min(h, Math.ceil(maxY)) - Math.max(0, Math.floor(minY)),
  };
}

/** Mirror a rectangle across the active axes, returning all variants (clamped). */
export function mirrorRect(
  rect: Rect,
  mirror: 'none' | 'horizontal' | 'vertical' | 'quad',
  w: number,
  h: number,
): Rect[] {
  const clamp = (r: Rect): Rect => ({
    x: Math.max(0, Math.min(w, r.x)),
    y: Math.max(0, Math.min(h, r.y)),
    w: Math.max(0, Math.min(w - Math.max(0, r.x), r.w)),
    h: Math.max(0, Math.min(h - Math.max(0, r.y), r.h)),
  });
  const rects: Rect[] = [clamp(rect)];
  if (mirror === 'horizontal' || mirror === 'quad') {
    rects.push(clamp({ x: w - rect.x - rect.w, y: rect.y, w: rect.w, h: rect.h }));
  }
  if (mirror === 'vertical' || mirror === 'quad') {
    rects.push(clamp({ x: rect.x, y: h - rect.y - rect.h, w: rect.w, h: rect.h }));
  }
  if (mirror === 'quad') {
    rects.push(clamp({ x: w - rect.x - rect.w, y: h - rect.y - rect.h, w: rect.w, h: rect.h }));
  }
  return rects.filter((r) => r.w > 0 && r.h > 0);
}

/**
 * Smush / mix tool: for each pixel in the brush, blend it toward the average of
 * its neighborhood (radius `radius`) by `strength` (0..1). Reads from a copy so
 * the smear doesn't feed back within a single pass. Mutates `pixels`.
 */
export function smushPixels(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  brushSize: number,
  strength: number,
  radius = 1,
): Rect | null {
  const r = brushSize === 1 ? 0 : Math.floor(brushSize / 2);
  const x0 = Math.max(0, cx - r);
  const y0 = Math.max(0, cy - r);
  const x1 = Math.min(w - 1, cx - r + brushSize - 1);
  const y1 = Math.min(h - 1, cy - r + brushSize - 1);
  if (x1 < x0 || y1 < y0) return null;
  const src = pixels.slice();
  const s = Math.max(0, Math.min(1, strength));
  if (s <= 0) return null;
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      let ar = 0, ag = 0, ab = 0, aa = 0, n = 0;
      for (let ny = py - radius; ny <= py + radius; ny++) {
        if (ny < 0 || ny >= h) continue;
        for (let nx = px - radius; nx <= px + radius; nx++) {
          if (nx < 0 || nx >= w) continue;
          const si = (ny * w + nx) * 4;
          ar += src[si]; ag += src[si + 1]; ab += src[si + 2]; aa += src[si + 3];
          n++;
        }
      }
      if (n === 0) continue;
      const i = (py * w + px) * 4;
      pixels[i] = Math.round(src[i] + (ar / n - src[i]) * s);
      pixels[i + 1] = Math.round(src[i + 1] + (ag / n - src[i + 1]) * s);
      pixels[i + 2] = Math.round(src[i + 2] + (ab / n - src[i + 2]) * s);
      pixels[i + 3] = Math.round(src[i + 3] + (aa / n - src[i + 3]) * s);
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export type TransformOp = 'rotate-cw' | 'rotate-ccw' | 'rotate-180' | 'flip-h' | 'flip-v';

/** Rotate or flip a single pixel buffer. Returns a new buffer + new dimensions. */
export function transformPixels(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  op: TransformOp,
): { pixels: Uint8ClampedArray; w: number; h: number } {
  if (op === 'rotate-180') {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = ((h - 1 - y) * w + (w - 1 - x)) * 4;
        const di = (y * w + x) * 4;
        out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
      }
    }
    return { pixels: out, w, h };
  }
  if (op === 'flip-h') {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = (y * w + (w - 1 - x)) * 4;
        const di = (y * w + x) * 4;
        out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
      }
    }
    return { pixels: out, w, h };
  }
  if (op === 'flip-v') {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = ((h - 1 - y) * w + x) * 4;
        const di = (y * w + x) * 4;
        out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
      }
    }
    return { pixels: out, w, h };
  }
  // rotate cw / ccw
  const nW = h;
  const nH = w;
  const out = new Uint8ClampedArray(nW * nH * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = op === 'rotate-cw' ? h - 1 - y : y;
      const ny = op === 'rotate-cw' ? x : w - 1 - x;
      const si = (y * w + x) * 4;
      const di = (ny * nW + nx) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
    }
  }
  return { pixels: out, w: nW, h: nH };
}
