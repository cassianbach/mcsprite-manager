import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStudio } from '../store/studio';
import { generateGlint, GLINT_STYLES, type GlintStyle } from '../lib/glint';
import { hexToTuple } from '../lib/canvas';
import { useTranslate, translateLabelWith } from '../i18n';
import { useSettings } from '../store/settings';
import type { StudioFile } from '../../../shared/types';
import './Studio.css';

type Mode = 'peritem' | 'global';
type Cat = 'Melee' | 'Tools' | 'Armor' | 'Ranged' | 'Universal' | 'Curses';
type Size = 16 | 32 | 64;

interface GlintDesign {
  style: GlintStyle;
  size: Size;
  color: string;
  highlight: string;
  intensity: number;
  layerOpacity: number;
  rotation: number;
  drawing?: number[];
  useDrawing?: boolean;
}

interface GlintData {
  mode: Mode;
  global: GlintDesign;
  designs: Record<string, GlintDesign>;
  enabled: string[];
  applies: Record<string, string[]>;
  files: StudioFile[];
}

const MAT = ['netherite', 'diamond', 'golden', 'iron', 'stone', 'wooden', 'copper'];
const swords = MAT.map((m) => `${m}_sword`);
const tool = (t: string) => MAT.map((m) => `${m}_${t}`);
const tools = [...tool('pickaxe'), ...tool('axe'), ...tool('shovel'), ...tool('hoe')];
const ARM_MAT = ['netherite', 'diamond', 'golden', 'iron', 'chainmail', 'leather'];
const armorPart = (p: string) => ARM_MAT.map((m) => `${m}_${p}`);
const armors = [
  ...armorPart('helmet'),
  ...armorPart('chestplate'),
  ...armorPart('leggings'),
  ...armorPart('boots'),
  'elytra',
];
const ranged = ['bow', 'crossbow', 'trident'];
const universal = [
  ...swords,
  ...tools,
  ...armors,
  ...ranged,
  'enchanted_book',
  'book',
  'fishing_rod',
  'shield',
  'carrot_on_a_stick',
  'warped_fungus_on_a_stick',
];

interface Ench {
  id: string;
  label: string;
  cat: Cat;
  items: string[];
}

const ENCHANTMENTS: Ench[] = [
  { id: 'bane_of_arthropods', label: 'Bane of Arthropods', cat: 'Melee', items: [...swords, 'mace'] },
  { id: 'breach', label: 'Breach', cat: 'Melee', items: [...swords, 'mace'] },
  { id: 'density', label: 'Density', cat: 'Melee', items: [...swords, 'mace'] },
  { id: 'fire_aspect', label: 'Fire Aspect', cat: 'Melee', items: [...swords, 'mace'] },
  { id: 'knockback', label: 'Knockback', cat: 'Melee', items: [...swords, 'mace'] },
  { id: 'looting', label: 'Looting', cat: 'Melee', items: [...swords, 'mace'] },
  { id: 'sharpness', label: 'Sharpness', cat: 'Melee', items: [...swords, 'mace'] },
  { id: 'smite', label: 'Smite', cat: 'Melee', items: [...swords, 'mace'] },
  { id: 'sweeping_edge', label: 'Sweeping Edge', cat: 'Melee', items: [...swords] },
  { id: 'wind_burst', label: 'Wind Burst', cat: 'Melee', items: [...swords, 'mace'] },
  { id: 'efficiency', label: 'Efficiency', cat: 'Tools', items: tools },
  { id: 'fortune', label: 'Fortune', cat: 'Tools', items: tools },
  { id: 'silk_touch', label: 'Silk Touch', cat: 'Tools', items: tools },
  { id: 'aqua_affinity', label: 'Aqua Affinity', cat: 'Armor', items: armors },
  { id: 'blast_protection', label: 'Blast Protection', cat: 'Armor', items: armors },
  { id: 'depth_strider', label: 'Depth Strider', cat: 'Armor', items: armors },
  { id: 'feather_falling', label: 'Feather Falling', cat: 'Armor', items: armors },
  { id: 'fire_protection', label: 'Fire Protection', cat: 'Armor', items: armors },
  { id: 'frost_walker', label: 'Frost Walker', cat: 'Armor', items: armors },
  { id: 'projectile_protection', label: 'Projectile Protection', cat: 'Armor', items: armors },
  { id: 'protection', label: 'Protection', cat: 'Armor', items: armors },
  { id: 'respiration', label: 'Respiration', cat: 'Armor', items: armors },
  { id: 'soul_speed', label: 'Soul Speed', cat: 'Armor', items: armors },
  { id: 'swift_sneak', label: 'Swift Sneak', cat: 'Armor', items: armors },
  { id: 'thorns', label: 'Thorns', cat: 'Armor', items: armors },
  { id: 'channeling', label: 'Channeling', cat: 'Ranged', items: ranged },
  { id: 'flame', label: 'Flame', cat: 'Ranged', items: ranged },
  { id: 'impaling', label: 'Impaling', cat: 'Ranged', items: ranged },
  { id: 'infinity', label: 'Infinity', cat: 'Ranged', items: ranged },
  { id: 'loyalty', label: 'Loyalty', cat: 'Ranged', items: ranged },
  { id: 'luck_of_the_sea', label: 'Luck of the Sea', cat: 'Ranged', items: ['fishing_rod'] },
  { id: 'lure', label: 'Lure', cat: 'Ranged', items: ['fishing_rod'] },
  { id: 'multishot', label: 'Multishot', cat: 'Ranged', items: ['crossbow'] },
  { id: 'piercing', label: 'Piercing', cat: 'Ranged', items: ['crossbow'] },
  { id: 'power', label: 'Power', cat: 'Ranged', items: ['bow'] },
  { id: 'punch', label: 'Punch', cat: 'Ranged', items: ['bow'] },
  { id: 'quick_charge', label: 'Quick Charge', cat: 'Ranged', items: ['crossbow'] },
  { id: 'riptide', label: 'Riptide', cat: 'Ranged', items: ['trident'] },
  { id: 'mending', label: 'Mending', cat: 'Universal', items: universal },
  { id: 'unbreaking', label: 'Unbreaking', cat: 'Universal', items: universal },
  { id: 'curse_of_binding', label: 'Curse of Binding', cat: 'Curses', items: universal },
  { id: 'curse_of_vanishing', label: 'Curse of Vanishing', cat: 'Curses', items: universal },
];

const CATS: Cat[] = ['Melee', 'Tools', 'Armor', 'Ranged', 'Universal', 'Curses'];
const DIRECTIONS = [45, 90, 0, 135]; // ↗ ↘ → ↓ (grid order)

const DEFAULT_DESIGN: GlintDesign = {
  style: 'streaks',
  size: 32,
  color: '#9fc3ff',
  highlight: '#ffffff',
  intensity: 90,
  layerOpacity: 100,
  rotation: 0,
};

function defaultData(): GlintData {
  return {
    mode: 'peritem',
    global: { ...DEFAULT_DESIGN },
    designs: {},
    enabled: [],
    applies: {},
    files: [],
  };
}

// Nearest-neighbour upscale so a 16/32 design exports as a crisp 64×64 sheet
// (matching vanilla's glint size); otherwise MC stretches the small texture.
function upscaleGlint(px: Uint8ClampedArray, from: number, to: number): Uint8ClampedArray {
  if (to === from) return px;
  const out = new Uint8ClampedArray(to * to * 4);
  const scale = to / from;
  for (let y = 0; y < to; y++) {
    const sy = Math.min(from - 1, (y / scale) | 0);
    for (let x = 0; x < to; x++) {
      const sx = Math.min(from - 1, (x / scale) | 0);
      const si = (sy * from + sx) * 4;
      const oi = (y * to + x) * 4;
      out[oi] = px[si];
      out[oi + 1] = px[si + 1];
      out[oi + 2] = px[si + 2];
      out[oi + 3] = px[si + 3];
    }
  }
  return out;
}

function sheetFromPixels(px: Uint8ClampedArray, d: GlintDesign): string {
  const lo = Math.max(0, Math.min(1, d.layerOpacity / 100));
  const buf = new Uint8ClampedArray(px);
  if (lo < 1) {
    for (let i = 3; i < buf.length; i += 4) buf[i] = Math.round(buf[i] * lo);
  }
  const src = document.createElement('canvas');
  src.width = src.height = 64;
  src.getContext('2d')!.putImageData(new ImageData(buf, 64, 64), 0, 0);

  const rot = d.rotation || 0;
  if (!rot) return src.toDataURL('image/png');

  const out = document.createElement('canvas');
  out.width = out.height = 64;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(32, 32);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.translate(-32, -32);
  ctx.drawImage(src, 0, 0);
  return out.toDataURL('image/png');
}

function renderSheet(d: GlintDesign): string {
  if (d.drawing && d.useDrawing && d.drawing.length === 64 * 64 * 4) {
    return sheetFromPixels(new Uint8ClampedArray(d.drawing), d);
  }
  let px = generateGlint(d.size, d.style, {
    intensity: d.intensity / 100,
    density: 0.5,
    color: d.color,
    color2: d.highlight,
  });
  // Always emit a 64×64 sheet to match vanilla (prevents in-game stretching).
  px = upscaleGlint(px, d.size, 64);
  return sheetFromPixels(px, d);
}

// Items that render as a "held" tool in-hand use the handheld parent so the
// overlay shares the item's orientation; everything else uses generated.
function glintOverlayParent(item: string): string {
  if (/(sword|pickaxe|axe|shovel|hoe|bow|crossbow|trident|rod|stick|shield|carrot|warped_fungus|brush|mace|spyglass|elytra|fishing)$/.test(item)) {
    return 'minecraft:item/handheld';
  }
  return 'minecraft:item/generated';
}

function safeId(id: string): string {
  return id.replace(/[^a-z0-9_]/gi, '_');
}

// Per-enchantment glint in a pure Java resource pack is done with a composite
// item model: when the enchantment is present we draw a glint-texture overlay
// on top of the base item model. (True animated per-enchant glints require a
// datapack; this gives a reliable per-enchant overlay using only a resource pack.)
function itemModelJson(item: string, enchants: string[]): string {
  const overlayModels = enchants.map((id) => ({
    type: 'minecraft:condition',
    property: 'minecraft:component',
    predicate: 'minecraft:enchantments',
    value: [{ enchantments: `minecraft:${id}`, levels: { min: 1 } }],
    on_true: { type: 'minecraft:model', model: `minecraft:item/mcsprite_glint_${safeId(id)}` },
    on_false: { type: 'minecraft:empty' },
  }));
  return JSON.stringify(
    {
      model: {
        type: 'minecraft:composite',
        models: [...overlayModels, { type: 'minecraft:model', model: `minecraft:item/${item}` }],
      },
    },
    null,
    2,
  );
}

function glintOverlayModelJson(enchantId: string, sampleItem: string): string {
  return JSON.stringify(
    {
      parent: glintOverlayParent(sampleItem),
      textures: { layer0: `mcsprite:glint/${enchantId}` },
    },
    null,
    2,
  );
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

const PAINTER_SIZE = 64;

function GlintPainter({
  seed,
  baseColor,
  onCommit,
}: {
  seed?: number[];
  baseColor: string;
  onCommit: (px: number[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufRef = useRef<Uint8ClampedArray>(new Uint8ClampedArray(PAINTER_SIZE * PAINTER_SIZE * 4));
  const drawingRef = useRef(false);
  const [brush, setBrush] = useState(2);
  const [erase, setErase] = useState(false);
  const [color, setColor] = useState(baseColor);

  const repaint = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(bufRef.current), PAINTER_SIZE, PAINTER_SIZE), 0, 0);
  };

  useEffect(() => {
    const buf = bufRef.current;
    if (seed && seed.length === PAINTER_SIZE * PAINTER_SIZE * 4) {
      for (let i = 0; i < buf.length; i++) buf[i] = seed[i];
    } else {
      buf.fill(0);
    }
    repaint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const cellFromEvent = (e: React.PointerEvent): [number, number] => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * PAINTER_SIZE);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * PAINTER_SIZE);
    return [Math.max(0, Math.min(PAINTER_SIZE - 1, x)), Math.max(0, Math.min(PAINTER_SIZE - 1, y))];
  };

  const paintAt = (cx: number, cy: number) => {
    const buf = bufRef.current;
    const [r, g, b] = hexToTuple(color);
    const a = erase ? 0 : 210;
    const rad = Math.max(0, brush - 1);
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= PAINTER_SIZE || y >= PAINTER_SIZE) continue;
        const i = (y * PAINTER_SIZE + x) * 4;
        buf[i] = r;
        buf[i + 1] = g;
        buf[i + 2] = b;
        buf[i + 3] = a;
      }
    }
  };

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const [x, y] = cellFromEvent(e);
    paintAt(x, y);
    repaint();
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const [x, y] = cellFromEvent(e);
    paintAt(x, y);
    repaint();
  };
  const onUp = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onCommit(Array.from(bufRef.current));
  };
  const clearAll = () => {
    bufRef.current.fill(0);
    repaint();
    onCommit(Array.from(bufRef.current));
  };

  return (
    <div className="glint-painter">
      <canvas
        ref={canvasRef}
        width={PAINTER_SIZE}
        height={PAINTER_SIZE}
        className="glint-canvas"
        style={{
          imageRendering: 'pixelated',
          width: 240,
          height: 240,
          cursor: 'crosshair',
          border: '1px solid var(--line)',
          borderRadius: 6,
          background:
            'repeating-conic-gradient(#222 0% 25%, #333 0% 50%) 50% / 16px 16px',
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      />
      <div className="painter-controls">
        <label className="color-row-line">
          <span>Glint color</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        <div className="seg small">
          {[1, 2, 3].map((b) => (
            <button key={b} className={`seg-btn ${brush === b ? 'active' : ''}`} onClick={() => setBrush(b)}>
              {b}px
            </button>
          ))}
        </div>
        <label className="apply-item">
          <input type="checkbox" checked={erase} onChange={(e) => setErase(e.target.checked)} /> Eraser
        </label>
        <button className="pill" onClick={clearAll}>
          Clear
        </button>
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        Paint your own glint marks. Transparent pixels stay clear; darker/lighter shades add depth.
      </p>
    </div>
  );
}

export default function GlintStudio() {
  const t = useTranslate();
  const lang = useSettings((s) => s.language ?? 'en');
  const { id: projectId = '' } = useParams();
  const studio = useStudio<GlintData>(projectId, 'glint');
  const [state, setState] = useState<GlintData>(defaultData);
  const didInit = useRef(false);

  useEffect(() => {
    if (studio.data && !didInit.current) {
      const d = studio.data as GlintData;
      // If the user designed glints but never ticked "in pack", fold the
      // designed enchantments into `enabled` so they actually export.
      let next: GlintData = d;
      if (
        d.mode === 'peritem' &&
        d.enabled.length === 0 &&
        d.designs &&
        Object.keys(d.designs).length > 0
      ) {
        const enabled = Object.keys(d.designs);
        const applies = { ...d.applies };
        for (const id of enabled) {
          if (!applies[id]) {
            const e = ENCHANTMENTS.find((x) => x.id === id);
            if (e) applies[id] = e.items;
          }
        }
        next = { ...d, enabled, applies };
      }
      setState(next);
      didInit.current = true;
    }
  }, [studio.data]);

  const [selected, setSelected] = useState<string>('fire_aspect');
  const [animate, setAnimate] = useState(false);

  const mode = state.mode;
  const designFor = (id: string | null): GlintDesign =>
    id && state.designs[id] ? state.designs[id] : state.global;
  const [cur, setCur] = useState<GlintDesign>(DEFAULT_DESIGN);

  useEffect(() => {
    setCur(designFor(mode === 'peritem' ? selected : null));
  }, [state.global, state.designs, selected, mode]);

  const setDesign = (patch: Partial<GlintDesign>) => {
    setCur((c) => {
      const next = { ...c, ...patch };
      setState((s) => {
        if (mode === 'global') return { ...s, global: next };
        // Editing a per-enchantment design implies you want it in the pack.
        const enabled = s.enabled.includes(selected) ? s.enabled : [...s.enabled, selected];
        const applies = { ...s.applies };
        if (!applies[selected]) {
          const e = ENCHANTMENTS.find((x) => x.id === selected);
          if (e) applies[selected] = e.items;
        }
        return { ...s, designs: { ...s.designs, [selected]: next }, enabled, applies };
      });
      return next;
    });
  };

  const sheet = useMemo(() => renderSheet(cur), [cur]);
  const sheetPx = useMemo(() => {
    if (cur.drawing && cur.useDrawing && cur.drawing.length === 64 * 64 * 4) {
      return new Uint8ClampedArray(cur.drawing);
    }
    const px = generateGlint(cur.size, cur.style, {
      intensity: cur.intensity / 100,
      density: 0.5,
      color: cur.color,
      color2: cur.highlight,
    });
    return upscaleGlint(px, cur.size, 64);
  }, [cur]);

  const currentEnch = ENCHANTMENTS.find((e) => e.id === selected);
  const appliesTo = (state.applies[selected] ?? currentEnch?.items ?? []) as string[];

  function toggleEnabled(id: string) {
    setState((s) => {
      const enabled = s.enabled.includes(id)
        ? s.enabled.filter((x) => x !== id)
        : [...s.enabled, id];
      const applies = { ...s.applies };
      if (!enabled.includes(id)) delete applies[id];
      else if (!applies[id]) {
        const e = ENCHANTMENTS.find((x) => x.id === id);
        if (e) applies[id] = e.items;
      }
      return { ...s, enabled, applies };
    });
  }

  function toggleApply(item: string) {
    setState((s) => {
      const base = s.applies[selected] ?? currentEnch?.items ?? [];
      const next = base.includes(item) ? base.filter((x) => x !== item) : [...base, item];
      return { ...s, applies: { ...s.applies, [selected]: next } };
    });
  }

  function randomize() {
    const style = GLINT_STYLES[(Math.random() * GLINT_STYLES.length) | 0];
    const hue = (Math.random() * 360) | 0;
    const color = `hsl(${hue}, 85%, 70%)`;
    setDesign({ style, color, useDrawing: false });
  }

  function buildFiles(s: GlintData): StudioFile[] {
    if (s.mode === 'global') {
      return [{ path: 'assets/minecraft/textures/misc/enchanted_glint_item.png', dataUrl: renderSheet(s.global) }];
    }
    const files: StudioFile[] = [];
    const itemGlints: Record<string, string[]> = {};
    for (const e of ENCHANTMENTS) {
      if (!s.enabled.includes(e.id)) continue;
      const d = s.designs[e.id] ?? s.global;
      files.push({ path: `assets/mcsprite/textures/glint/${e.id}.png`, dataUrl: renderSheet(d) });
      files.push({
        path: `assets/minecraft/models/item/mcsprite_glint_${safeId(e.id)}.json`,
        json: glintOverlayModelJson(e.id, e.items[0] ?? 'diamond_sword'),
      });
      const items = s.applies[e.id] ?? e.items;
      for (const it of items) (itemGlints[it] ||= []).push(e.id);
    }
    for (const [item, enchants] of Object.entries(itemGlints)) {
      files.push({ path: `assets/minecraft/items/${item}.json`, json: itemModelJson(item, enchants) });
    }
    return files;
  }

  async function save() {
    await studio.set({ ...state, files: buildFiles(state) });
  }

  const inPack = state.enabled.includes(selected);
  const d = cur;

  return (
    <div className="studio">
      <aside className="studio-side">
        <Section
          title="Enchantments"
          meta={
            <span className="count">
              {state.enabled.length} of {ENCHANTMENTS.length}
            </span>
          }
        >
          <div className="seg small" style={{ marginBottom: 8 }}>
            <button
              className={`seg-btn ${mode === 'peritem' ? 'active' : ''}`}
              onClick={() => setState((s) => ({ ...s, mode: 'peritem' }))}
            >
              {t('glint.mode.peritem')}
            </button>
            <button
              className={`seg-btn ${mode === 'global' ? 'active' : ''}`}
              onClick={() => setState((s) => ({ ...s, mode: 'global' }))}
            >
              {t('glint.mode.global')}
            </button>
          </div>

          <div className="lab-list">
            {CATS.map((cat) => {
              const list = ENCHANTMENTS.filter((e) => e.cat === cat);
              return (
                <div key={cat}>
                  <div className="lab-cat">
                    {translateLabelWith(lang, 'biomeCategory', cat, cat)} <span className="count">{list.length}</span>
                  </div>
                  {list.map((e) => (
                    <div
                      key={e.id}
                      className={`lab-row ${selected === e.id ? 'selected' : ''}`}
                      onClick={() => setSelected(e.id)}
                    >
                      <span className="name">{translateLabelWith(lang, 'enchantment', e.id, e.label)}</span>
                      <label
                        className="in-pack"
                        title={t('glint.includeInPackTitle')}
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={state.enabled.includes(e.id)}
                          onChange={() => toggleEnabled(e.id)}
                        />
                        in pack
                      </label>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="pill-row">
            <button
              className="pill"
              onClick={() =>
                setState((s) => ({
                  ...s,
                  enabled: ENCHANTMENTS.map((e) => e.id),
                  applies: Object.fromEntries(
                    ENCHANTMENTS.map((e) => [e.id, e.items]),
                  ),
                }))
              }
            >
              Add all {ENCHANTMENTS.length} enchantments
            </button>
          </div>
        </Section>

        <Section title={t('glint.section.global')} meta={t('glint.meta.default')} defaultOpen={mode === 'global'}>
          <p className="hint" style={{ marginTop: 0 }}>
            {t('glint.globalHint')}
          </p>
          {mode === 'global' && (
            <div className="color-row-line">
              <span>{t('glint.mainColor')}</span>
              <input type="color" value={d.color} onChange={(e) => setDesign({ color: e.target.value })} />
            </div>
          )}
        </Section>

        {state.enabled.length > 0 && (
          <Section title={t('glint.section.myDesigns')} meta={t('glint.meta.inPack', { n: state.enabled.length })}>
            <div className="lab-list">
              {state.enabled.map((id) => {
                const e = ENCHANTMENTS.find((x) => x.id === id)!;
                return (
                  <div
                    key={id}
                    className={`lab-row ${selected === id ? 'selected' : ''}`}
                    onClick={() => setSelected(id)}
                  >
                    <span className="dot" style={{ background: (state.designs[id] ?? state.global).color }} />
                    <span className="name">{e.label}</span>
                    <span className="count">✓</span>
                  </div>
                );
              })}
            </div>
          </Section>
        )}
      </aside>

      <section className="studio-main">
        <header className="studio-head">
          <div>
            <h2>{t('glint.labTitle')}</h2>
            <p className="lab-sub">
              {t('glint.labSubtitle')}
            </p>
          </div>
            <span className="lab-meta">Java 1.21.4+</span>
        </header>

        {mode === 'peritem' && state.enabled.length === 0 && (
          <div className="warn-banner">
            Nothing is in the pack yet. Edit any enchantment's glint above (or click{' '}
            <strong>Add all</strong>) and it will be included on export.
          </div>
        )}

        <div className="studio-cols">
          <div className="panel">
            <div className="panel-title">
              {mode === 'global' ? t('glint.draftTitleGlobal') : t('glint.draftTitle', { name: currentEnch ? translateLabelWith(lang, 'enchantment', currentEnch.id, currentEnch.label) : t('glint.thisEnchantment') })}
            </div>
            <canvas
              ref={(c) => {
                if (c)
                  c.getContext('2d')!.putImageData(
                    new ImageData(new Uint8ClampedArray(sheetPx), 64, 64),
                    0,
                    0,
                  );
              }}
              width={64}
              height={64}
              className="glint-canvas"
              style={{ imageRendering: 'pixelated', width: 240, height: 240 }}
            />
            <div className="hint" style={{ marginTop: 6 }}>
              {d.useDrawing ? '64×64 drawn tile' : `${d.size}×${d.size} tile · ${d.style}`}
            </div>

            <div className="seg" style={{ marginTop: 10 }}>
              {([16, 32, 64] as Size[]).map((sz) => (
                <button
                  key={sz}
                  className={`seg-btn ${d.size === sz ? 'active' : ''}`}
                  disabled={!!d.useDrawing}
                  onClick={() => setDesign({ size: sz })}
                >
                  {sz}px
                </button>
              ))}
            </div>

            <div className="pill-row">
              <button className="pill" onClick={() => setCur({ ...DEFAULT_DESIGN })}>
                {t('common.reset')}
              </button>
              <button className="pill" onClick={randomize}>
                {t('glint.randomize')}
              </button>
              <button className="pill primary" onClick={save}>
                {t('glint.saveChanges')}
              </button>
            </div>

            <div className="panel-title" style={{ marginTop: 14 }}>
              Glint look
            </div>
            <div className="seg small" style={{ marginBottom: 8 }}>
              <button
                className={`seg-btn ${!d.useDrawing ? 'active' : ''}`}
                onClick={() => setDesign({ useDrawing: false })}
              >
                Style
              </button>
              <button
                className={`seg-btn ${d.useDrawing ? 'active' : ''}`}
                onClick={() => setDesign({ useDrawing: true })}
              >
                Draw
              </button>
            </div>
            {d.useDrawing ? (
              <GlintPainter
                key={mode === 'peritem' ? `p:${selected}` : 'global'}
                seed={d.drawing}
                baseColor={d.color}
                onCommit={(px) => setDesign({ drawing: px, useDrawing: true })}
              />
            ) : (
              <div className="style-grid">
                {GLINT_STYLES.map((st) => (
                  <button
                    key={st}
                    className={`style-btn ${d.style === st ? 'active' : ''}`}
                    onClick={() => setDesign({ style: st })}
                  >
                    {st[0].toUpperCase() + st.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-title">{t('glint.previewTitle')}</div>
            <div className="glint-on-item">
              <div
                className={`glint-layer ${animate ? 'animated' : ''}`}
                style={{
                  backgroundImage: `url(${sheet})`,
                  backgroundSize: '64px 64px',
                  imageRendering: 'pixelated',
                  width: 128,
                  height: 128,
                }}
              />
            </div>
            <label className="apply-item" style={{ marginTop: 8 }}>
              <input type="checkbox" checked={animate} onChange={(e) => setAnimate(e.target.checked)} />
              {t('glint.animate')}
            </label>
            <div className="status">
              {t('glint.previewStatus', {
                name: currentEnch ? translateLabelWith(lang, 'enchantment', currentEnch.id, currentEnch.label) : t('glint.thisEnchantment'),
                status: inPack ? t('glint.previewStatus.inPack') : t('glint.previewStatus.notInPack'),
              })}
            </div>
          </div>
        </div>

        <Section title="Colors">
          <div className="color-rows">
            <label
              className="color-row-line"
              style={{ color: 'var(--fg-0)', fontWeight: 600 }}
            >
              <span>Main</span>
              <input type="color" value={d.color} onChange={(e) => setDesign({ color: e.target.value })} />
            </label>
            <label className="color-row-line">
              <span>Highlight</span>
              <input
                type="color"
                value={d.highlight}
                onChange={(e) => setDesign({ highlight: e.target.value })}
              />
            </label>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            The wheel and swatches paint Main — Highlight tints the brightest marks.
          </p>
        </Section>

        <Section title="Glint controls">
          <label className="slider-row">
            <span>Intensity</span>
            <input
              type="range"
              min={0}
              max={100}
              value={d.intensity}
              onChange={(e) => setDesign({ intensity: Number(e.target.value) })}
            />
            <em className="val">{d.intensity}%</em>
          </label>
          <label className="slider-row">
            <span>Layer opacity</span>
            <input
              type="range"
              min={0}
              max={100}
              value={d.layerOpacity}
              onChange={(e) => setDesign({ layerOpacity: Number(e.target.value) })}
            />
            <em className="val">{d.layerOpacity}%</em>
          </label>
          <div className="slider-row" style={{ alignItems: 'center' }}>
            <span>Direction</span>
            <div className="dir-grid" style={{ marginLeft: 'auto' }}>
              {DIRECTIONS.map((deg) => (
                <button
                  key={deg}
                  className={`dir-btn ${d.rotation === deg ? 'active' : ''}`}
                  onClick={() => setDesign({ rotation: deg })}
                  title={`${deg}°`}
                >
                  {deg === 0 ? '→' : deg === 90 ? '↓' : deg === 45 ? '↘' : '↗'}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section
          title={`Applies to (${appliesTo.length} items)`}
          meta={mode === 'global' ? 'all enchanted' : undefined}
        >
          <p className="hint" style={{ marginTop: 0 }}>
            Applies to all {currentEnch?.items.length ?? 0} eligible items by default.
          </p>
          <div className="apply-grid">
            {(currentEnch?.items ?? []).map((it) => (
              <label key={it} className="apply-item">
                <input
                  type="checkbox"
                  checked={appliesTo.includes(it)}
                  onChange={() => toggleApply(it)}
                />
                {it.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
          <div className="pill-row">
            <button className="pill primary" onClick={() => toggleEnabled(selected)} disabled={inPack}>
              {inPack ? 'In pack ✓' : 'Add to Pack'}
            </button>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            {state.enabled.length} looks in your pack · {Object.keys(state.designs).length} drawn sheets
          </p>
        </Section>
      </section>
    </div>
  );
}
