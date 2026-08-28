import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStudio } from '../store/studio';
import { DEFAULT_BIOMES, generateBiomeColormaps, type BiomeDef } from '../lib/biome';
import './Studio.css';

type MapKey = 'grass' | 'foliage' | 'dryFoliage';

const MAP_LABELS: Record<MapKey, string> = {
  grass: 'Grass',
  foliage: 'Foliage',
  dryFoliage: 'Dry Foliage',
};

const CLIMATE: Record<string, 'Temperate' | 'Warm' | 'Humid' | 'Cold' | 'Dry'> = {
  'minecraft:plains': 'Temperate',
  'minecraft:sunflower_plains': 'Temperate',
  'minecraft:forest': 'Temperate',
  'minecraft:flower_forest': 'Temperate',
  'minecraft:birch_forest': 'Temperate',
  'minecraft:dark_forest': 'Temperate',
  'minecraft:beach': 'Temperate',
  'minecraft:river': 'Temperate',
  'minecraft:ocean': 'Temperate',
  'minecraft:cherry_grove': 'Temperate',
  'minecraft:meadow': 'Temperate',
  'minecraft:pale_garden': 'Temperate',
  'minecraft:jungle': 'Warm',
  'minecraft:bamboo_jungle': 'Warm',
  'minecraft:sparse_jungle': 'Warm',
  'minecraft:mushroom_fields': 'Warm',
  'minecraft:taiga': 'Cold',
  'minecraft:old_growth_pine_taiga': 'Cold',
  'minecraft:old_growth_spruce_taiga': 'Cold',
  'minecraft:snowy_plains': 'Cold',
  'minecraft:snowy_tundra': 'Cold',
  'minecraft:snowy_beach': 'Cold',
  'minecraft:windswept_hills': 'Cold',
  'minecraft:stony_shore': 'Cold',
  'minecraft:frozen_river': 'Cold',
  'minecraft:desert': 'Dry',
  'minecraft:savanna': 'Dry',
  'minecraft:savanna_plateau': 'Dry',
  'minecraft:badlands': 'Dry',
  'minecraft:eroded_badlands': 'Dry',
  'minecraft:wooded_badlands': 'Dry',
  'minecraft:nether_wastes': 'Dry',
  'minecraft:swamp': 'Humid',
  'minecraft:mangrove_swamp': 'Humid',
};

const AFFECTED = [
  'Grass Block',
  'Short Grass',
  'Fern',
  'Tall Grass',
  'Large Fern',
  'Grass Side Overlay',
  'Sugar Cane',
  'Vines',
  'Oak Leaves',
  'Jungle Leaves',
  'Acacia Leaves',
  'Dark Oak Leaves',
  'Mangrove Leaves',
  'Bush',
  'Leaf Litter',
];

const CLIMATE_ORDER: Array<'Temperate' | 'Warm' | 'Humid' | 'Cold' | 'Dry'> = [
  'Temperate',
  'Warm',
  'Humid',
  'Cold',
  'Dry',
];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function biomeCoords(b: BiomeDef) {
  const at = clamp01(b.temperature);
  const ad = clamp01(b.downfall) * at;
  return { x: Math.round((1 - at) * 255), y: Math.round((1 - ad) * 255) };
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(clamp01(v / 255) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function encodeRGBA(data: Uint8ClampedArray, size = 256): string {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), size, size), 0, 0);
  return c.toDataURL('image/png');
}

function Section(props: {
  title: string;
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  return (
    <div className={`section ${open ? 'open' : ''}`}>
      <div className="section-head" onClick={() => setOpen((o) => !o)}>
        <span className="caret">▶</span>
        <span className="title">{props.title}</span>
        {props.meta != null && <span className="meta">{props.meta}</span>}
      </div>
      {open && <div className="section-body">{props.children}</div>}
    </div>
  );
}

export default function BiomeTintStudio() {
  const { id: projectId = '' } = useParams();
  const studio = useStudio<{
    biomes: BiomeDef[];
    grass: string;
    foliage: string;
    dryFoliage: string;
  }>(projectId, 'biome');

  const [biomes, setBiomes] = useState<BiomeDef[]>(() => {
    const saved = studio.data?.biomes as BiomeDef[] | undefined;
    return saved ? saved.map((b) => ({ ...b })) : DEFAULT_BIOMES.map((b) => ({ ...b }));
  });
  const [mapKey, setMapKey] = useState<MapKey>('grass');
  const [selected, setSelected] = useState(biomes[0]?.id ?? '');
  const [link, setLink] = useState(false);

  const didInit = useRef(false);
  useEffect(() => {
    if (studio.data && !didInit.current) {
      const saved = studio.data.biomes as BiomeDef[] | undefined;
      if (Array.isArray(saved) && saved.length) {
        setBiomes(saved.map((b) => ({ ...b })));
      }
      didInit.current = true;
    }
  }, [studio.data]);

  const colormaps = useMemo(() => generateBiomeColormaps(biomes), [biomes]);
  const current = biomes.find((b) => b.id === selected) ?? biomes[0];

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(colormaps[mapKey]), 256, 256), 0, 0);
    if (current) {
      const { x, y } = biomeCoords(current);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 3, y - 3, 7, 7);
    }
  }, [colormaps, mapKey, current]);

  useEffect(() => {
    const canvas = mapRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(0, 0, W, H);
    for (const b of biomes) {
      const { x, y } = biomeCoords(b);
      const mx = (x / 255) * (W - 12) + 6;
      const my = (y / 255) * (H - 12) + 6;
      ctx.fillStyle = b.grass;
      ctx.beginPath();
      ctx.arc(mx, my, b.id === selected ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      if (b.id === selected) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }, [biomes, selected]);

  function setColor(field: MapKey, hex: string) {
    setBiomes((prev) =>
      prev.map((b) => {
        if (b.id !== selected) return b;
        if (link) return { ...b, grass: hex, foliage: hex, dryFoliage: hex };
        return { ...b, [field]: hex };
      }),
    );
  }

  function onHsl(axis: 0 | 1 | 2, value: number) {
    const [r, g, b] = hexToRgb(current[mapKey]);
    const [h, s, l] = rgbToHsl(r, g, b);
    const next = axis === 0 ? [value, s, l] : axis === 1 ? [h, value, l] : [h, s, value];
    setColor(mapKey, rgbToHex(...(hslToRgb(next[0], next[1], next[2]) as [number, number, number])));
  }

  function onMapClick(e: React.MouseEvent) {
    const canvas = mapRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * (canvas.width - 12) + 6;
    const my = ((e.clientY - rect.top) / rect.height) * (canvas.height - 12) + 6;
    let best = biomes[0];
    let bestD = Infinity;
    for (const b of biomes) {
      const { x, y } = biomeCoords(b);
      const bx = (x / 255) * (canvas.width - 12) + 6;
      const by = (y / 255) * (canvas.height - 12) + 6;
      const d = (bx - mx) ** 2 + (by - my) ** 2;
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    setSelected(best.id);
  }

  function resetBiome() {
    const def = DEFAULT_BIOMES.find((b) => b.id === selected);
    if (def) setBiomes((prev) => prev.map((b) => (b.id === selected ? { ...def } : b)));
  }

  function resetAll() {
    setBiomes(DEFAULT_BIOMES.map((b) => ({ ...b })));
  }

  async function save() {
    await studio.set({
      biomes,
      grass: encodeRGBA(colormaps.grass),
      foliage: encodeRGBA(colormaps.foliage),
      dryFoliage: encodeRGBA(colormaps.dryFoliage),
    });
  }

  const [h, s, l] = rgbToHsl(...(hexToRgb(current[mapKey]) as [number, number, number]));

  const groups = CLIMATE_ORDER.map((name) => ({
    name,
    items: biomes.filter((b) => CLIMATE[b.id] === name),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="studio">
      <aside className="studio-side">
        <Section
          title="Biomes"
          meta={<span className="count">{biomes.length}</span>}
        >
          <div className="lab-list">
            {groups.map((g) => (
              <div key={g.name}>
                <div className="lab-cat">
                  {g.name} <span className="count">{g.items.length}</span>
                </div>
                {g.items.map((b) => (
                  <button
                    key={b.id}
                    className={`lab-row ${b.id === selected ? 'selected' : ''}`}
                    onClick={() => setSelected(b.id)}
                  >
                    <span className="dot" style={{ background: b[mapKey] }} />
                    <span className="name">{b.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Saved presets" defaultOpen={false}>
          <p className="hint" style={{ marginTop: 0 }}>
            Save a set of biome tints to reuse it later.
          </p>
          <div className="pill-row">
            <button className="pill" disabled>
              + Save preset
            </button>
          </div>
        </Section>

        <Section title="Overworld" meta="click to pick">
          <canvas
            ref={mapRef}
            width={220}
            height={140}
            className="overworld-canvas"
            onClick={onMapClick}
            style={{ width: '100%', cursor: 'crosshair', borderRadius: 6, border: '1px solid var(--line)' }}
          />
          <p className="hint" style={{ marginTop: 8 }}>
            Click a region to pick that biome.
          </p>
        </Section>
      </aside>

      <section className="studio-main">
        <header className="studio-head">
          <div>
            <h2>Biome Tint Lab</h2>
            <p className="lab-sub">{current.label}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="seg small">
              <button className="seg-btn active">Java</button>
              <button className="seg-btn">Bedrock</button>
            </div>
            <button className="pill ghost" title="Open in pixel editor">
              Open in editor
            </button>
          </div>
        </header>

        <div className="tabs">
          {(['grass', 'foliage', 'dryFoliage'] as MapKey[]).map((k) => (
            <button
              key={k}
              className={`tab ${mapKey === k ? 'active' : ''}`}
              onClick={() => setMapKey(k)}
            >
              {MAP_LABELS[k]}.png
              {mapKey === k && (
                <span
                  className="reset"
                  title="Reset"
                  onClick={(e) => {
                    e.stopPropagation();
                    resetBiome();
                  }}
                >
                  ↺
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="studio-cols">
          <div className="panel">
            <div className="panel-title">{MAP_LABELS[mapKey]}.png colormap</div>
            <canvas ref={canvasRef} width={256} height={256} className="colormap-canvas" />
            <div className="hint">
              {current.label} · temp {current.temperature} · downfall {current.downfall}
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">Recolor this biome</div>
            <div className="swatch-row" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span className="swatch" style={{ background: current[mapKey], width: 28, height: 28, borderRadius: 6, border: '1px solid var(--line)' }} />
              <code>{current[mapKey]}</code>
            </div>
            <label className="slider-row">
              <span>Hue</span>
              <input type="range" min={0} max={360} value={h} onChange={(e) => onHsl(0, Number(e.target.value))} />
              <em className="val">{Math.round(h)}°</em>
            </label>
            <label className="slider-row">
              <span>Sat</span>
              <input type="range" min={0} max={100} value={s} onChange={(e) => onHsl(1, Number(e.target.value))} />
              <em className="val">{Math.round(s)}%</em>
            </label>
            <label className="slider-row">
              <span>Light</span>
              <input type="range" min={0} max={100} value={l} onChange={(e) => onHsl(2, Number(e.target.value))} />
              <em className="val">{Math.round(l)}%</em>
            </label>
            <div className="color-row-line" style={{ marginTop: 10 }}>
              <span>Pick color</span>
              <input type="color" value={current[mapKey]} onChange={(e) => setColor(mapKey, e.target.value)} />
            </div>
            <label className="apply-item" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} />
              Link grass + foliage
            </label>
            <div className="pill-row">
              <button className="pill" onClick={resetBiome}>
                Reset biome
              </button>
              <button className="pill" onClick={resetAll}>
                Reset all
              </button>
              <button className="pill primary" onClick={save}>
                Save changes
              </button>
            </div>
          </div>
        </div>

        <Section title={`What actually changes — ${current.label}`} meta="compare all to vanilla">
          <p className="hint" style={{ marginTop: 0 }}>
            Every texture your tints move. Writes the colormaps into your pack like any other texture.
          </p>
          <div className="affected-grid">
            {AFFECTED.map((name) => (
              <div key={name} className="affected-item">
                {name}
              </div>
            ))}
          </div>
        </Section>
      </section>
    </div>
  );
}
