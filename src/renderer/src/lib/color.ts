export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function rgbaToHex({ r, g, b, a }: RGBA): string {
  const to2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + to2(r) + to2(g) + to2(b) + (a < 255 ? to2(a) : '');
}

export function hexToRgba(hex: string): RGBA {
  let s = hex.trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (s.length === 6) s += 'ff';
  if (s.length !== 8) return { r: 0, g: 0, b: 0, a: 255 };
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
    a: parseInt(s.slice(6, 8), 16),
  };
}

export function isTransparent(pixels: Uint8ClampedArray, x: number, y: number, w: number): boolean {
  return pixels[(y * w + x) * 4 + 3] === 0;
}

export function packRGBA({ r, g, b, a }: RGBA): [number, number, number, number] {
  return [r, g, b, a];
}
