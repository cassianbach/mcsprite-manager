/**
 * Rasterize the app logo (a C of nebula stars on a dark void) into RGBA pixel
 * buffers and write them out as PNGs and a multi-size Windows ICO.
 *
 * The geometry mirrors src/renderer/src/components/Logo.tsx and the
 * electron.vite.config.ts favicon generator — all share the same seed (0xc1)
 * and the same Mulberry32 PRNG so the in-app logo, the favicon, and the
 * taskbar icon render the same starfield.
 */
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PALETTE: Array<[number, number, number]> = [
  [139, 92, 246],
  [192, 38, 211],
  [236, 72, 153],
  [59, 130, 246],
];

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerpColor(t: number): [number, number, number] {
  const c = Math.max(0, Math.min(1, t));
  for (let i = 0; i < PALETTE.length - 1; i++) {
    if (c >= i / (PALETTE.length - 1) && c <= (i + 1) / (PALETTE.length - 1)) {
      const span = 1 / (PALETTE.length - 1);
      const lt = (c - i * span) / span;
      const a = PALETTE[i];
      const b = PALETTE[i + 1];
      return [
        Math.round(a[0] + (b[0] - a[0]) * lt),
        Math.round(a[1] + (b[1] - a[1]) * lt),
        Math.round(a[2] + (b[2] - a[2]) * lt),
      ];
    }
  }
  return PALETTE[PALETTE.length - 1];
}

interface Star {
  x: number;
  y: number;
  r: number;
  op: number;
  color?: [number, number, number]; // if omitted → light gray
  isGlowCore?: boolean;
}

interface LogoScene {
  bgStars: Star[];
  bandStars: Star[];
  glows: Star[];
  cx: number;
  cy: number;
  innerR: number;
  outerR: number;
}

function generateScene(seed: number, size: number): LogoScene {
  const rand = mulberry32(seed);
  const r = (a: number, b: number) => a + rand() * (b - a);
  const gauss = () => (rand() + rand() + rand()) / 3;
  const cx = size / 2;
  const cy = size / 2;
  // Wider C-band so the bright pixels survive downsampling
  const innerR = size * 0.16;
  const outerR = size * 0.44;
  const midR = (innerR + outerR) / 2;
  const bandW = outerR - innerR;

  const bgStars: Star[] = [];
  let placed = 0;
  let attempts = 0;
  const bgTarget = 60;
  const bgMaxR = r(0.6, 1.6);
  while (placed < bgTarget && attempts < bgTarget * 5) {
    attempts++;
    const bx = r(0, size);
    const by = r(0, size);
    const d = Math.sqrt((bx - cx) ** 2 + (by - cy) ** 2);
    if (d > size * 0.49) continue;
    bgStars.push({
      x: bx,
      y: by,
      r: bgMaxR,
      op: r(0.3, 0.8),
      color: [229, 231, 235],
    });
    placed++;
  }

  // Many more band stars, larger radii — they overlap and produce a solid ring
  // of saturated color when downsampled, so the C reads at every size.
  const bandStars: Star[] = [];
  const bandCount = 1100;
  const bandRMax = r(1.4, 3.6);
  for (let i = 0; i < bandCount; i++) {
    const t = rand();
    const angleDeg = -40 - 280 * t;
    const angleRad = (angleDeg * Math.PI) / 180;
    const radius = midR + (gauss() - 0.5) * bandW * 1.4;
    const jitter = r(-18, 18);
    const px = cx + radius * Math.cos(angleRad) + jitter * Math.cos(angleRad + Math.PI / 2);
    const py = cy + radius * Math.sin(angleRad) + jitter * Math.sin(angleRad + Math.PI / 2);
    bandStars.push({
      x: px,
      y: py,
      r: bandRMax,
      op: r(0.7, 1.0),
      color: lerpColor(t),
    });
  }

  // Larger, denser glows to brighten the band after blending
  const glows: Star[] = [];
  const glowCount = 50;
  const glowRMax = r(12, 22);
  for (let i = 0; i < glowCount; i++) {
    const t = rand();
    const angleDeg = -40 - 280 * t;
    const angleRad = (angleDeg * Math.PI) / 180;
    const radius = midR + (rand() - 0.5) * bandW;
    glows.push({
      x: cx + radius * Math.cos(angleRad),
      y: cy + radius * Math.sin(angleRad),
      r: glowRMax,
      op: r(0.18, 0.34),
      color: lerpColor(t),
      isGlowCore: true,
    });
  }

  return { bgStars, bandStars, glows, cx, cy, innerR, outerR };
}

/** Sample the radial gradient background at (x, y). */
function radialBackground(x: number, y: number, cx: number, cy: number, r: number): [number, number, number] {
  const d = Math.min(1, Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r);
  // Slightly brighter than the deep-void in the renderer logo so the stars
  // pop at small icon sizes after box-filter downsampling.
  // #1d1d3c -> #13132a -> #070716
  const stops: Array<[number, [number, number, number]]> = [
    [0, [0x1d, 0x1d, 0x3c]],
    [0.6, [0x13, 0x13, 0x2a]],
    [1, [0x07, 0x07, 0x16]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (d >= t0 && d <= t1) {
      const span = t1 - t0;
      const lt = span === 0 ? 0 : (d - t0) / span;
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * lt),
        Math.round(c0[1] + (c1[1] - c0[1]) * lt),
        Math.round(c0[2] + (c1[2] - c0[2]) * lt),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

function blendScreen(bg: number, src: number, sa: number): number {
  // Blend that approximates CSS `mix-blend-mode: screen` but biased so stars
  // become near-white on dark background. This is what the renderer's
  // `mix-blend-mode: screen` produces in practice for additive-style particles
  // over a dark backdrop.
  const srcEff = (src * sa) / 255;
  const screen = 255 - ((255 - bg) * (255 - srcEff)) / 255;
  // Strong additive component so overlapping stars saturate to bright pixels.
  const additive = (src * sa) / 510;
  return Math.max(0, Math.min(255, Math.round(Math.max(screen, bg + additive))));
}

function clamp255(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

/**
 * Render the logo at a fixed internal size (256×256) so the geometry stays
 * consistent across all output sizes. Output sizes < 256 are produced by
 * box-filter downsampling — this keeps the bright pixels of the C-band
 * visible at 16×16 instead of fading to background.
 */
const INTERNAL_SIZE = 256;

/**
 * Rasterize the logo to an RGBA pixel buffer at the given size.
 *
 * Two visual designs are produced from the same scene:
 *  1. A pixel-accurate, animated-style rendering of the starfield (used when
 *     `size === INTERNAL_SIZE`).
 *  2. For icons, we use a solid-stroke "C" instead of scattered stars so the
 *     shape reads at 16×16. The C uses the same nebula palette and is rendered
 *     into the same internal buffer, then box-filter downsampled.
 */
function rasterizeStarfield(size: number, seed = 0xc1): Uint8ClampedArray {
  const scene = generateScene(seed, INTERNAL_SIZE);
  const internal = new Uint8ClampedArray(INTERNAL_SIZE * INTERNAL_SIZE * 4);
  for (let y = 0; y < INTERNAL_SIZE; y++) {
    for (let x = 0; x < INTERNAL_SIZE; x++) {
      const i = (y * INTERNAL_SIZE + x) * 4;
      const bg = radialBackground(
        x + 0.5,
        y + 0.5,
        scene.cx,
        scene.cy,
        INTERNAL_SIZE * 0.49,
      );
      internal[i] = bg[0];
      internal[i + 1] = bg[1];
      internal[i + 2] = bg[2];
      internal[i + 3] = 255;
    }
  }

  function paintStar(star: Star, withGlow: boolean, pixels: Uint8ClampedArray, size: number): void {
    const cx = Math.max(0, Math.floor(star.x - star.r));
    const cy = Math.max(0, Math.floor(star.y - star.r));
    const ex = Math.min(size, Math.ceil(star.x + star.r));
    const ey = Math.min(size, Math.ceil(star.y + star.r));
    const r2 = star.r * star.r;
    const color = star.color ?? [255, 255, 255];
    for (let y = cy; y < ey; y++) {
      for (let x = cx; x < ex; x++) {
        const dx = x + 0.5 - star.x;
        const dy = y + 0.5 - star.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const falloff = withGlow ? 1 - d2 / r2 : 1;
        const a = clamp255(255 * star.op * falloff);
        const i = (y * size + x) * 4;
        pixels[i] = clamp255(blendScreen(pixels[i], color[0], (a / 255) * (color[0] / 255)));
        pixels[i + 1] = clamp255(blendScreen(pixels[i + 1], color[1], (a / 255) * (color[1] / 255)));
        pixels[i + 2] = clamp255(blendScreen(pixels[i + 2], color[2], (a / 255) * (color[2] / 255)));
      }
    }
  }

  function paintBrightCore(star: Star, pixels: Uint8ClampedArray, size: number): void {
    const coreR = Math.max(0.6, star.r * 0.18);
    const cR2 = coreR * coreR;
    const cx = Math.max(0, Math.floor(star.x - coreR));
    const cy = Math.max(0, Math.floor(star.y - coreR));
    const ex = Math.min(size, Math.ceil(star.x + coreR));
    const ey = Math.min(size, Math.ceil(star.y + coreR));
    for (let y = cy; y < ey; y++) {
      for (let x = cx; x < ex; x++) {
        const dx = x + 0.5 - star.x;
        const dy = y + 0.5 - star.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > cR2) continue;
        const a = clamp255(255 * star.op * (1 - d2 / cR2));
        const i = (y * size + x) * 4;
        pixels[i] = clamp255(blendScreen(pixels[i], 0xfd, a / 255));
        pixels[i + 1] = clamp255(blendScreen(pixels[i + 1], 0xf4, a / 255));
        pixels[i + 2] = clamp255(blendScreen(pixels[i + 2], 0xff, a / 255));
      }
    }
  }

  for (const s of scene.bgStars) paintStar(s, false, internal, INTERNAL_SIZE);
  for (const s of scene.bandStars) paintStar(s, false, internal, INTERNAL_SIZE);
  for (const s of scene.glows) paintStar(s, true, internal, INTERNAL_SIZE);
  for (const s of scene.glows) paintBrightCore(s, internal, INTERNAL_SIZE);
  return internal;
}

/** Render a solid-stroke nebula C — used for OS icons (taskbar/Alt-Tab). */
function rasterizeIconC(size: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const ringR = size * 0.42;
  const thickness = size * 0.16; // outer − inner half-thickness

  // Background
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const bg = radialBackground(x + 0.5, y + 0.5, cx, cy, size * 0.5);
      pixels[i] = bg[0];
      pixels[i + 1] = bg[1];
      pixels[i + 2] = bg[2];
      pixels[i + 3] = 255;
    }
  }

  // Stroke thickness: outer = ringR + thickness/2, inner = ringR - thickness/2.
  // Open the C by skipping pixels inside an angular gap of `gapDeg` centered at the right side (angle = 0).
  const outerR = ringR + thickness / 2;
  const innerR = ringR - thickness / 2;
  const gapDeg = 70; // angular size of the C opening
  const gapRad = (gapDeg * Math.PI) / 180;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r < innerR - 1 || r > outerR + 1) continue;
      // Angle: 0 = right (+x), increases counter-clockwise
      let theta = Math.atan2(dy, dx);
      if (theta > Math.PI) theta -= 2 * Math.PI;
      if (theta < -Math.PI) theta += 2 * Math.PI;
      const inside = Math.abs(theta) < gapRad / 2;
      if (inside) continue;
      // Distance from the C ring center → 0 at ringR, 1 at the edges
      const distFromRing = Math.abs(r - ringR);
      const halfThick = thickness / 2;
      const t = Math.min(1, distFromRing / halfThick);
      const alpha = 1 - t * t;
      const usable = 2 * Math.PI - gapRad;
      const fromGap = theta < 0 ? -theta - gapRad / 2 : 2 * Math.PI - gapRad / 2 - theta;
      const posT = Math.max(0, Math.min(1, fromGap / usable));
      const color = lerpColor(posT);
      // Direct alpha blend so the C reads as a solid bright stroke at any size
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(pixels[i] * (1 - alpha) + color[0] * alpha);
      pixels[i + 1] = Math.round(pixels[i + 1] * (1 - alpha) + color[1] * alpha);
      pixels[i + 2] = Math.round(pixels[i + 2] * (1 - alpha) + color[2] * alpha);
    }
  }

  // Subtle highlight near the top of the C to give it dimension
  const hilightCenterY = cy - ringR * 0.85;
  const hilightR = thickness * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - hilightCenterY;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r > hilightR) continue;
      const a = (1 - r / hilightR) * 0.35;
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(pixels[i] * (1 - a) + 230 * a);
      pixels[i + 1] = Math.round(pixels[i + 1] * (1 - a) + 230 * a);
      pixels[i + 2] = Math.round(pixels[i + 2] * (1 - a) + 245 * a);
    }
  }

  return pixels;
}

/** Rasterize the logo to an RGBA pixel buffer at the given size. */
export function rasterizeLogo(size: number, seed = 0xc1): Uint8ClampedArray {
  // For the favicon / in-app display: render the starfield at full size.
  if (size === 680) {
    const starfield = rasterizeStarfield(size, seed);
    return starfield;
  }
  // For OS icons (16..256): use a solid-stroke nebula C — readable at any size.
  const c = rasterizeIconC(size);
  return c;
}

/** Box-filter downsample RGBA from srcSize×srcSize to dstSize×dstSize. */
function downsampleBox(
  src: Uint8ClampedArray,
  srcSize: number,
  _srcH: number,
  dstSize: number,
): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(dstSize * dstSize * 4);
  const scale = srcSize / dstSize;
  for (let dy = 0; dy < dstSize; dy++) {
    const y0 = Math.floor(dy * scale);
    const y1 = Math.min(srcSize, Math.ceil((dy + 1) * scale));
    for (let dx = 0; dx < dstSize; dx++) {
      const x0 = Math.floor(dx * scale);
      const x1 = Math.min(srcSize, Math.ceil((dx + 1) * scale));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * srcSize + x) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          n++;
        }
      }
      const di = (dy * dstSize + dx) * 4;
      dst[di] = Math.round(r / n);
      dst[di + 1] = Math.round(g / n);
      dst[di + 2] = Math.round(b / n);
      dst[di + 3] = 255;
    }
  }
  return dst;
}

export function encodePng(rgba: Uint8ClampedArray, width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  // pngjs data is RGBA
  for (let i = 0; i < rgba.length; i++) png.data[i] = rgba[i];
  return PNG.sync.write(png);
}

interface IconEntry {
  size: number;
  png: Buffer;
}

/**
 * Write a Windows ICO file that embeds PNG payloads (PNG-in-ICO format
 * supported since Vista). Returns the file path. Pass `forIcon: true` to use
 * the high-contrast variant designed for small OS icon sizes.
 */
export function writeIco(
  outDir: string,
  baseName: string,
  sizes: number[] = [16, 24, 32, 48, 64, 128, 256],
): string {
  mkdirSync(outDir, { recursive: true });
  const entries: IconEntry[] = sizes.map((size) => ({
    size,
    png: encodePng(rasterizeLogo(size, 0xc1), size, size),
  }));

  // ICONDIR (6 bytes) + ICONDIRENTRY (16 bytes per image) + PNG data
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(entries.length, 4);

  let dataOffset = 6 + entries.length * 16;
  const datas: Buffer[] = [];
  entries.forEach((e, i) => {
    const dim = e.size >= 256 ? 0 : e.size; // 0 means 256
    const entry = header.subarray(6 + i * 16, 6 + (i + 1) * 16);
    entry.writeUInt8(dim, 0); // width
    entry.writeUInt8(dim, 1); // height
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(e.png.length, 8); // size of image data
    entry.writeUInt32LE(dataOffset, 12); // offset
    datas.push(e.png);
    dataOffset += e.png.length;
  });

  const ico = Buffer.concat([header, ...datas]);
  const outPath = join(outDir, `${baseName}.ico`);
  writeFileSync(outPath, ico);
  return outPath;
}

/**
 * Write a multi-size icon set (PNG per size + the master ICO) into outDir.
 * Used by main process at startup so the Windows taskbar shows the logo.
 * All sizes are produced from a single 256×256 internal render via box-filter
 * downsampling so the C-band stays visible even at 16×16.
 */
export function writeAppIconSet(outDir: string): { icoPath: string; pngPaths: Record<number, string> } {
  mkdirSync(outDir, { recursive: true });
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngPaths: Record<number, string> = {};
  for (const size of sizes) {
    const buf = encodePng(rasterizeLogo(size, 0xc1), size, size);
    const p = join(outDir, `icon-${size}.png`);
    writeFileSync(p, buf);
    pngPaths[size] = p;
  }
  const icoPath = writeIco(outDir, 'icon', sizes);
  return { icoPath, pngPaths };
}
