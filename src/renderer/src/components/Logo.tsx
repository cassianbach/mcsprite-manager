import { useMemo } from 'react';

/**
 * App logo: a C shape made of clustered nebula-colored stars on a dark void.
 * Pure SVG, deterministic via a Mulberry32 PRNG so it renders identically every time.
 *
 * Style references:
 *  - Background: radial gradient #12122a -> #08081a -> #020208
 *  - Star band: angle from -40deg to -320deg (i.e. wrapping past 360), innerR..outerR
 *  - Palette: violet #8b5cf6 -> magenta #c026d3 -> rose #ec4899 -> blue #3b82f6
 *  - Glow + bright cores scattered along the band
 */

const STARS = 420;
const BG_STARS = 45;
const GLOWS = 30;

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
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < PALETTE.length - 1; i++) {
    if (clamped >= i / (PALETTE.length - 1) && clamped <= (i + 1) / (PALETTE.length - 1)) {
      const span = 1 / (PALETTE.length - 1);
      const lt = (clamped - i * span) / span;
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

function rgb(c: [number, number, number]): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

interface LogoProps {
  size?: number;
  className?: string;
  /** Optional seed override (defaults to a stable value). */
  seed?: number;
}

export function Logo({ size = 64, className, seed = 0xc1 }: LogoProps): JSX.Element {
  const data = useMemo(() => {
    const rand = mulberry32(seed);
    const r = (a: number, b: number) => a + rand() * (b - a);
    const gauss = () => (rand() + rand() + rand()) / 3;

    const cx = 340;
    const cy = 340;
    const innerR = 150;
    const outerR = 250;
    const midR = (innerR + outerR) / 2;
    const bandW = outerR - innerR;

    const bgStars: Array<{ cx: number; cy: number; r: number; op: number }> = [];
    let placed = 0;
    let attempts = 0;
    while (placed < BG_STARS && attempts < BG_STARS * 5) {
      attempts++;
      const bx = r(20, 660);
      const by = r(20, 660);
      const d = Math.sqrt((bx - cx) ** 2 + (by - cy) ** 2);
      if (d > 318) continue;
      bgStars.push({ cx: bx, cy: by, r: r(0.8, 2), op: r(0.3, 0.8) });
      placed++;
    }

    const bandStars: Array<{ cx: number; cy: number; r: number; op: number; fill: string }> = [];
    for (let i = 0; i < STARS; i++) {
      const t = rand();
      const angleDeg = -40 - 280 * t;
      const angleRad = (angleDeg * Math.PI) / 180;
      const radius = midR + (gauss() - 0.5) * bandW * 1.15;
      const jitter = r(-14, 14);
      const px = cx + radius * Math.cos(angleRad) + jitter * Math.cos(angleRad + Math.PI / 2);
      const py = cy + radius * Math.sin(angleRad) + jitter * Math.sin(angleRad + Math.PI / 2);
      bandStars.push({
        cx: px,
        cy: py,
        r: r(1, 2.6),
        op: r(0.45, 0.9),
        fill: rgb(lerpColor(t)),
      });
    }

    const glows: Array<{ cx: number; cy: number; haloR: number; haloOp: number; coreR: number; coreOp: number; fill: string }> = [];
    for (let i = 0; i < GLOWS; i++) {
      const t = rand();
      const angleDeg = -40 - 280 * t;
      const angleRad = (angleDeg * Math.PI) / 180;
      const radius = midR + (rand() - 0.5) * bandW * 0.7;
      const col = lerpColor(t);
      glows.push({
        cx: cx + radius * Math.cos(angleRad),
        cy: cy + radius * Math.sin(angleRad),
        haloR: r(10, 20),
        haloOp: r(0.12, 0.22),
        coreR: r(2.2, 3.4),
        coreOp: r(0.7, 0.95),
        fill: rgb(col),
      });
    }

    return { bgStars, bandStars, glows };
  }, [seed]);

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 680 680"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="App logo: a C formed from clustered nebula-colored stars on a dark void"
      style={{ display: 'block' }}
    >
      <defs>
        <radialGradient id="logoVoid" cx="50%" cy="45%" r="65%">
          <stop offset="0%" stopColor="#12122a" />
          <stop offset="60%" stopColor="#08081a" />
          <stop offset="100%" stopColor="#020208" />
        </radialGradient>
      </defs>
      <circle cx="340" cy="340" r="320" fill="url(#logoVoid)" />
      <g>
        {data.bgStars.map((s, i) => (
          <circle
            key={`bg-${i}`}
            cx={s.cx.toFixed(1)}
            cy={s.cy.toFixed(1)}
            r={s.r.toFixed(1)}
            fill="#e5e7eb"
            opacity={s.op.toFixed(2)}
          />
        ))}
      </g>
      <g style={{ mixBlendMode: 'screen' }}>
        {data.bandStars.map((s, i) => (
          <circle
            key={`band-${i}`}
            cx={s.cx.toFixed(1)}
            cy={s.cy.toFixed(1)}
            r={s.r.toFixed(1)}
            fill={s.fill}
            opacity={s.op.toFixed(2)}
          />
        ))}
        {data.glows.map((g, i) => (
          <g key={`glow-${i}`}>
            <circle
              cx={g.cx.toFixed(1)}
              cy={g.cy.toFixed(1)}
              r={g.haloR.toFixed(1)}
              fill={g.fill}
              opacity={g.haloOp.toFixed(2)}
            />
            <circle
              cx={g.cx.toFixed(1)}
              cy={g.cy.toFixed(1)}
              r={g.coreR.toFixed(1)}
              fill="#fdf4ff"
              opacity={g.coreOp.toFixed(2)}
            />
          </g>
        ))}
      </g>
    </svg>
  );
}
