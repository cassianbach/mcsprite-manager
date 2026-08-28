import { hexToTuple } from './canvas';

export type GlintStyle =
  | 'streaks'
  | 'hearts'
  | 'comets'
  | 'stars'
  | 'flames'
  | 'electric'
  | 'frost'
  | 'wisps';

export const GLINT_STYLES: GlintStyle[] = [
  'streaks',
  'hearts',
  'comets',
  'stars',
  'flames',
  'electric',
  'frost',
  'wisps',
];

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function styleSeed(style: GlintStyle): number {
  let h = 0x9e3779b1;
  for (let i = 0; i < style.length; i++) h = (h ^ style.charCodeAt(i)) * 0x1000193;
  return h >>> 0;
}

/**
 * Generate a translucent "enchantment glint" texture sheet. The result is mostly
 * transparent (vanilla glint is a repeating overlay), with light streaks/shapes
 * in a glint cyan tint. Tiling is seamless because marks wrap around the edges.
 */
export function generateGlint(
  size: number,
  style: GlintStyle,
  opts?: { intensity?: number; density?: number; color?: string; color2?: string },
): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4);
  const [r, g, b] = hexToTuple(opts?.color ?? '#9fc3ff');
  const [r2, g2, b2] = hexToTuple(opts?.color2 ?? opts?.color ?? '#ffffff');
  const s = size;
  const intensity = opts?.intensity ?? 1;
  const d = Math.max(0, Math.min(1, opts?.density ?? 0.5));

  const put = (x: number, y: number, a: number): void => {
    x |= 0;
    y |= 0;
    // Wrap instead of clip so marks crossing a tile edge stay seamless
    // (clipping produced transparent gaps that showed as "see-through" seams).
    x = ((x % s) + s) % s;
    y = ((y % s) + s) % s;
    const i = (y * s + x) * 4;
    const na = a * intensity;
    if (na > px[i + 3]) px[i + 3] = na;
    // Brightest marks lean toward the highlight color.
    if (a > 0.6) {
      px[i] = r2;
      px[i + 1] = g2;
      px[i + 2] = b2;
    } else {
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
    }
  };

  const rng = mulberry32(styleSeed(style));

  switch (style) {
    case 'streaks': {
      for (let n = 0; n < s * 3; n++) {
        let x = (rng() * s) | 0;
        let y = (rng() * s) | 0;
        const len = 2 + ((rng() * (s / 2)) | 0);
        for (let k = 0; k < len; k++) {
          put(x, y, 220);
          x = (x + 1) % s;
          y = (y + 1) % s;
          if (rng() < 0.35) break;
        }
      }
      break;
    }
    case 'hearts': {
      const heart = (cx: number, cy: number, a: number) => {
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 1; dy++) {
            const x = dx;
            const y = -dy;
            const heart =
              Math.pow(x * x + y * y - 1, 3) - x * x * y * y * y;
            if (heart <= 0) put(cx + dx, cy + dy, a);
          }
        }
      };
      for (let n = 0; n < s / 2; n++) {
        heart((rng() * s) | 0, (rng() * s) | 0, 200);
      }
      break;
    }
    case 'comets': {
      for (let n = 0; n < s / 2; n++) {
        let x = (rng() * s) | 0;
        let y = (rng() * s) | 0;
        const len = 4 + ((rng() * (s / 2)) | 0);
        for (let k = 0; k < len; k++) {
          put(x, y, 230 - k * (180 / len));
          x = (x + 1) % s;
          y = (y + (rng() < 0.5 ? 1 : -1) + s) % s;
        }
      }
      break;
    }
    case 'stars': {
      for (let n = 0; n < s / 2; n++) {
        const cx = (rng() * s) | 0;
        const cy = (rng() * s) | 0;
        const rad = 1 + ((rng() * 3) | 0);
        for (let k = -rad; k <= rad; k++) {
          put(cx + k, cy, 220);
          put(cx, cy + k, 220);
        }
      }
      break;
    }
    case 'flames': {
      for (let n = 0; n < s * 2; n++) {
        let x = (rng() * s) | 0;
        let y = (rng() * s) | 0;
        const len = 3 + ((rng() * (s / 3)) | 0);
        for (let k = 0; k < len; k++) {
          put(x, y, 200);
          x = (x + (rng() < 0.5 ? 1 : -1) + s) % s;
          y = (y + 1) % s;
        }
      }
      break;
    }
    case 'electric': {
      for (let n = 0; n < s; n++) {
        let x = (rng() * s) | 0;
        let y = (rng() * s) | 0;
        const len = 4 + ((rng() * (s / 2)) | 0);
        for (let k = 0; k < len; k++) {
          put(x, y, 230);
          x = (x + 1) % s;
          y = (y + (rng() < 0.5 ? 1 : -1) + s) % s;
          if (rng() < 0.3) x = (x + (rng() < 0.5 ? 1 : -1) + s) % s;
        }
      }
      break;
    }
    case 'frost': {
      for (let n = 0; n < s / 2; n++) {
        const cx = (rng() * s) | 0;
        const cy = (rng() * s) | 0;
        const len = 2 + ((rng() * 3) | 0);
        for (let k = -len; k <= len; k++) {
          put(cx + k, cy, 210);
          put(cx, cy + k, 210);
          put(cx + k, cy + k, 180);
          put(cx + k, cy - k, 180);
        }
      }
      break;
    }
    case 'wisps': {
      for (let n = 0; n < s / 3; n++) {
        const cx = (rng() * s) | 0;
        const cy = (rng() * s) | 0;
        const rad = 2 + ((rng() * 4) | 0);
        for (let dx = -rad; dx <= rad; dx++) {
          for (let dy = -rad; dy <= rad; dy++) {
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > rad) continue;
            put(cx + dx, cy + dy, 150 * (1 - d / rad));
          }
        }
      }
      break;
    }
  }

  return px;
}
