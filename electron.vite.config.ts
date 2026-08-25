import { resolve } from 'node:path';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * Generate the deterministic logo SVG used as the renderer favicon.
 * Mirrors src/renderer/src/components/Logo.tsx so the static SVG and the
 * in-app component render the same star field with the same seed.
 */
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

function generateLogoSvg(seed = 0xc1): string {
  const rand = mulberry32(seed);
  const r = (a: number, b: number) => a + rand() * (b - a);
  const gauss = () => (rand() + rand() + rand()) / 3;
  const cx = 340;
  const cy = 340;
  const innerR = 150;
  const outerR = 250;
  const midR = (innerR + outerR) / 2;
  const bandW = outerR - innerR;

  const bgStars: string[] = [];
  let placed = 0;
  let attempts = 0;
  while (placed < 45 && attempts < 45 * 5) {
    attempts++;
    const bx = r(20, 660);
    const by = r(20, 660);
    const d = Math.sqrt((bx - cx) ** 2 + (by - cy) ** 2);
    if (d > 318) continue;
    bgStars.push(
      `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="${r(0.8, 2).toFixed(1)}" fill="#e5e7eb" opacity="${r(0.3, 0.8).toFixed(2)}"/>`,
    );
    placed++;
  }

  const bandStars: string[] = [];
  for (let i = 0; i < 420; i++) {
    const t = rand();
    const angleDeg = -40 - 280 * t;
    const angleRad = (angleDeg * Math.PI) / 180;
    const radius = midR + (gauss() - 0.5) * bandW * 1.15;
    const jitter = r(-14, 14);
    const px = cx + radius * Math.cos(angleRad) + jitter * Math.cos(angleRad + Math.PI / 2);
    const py = cy + radius * Math.sin(angleRad) + jitter * Math.sin(angleRad + Math.PI / 2);
    const fill = `rgb(${lerpColor(t).join(',')})`;
    bandStars.push(
      `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r(1, 2.6).toFixed(1)}" fill="${fill}" opacity="${r(0.45, 0.9).toFixed(2)}"/>`,
    );
  }

  const glows: string[] = [];
  for (let i = 0; i < 30; i++) {
    const t = rand();
    const angleDeg = -40 - 280 * t;
    const angleRad = (angleDeg * Math.PI) / 180;
    const radius = midR + (rand() - 0.5) * bandW * 0.7;
    const fill = `rgb(${lerpColor(t).join(',')})`;
    const px = cx + radius * Math.cos(angleRad);
    const py = cy + radius * Math.sin(angleRad);
    glows.push(
      `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r(10, 20).toFixed(1)}" fill="${fill}" opacity="${r(0.12, 0.22).toFixed(2)}"/>` +
        `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r(2.2, 3.4).toFixed(1)}" fill="#fdf4ff" opacity="${r(0.7, 0.95).toFixed(2)}"/>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 680" role="img">
  <defs>
    <radialGradient id="logoVoid" cx="50%" cy="45%" r="65%">
      <stop offset="0%" stop-color="#12122a"/>
      <stop offset="60%" stop-color="#08081a"/>
      <stop offset="100%" stop-color="#020208"/>
    </radialGradient>
  </defs>
  <circle cx="340" cy="340" r="320" fill="url(#logoVoid)"/>
  ${bgStars.map((c) => `  ${c}`).join('\n')}
  <g style="mix-blend-mode:screen">
    ${bandStars.join('\n    ')}
    ${glows.join('\n    ')}
  </g>
</svg>
`;
}

function logoGeneratorPlugin() {
  return {
    name: 'logo-generator',
    buildStart() {
      const root = resolve(__dirname, 'src', 'renderer', 'public');
      if (!existsSync(root)) mkdirSync(root, { recursive: true });
      writeFileSync(resolve(root, 'logo.svg'), generateLogoSvg(0xc1));
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    plugins: [logoGeneratorPlugin(), react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
});
