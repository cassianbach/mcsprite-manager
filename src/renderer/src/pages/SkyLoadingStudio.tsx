import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStudio } from '../store/studio';
import { encodeCleanPng } from '../lib/png';
import { useTranslate, translateLabelWith } from '../i18n';
import { useSettings } from '../store/settings';
import type {
  SkyStudioData,
  SkyLayer,
  SkyFaceImage,
  LoadingFace,
  SkyBlend,
  SkyWeather,
} from '../../../shared/types';
import './Studio.css';
import './SkyLoadingStudio.css';

type Tab = 'sky' | 'loading';

// 6-face slot labels in Skyboxify/OptiFine cross-strip order.
const SKY_FACE_NAMES = ['Down', 'Up', 'East', 'South', 'West', 'North'] as const;

// Main-menu panorama face labels (file order panorama_0..5).
const MENU_FACE_NAMES = ['Back', 'Left', 'Front', 'Right', 'Top', 'Bottom'] as const;

// Sky face size (each cube face). Composed into a 1536x1024 strip on export.
const SKY_FACE_SIZE = 512;
const STRIP_W = SKY_FACE_SIZE * 3;
const STRIP_H = SKY_FACE_SIZE * 2;

// Main-menu panorama face size (square).
const MENU_FACE_SIZE = 1024;

const BLEND_OPTIONS: SkyBlend[] = [
  'replace', 'alpha', 'add', 'screen', 'multiply', 'overlay', 'subtract', 'dodge', 'burn',
];
const WEATHER_OPTIONS: SkyWeather[] = ['clear', 'rain', 'thunder'];

function emptyFaceImage(): SkyFaceImage {
  return { dataUrl: '' };
}

function emptyLayer(): SkyLayer {
  return {
    enabled: true,
    source: '',
    faces: [emptyFaceImage(), emptyFaceImage(), emptyFaceImage(), emptyFaceImage(), emptyFaceImage(), emptyFaceImage()],
    blend: 'replace',
    speed: 1,
    daysLoop: 8,
    weather: ['clear'],
    transition: 1,
    axis: [0, 0, 1],
    rotate: true,
  };
}

function emptyLoadingFace(): LoadingFace {
  return { dataUrl: '' };
}

function defaultData(): SkyStudioData {
  return {
    version: 1,
    cover: true,
    sky: {
      dimension: 'world0',
      layers: [emptyLayer()],
    },
    loading: {
      panorama: [emptyLoadingFace(), emptyLoadingFace(), emptyLoadingFace(), emptyLoadingFace(), emptyLoadingFace(), emptyLoadingFace()],
    },
  };
}

function buildSkyProperties(layer: SkyLayer, n: number): string {
  // `source=` is a namespaced resource ID; Skyboxify resolves it relative to
  // `assets/<namespace>/`, so do NOT include the `assets/minecraft/` prefix.
  const source = layer.source || `optifine/sky/world0/sky${n}.png`;
  const lines: string[] = [];
  lines.push(`source=minecraft:${source}`);
  lines.push(`blend=${layer.blend}`);
  if (layer.startFadeIn) lines.push(`startFadeIn=${layer.startFadeIn}`);
  if (layer.endFadeIn) lines.push(`endFadeIn=${layer.endFadeIn}`);
  if (layer.startFadeOut) lines.push(`startFadeOut=${layer.startFadeOut}`);
  if (layer.endFadeOut) lines.push(`endFadeOut=${layer.endFadeOut}`);
  lines.push(`speed=${layer.speed}`);
  lines.push(`daysLoop=${layer.daysLoop}`);
  if (layer.days) lines.push(`days=${layer.days}`);
  lines.push(`weather=${layer.weather.join(' ')}`);
  if (layer.biomes) lines.push(`biomes=${layer.biomes}`);
  if (layer.heights) lines.push(`heights=${layer.heights}`);
  lines.push(`transition=${layer.transition}`);
  const a = layer.axis;
  lines.push(`axis=${a[0]} ${a[1]} ${a[2]}`);
  lines.push(`rotate=${layer.rotate ? 'true' : 'false'}`);
  return lines.join('\n') + '\n';
}

function Section(props: {
  title: string;
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}): JSX.Element {
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

/**
 * "Cover" fit: uniformly scale the source to fill the target square
 * (scale = max(targetW/srcW, targetH/srcH)), then center-crop the overflow.
 * Preserves aspect ratio (no stretch) and leaves no black/transparent margins.
 */
function fitToRgba(img: HTMLImageElement, w: number, h: number): Uint8ClampedArray | null {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;
  // Nearest-neighbor so low-res pixel art stays crisp on import/export.
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, dx, dy, dw, dh);
  return ctx.getImageData(0, 0, w, h).data;
}

async function normalizeFace(dataUrl: string, w: number, h: number, cover: boolean): Promise<string> {
  if (!dataUrl) return '';
  const img = await loadImage(dataUrl);
  if (img.width === w && img.height === h) return dataUrl;
  // "Cover" upscale-or-letterbox depending on the toggle.
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  let dx = 0;
  let dy = 0;
  let dw = w;
  let dh = h;
  if (cover) {
    const s = Math.max(w / img.width, h / img.height);
    dw = img.width * s;
    dh = img.height * s;
    dx = (w - dw) / 2;
    dy = (h - dh) / 2;
  } else {
    const srcAspect = img.width / img.height;
    const dstAspect = w / h;
    if (srcAspect > dstAspect) {
      dw = w;
      dh = w / srcAspect;
      dx = 0;
      dy = (h - dh) / 2;
    } else if (srcAspect < dstAspect) {
      dh = h;
      dw = h * srcAspect;
      dy = 0;
      dx = (w - dw) / 2;
    }
  }
  ctx.drawImage(img, dx, dy, dw, dh);
  return encodeCleanPng(w, h, ctx.getImageData(0, 0, w, h).data);
}

function FaceEditor(props: {
  label: string;
  hint?: string;
  dataUrl: string;
  size: number;
  cover: boolean;
  onChange: (dataUrl: string) => void;
}): JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null);
  const sizeLabel = `${props.size}×${props.size}`;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    const img = await loadImage(dataUrl);
    const rgba = fitToRgba(img, props.size, props.size);
    if (rgba) props.onChange(await encodeCleanPng(props.size, props.size, rgba));
    e.target.value = '';
  }

  return (
    <div className="face-tile">
      <div className="face-tile-head">
        <span className="face-tile-label">{props.label}</span>
        <span className="face-tile-meta">{props.hint ?? sizeLabel}</span>
      </div>
      <div className="face-tile-preview">
        {props.dataUrl ? (
          <img src={props.dataUrl} alt={props.label} />
        ) : (
          <div className="face-tile-empty">empty</div>
        )}
      </div>
      <div className="face-tile-actions">
        <button className="pill" onClick={() => fileRef.current?.click()}>
          {props.dataUrl ? 'Replace…' : 'Import…'}
        </button>
        {props.dataUrl && (
          <button className="pill ghost" onClick={() => props.onChange('')}>
            Clear
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={onPick}
        />
      </div>
    </div>
  );
}

/**
 * Composed-strip preview canvas. Draws the 6 sky face images into the
 * Skyboxify 3×2 cube cross-layout so the user can verify composition before
 * exporting. Nearest-neighbor so pixel-art faces stay sharp.
 */
function ComposedPreview(props: { faces: [SkyFaceImage, SkyFaceImage, SkyFaceImage, SkyFaceImage, SkyFaceImage, SkyFaceImage] }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faces = props.faces;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Nearest-neighbor: keep pixel-art faces crisp in the composed preview.
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1f2024';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid separators (between the 6 cells).
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(SKY_FACE_SIZE, 0); ctx.lineTo(SKY_FACE_SIZE, STRIP_H);
    ctx.moveTo(SKY_FACE_SIZE * 2, 0); ctx.lineTo(SKY_FACE_SIZE * 2, STRIP_H);
    ctx.moveTo(0, SKY_FACE_SIZE); ctx.lineTo(STRIP_W, SKY_FACE_SIZE);
    ctx.stroke();

    // Per-cell face image + label chip.
    const cellPos: Array<{ x: number; y: number }> = [
      { x: 0, y: 0 },                            // Down
      { x: SKY_FACE_SIZE, y: 0 },                // Up
      { x: SKY_FACE_SIZE * 2, y: 0 },            // East
      { x: 0, y: SKY_FACE_SIZE },                // South
      { x: SKY_FACE_SIZE, y: SKY_FACE_SIZE },    // West
      { x: SKY_FACE_SIZE * 2, y: SKY_FACE_SIZE }, // North
    ];

    const draws: Array<Promise<void>> = [];
    for (let i = 0; i < 6; i++) {
      const face = faces[i];
      const pos = cellPos[i];
      // Label chip.
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(pos.x + 8, pos.y + 8, 88, 30);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(pos.x + 8, pos.y + 8, 88, 30);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(SKY_FACE_NAMES[i], pos.x + 16, pos.y + 24);

      if (face.dataUrl) {
        draws.push(
          loadImage(face.dataUrl)
            .then((img) => {
              ctx.drawImage(img, pos.x, pos.y, SKY_FACE_SIZE, SKY_FACE_SIZE);
            })
            .catch(() => undefined),
        );
      }
    }
    void Promise.all(draws).then(() => {
      // Redraw grid + labels on top so they stay visible over the images.
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(SKY_FACE_SIZE, 0); ctx.lineTo(SKY_FACE_SIZE, STRIP_H);
      ctx.moveTo(SKY_FACE_SIZE * 2, 0); ctx.lineTo(SKY_FACE_SIZE * 2, STRIP_H);
      ctx.moveTo(0, SKY_FACE_SIZE); ctx.lineTo(STRIP_W, SKY_FACE_SIZE);
      ctx.stroke();
    });
  }, [faces]);

  return (
    <canvas
      ref={canvasRef}
      width={STRIP_W}
      height={STRIP_H}
      className="sky-strip-canvas"
    />
  );
}

export default function SkyLoadingStudio(): JSX.Element {
  const t = useTranslate();
  const lang = useSettings((s) => s.language ?? 'en');
  const { id: projectId = '' } = useParams();
  const studio = useStudio<SkyStudioData>(projectId, 'sky');
  const [state, setState] = useState<SkyStudioData>(defaultData);
  const [tab, setTab] = useState<Tab>('sky');
  const [selectedLayer, setSelectedLayer] = useState(0);
  const didInit = useRef(false);

  useEffect(() => {
    if (didInit.current) return;
    if (studio.loading) return;
    if (studio.data) {
      const d = studio.data as SkyStudioData;
      const layers = Array.isArray(d.sky?.layers) && d.sky.layers.length > 0 ? d.sky.layers : [emptyLayer()];
      const fillFaceImg = (f?: { dataUrl?: unknown }): SkyFaceImage => ({
        dataUrl: typeof f?.dataUrl === 'string' ? f.dataUrl : '',
      });
      const fixed: SkyLayer[] = layers.slice(0, 3).map((l) => {
        const facesArr = Array.isArray(l.faces) ? l.faces : [];
        const faces: [SkyFaceImage, SkyFaceImage, SkyFaceImage, SkyFaceImage, SkyFaceImage, SkyFaceImage] = [
          fillFaceImg(facesArr[0]),
          fillFaceImg(facesArr[1]),
          fillFaceImg(facesArr[2]),
          fillFaceImg(facesArr[3]),
          fillFaceImg(facesArr[4]),
          fillFaceImg(facesArr[5]),
        ];
        return {
          enabled: !!l.enabled,
          source: typeof l.source === 'string' ? l.source : '',
          faces,
          blend: (l.blend as SkyBlend) ?? 'replace',
          startFadeIn: l.startFadeIn,
          endFadeIn: l.endFadeIn,
          startFadeOut: l.startFadeOut,
          endFadeOut: l.endFadeOut,
          speed: typeof l.speed === 'number' ? l.speed : 1,
          daysLoop: typeof l.daysLoop === 'number' ? l.daysLoop : 8,
          days: l.days,
          weather: Array.isArray(l.weather) && l.weather.length > 0 ? l.weather : ['clear'],
          biomes: l.biomes,
          heights: l.heights,
          transition: typeof l.transition === 'number' ? l.transition : 1,
          axis: Array.isArray(l.axis) && l.axis.length === 3 ? (l.axis as [number, number, number]) : [0, 0, 1],
          rotate: typeof l.rotate === 'boolean' ? l.rotate : true,
        };
      });
      const fillFace = (f?: LoadingFace): LoadingFace => ({ dataUrl: typeof f?.dataUrl === 'string' ? f.dataUrl : '' });
      const pano = d.loading?.panorama;
      const panorama: [LoadingFace, LoadingFace, LoadingFace, LoadingFace, LoadingFace, LoadingFace] = pano
        ? [fillFace(pano[0]), fillFace(pano[1]), fillFace(pano[2]), fillFace(pano[3]), fillFace(pano[4]), fillFace(pano[5])]
        : [emptyLoadingFace(), emptyLoadingFace(), emptyLoadingFace(), emptyLoadingFace(), emptyLoadingFace(), emptyLoadingFace()];
      const cover = d.cover !== false;
      setState({ version: 1, cover, sky: { dimension: 'world0', layers: fixed }, loading: { panorama } });
      didInit.current = true;
      // Normalize every saved texture to the current expected sizes:
      // - sky faces → 512×512 (square).
      // - menu panorama faces → 1024×1024 (square).
      (async () => {
        const nextLayers: SkyLayer[] = await Promise.all(
          fixed.map(async (l): Promise<SkyLayer> => {
            const nextFaces = (await Promise.all(
              l.faces.map(async (f) => ({
                dataUrl: await normalizeFace(f.dataUrl, SKY_FACE_SIZE, SKY_FACE_SIZE, cover),
              })),
            )) as typeof l.faces;
            return { ...l, faces: nextFaces };
          }),
        );
        const nextPano = (await Promise.all(
          panorama.map(async (f) => ({ dataUrl: await normalizeFace(f.dataUrl, MENU_FACE_SIZE, MENU_FACE_SIZE, cover) })),
        ) as typeof panorama);
        setState((s) => ({
          ...s,
          sky: { ...s.sky, layers: nextLayers },
          loading: { panorama: nextPano },
        }));
      })().catch(() => undefined);
    }
  }, [studio.data, studio.loading]);

  const layer = state.sky.layers[selectedLayer] ?? state.sky.layers[0];

  function updateLayer<K extends keyof SkyLayer>(key: K, value: SkyLayer[K]): void {
    setState((s) => {
      const layers = s.sky.layers.slice();
      const cur = layers[selectedLayer] ?? emptyLayer();
      layers[selectedLayer] = { ...cur, [key]: value };
      return { ...s, sky: { ...s.sky, layers } };
    });
  }

  function toggleWeather(w: SkyWeather): void {
    const cur = layer.weather;
    const next = cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w];
    if (next.length === 0) return;
    updateLayer('weather', next);
  }

  function setAxisField(idx: 0 | 1 | 2, v: number): void {
    const a: [number, number, number] = [layer.axis[0], layer.axis[1], layer.axis[2]];
    a[idx] = v;
    updateLayer('axis', a);
  }

  function addLayer(): void {
    if (state.sky.layers.length >= 3) return;
    setState((s) => ({
      ...s,
      sky: { ...s.sky, layers: [...s.sky.layers, emptyLayer()] },
    }));
    setSelectedLayer(state.sky.layers.length);
  }

  function removeLayer(): void {
    if (state.sky.layers.length <= 1) return;
    setState((s) => {
      const layers = s.sky.layers.filter((_, i) => i !== selectedLayer);
      return { ...s, sky: { ...s.sky, layers } };
    });
    setSelectedLayer(Math.max(0, selectedLayer - 1));
  }

  function setMenuFace(idx: number, dataUrl: string): void {
    setState((s) => {
      const panorama = s.loading.panorama.slice() as typeof s.loading.panorama;
      panorama[idx] = { dataUrl };
      return { ...s, loading: { ...s.loading, panorama } };
    });
  }

  function setSkyFace(idx: 0 | 1 | 2 | 3 | 4 | 5, dataUrl: string): void {
    setState((s) => {
      const layers = s.sky.layers.slice();
      const cur = layers[selectedLayer] ?? emptyLayer();
      const faces = cur.faces.slice() as typeof cur.faces;
      faces[idx] = { dataUrl };
      layers[selectedLayer] = { ...cur, faces };
      return { ...s, sky: { ...s.sky, layers } };
    });
  }

  async function save(): Promise<void> {
    await studio.set(state);
  }

  const filledFaceCount = layer ? layer.faces.filter((f) => f.dataUrl).length : 0;

  return (
    <div className="studio">
      <aside className="studio-side">
        <Section
          title="Sky layers"
          meta={<span>{selectedLayer + 1}/{state.sky.layers.length}</span>}
          defaultOpen
        >
          <div className="seg small" role="tablist">
            {state.sky.layers.map((l, i) => (
              <button
                key={i}
                className={`seg-btn ${i === selectedLayer ? 'active' : ''}`}
                onClick={() => setSelectedLayer(i)}
                title={
                  l.faces.every((f) => f.dataUrl)
                    ? `Layer ${i + 1} ready (all 6 faces filled)`
                    : `Layer ${i + 1} — ${l.faces.filter((f) => f.dataUrl).length}/6 faces`
                }
              >
                {i + 1}
              </button>
            ))}
          </div>
          <label className="slider-row" style={{ marginTop: 12 }}>
            <span>Enabled</span>
            <input
              type="checkbox"
              checked={layer.enabled}
              onChange={(e) => updateLayer('enabled', e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            <em className="val">{layer.enabled ? 'yes' : 'no'}</em>
          </label>
          <label className="color-row-line">
            <span>Blend</span>
            <select
              className="ie-select"
              value={layer.blend}
              onChange={(e) => updateLayer('blend', e.target.value as SkyBlend)}
              style={{ flex: 1 }}
            >
              {BLEND_OPTIONS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </label>
          <div className="color-row-line">
            <span>Weather</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {WEATHER_OPTIONS.map((w) => (
                <button
                  key={w}
                  className={`pill ${layer.weather.includes(w) ? 'primary' : 'ghost'}`}
                  style={{ padding: '4px 10px', fontSize: 12 }}
                  onClick={() => toggleWeather(w)}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
          <label className="slider-row">
            <span>Speed</span>
            <input
              type="range"
              min={-5}
              max={5}
              step={0.05}
              value={layer.speed}
              onChange={(e) => updateLayer('speed', Number(e.target.value))}
            />
            <em className="val">{layer.speed.toFixed(2)}</em>
          </label>
          <label className="slider-row">
            <span>Days loop</span>
            <input
              type="range"
              min={1}
              max={64}
              step={1}
              value={layer.daysLoop}
              onChange={(e) => updateLayer('daysLoop', Number(e.target.value))}
            />
            <em className="val">{layer.daysLoop}</em>
          </label>
          <label className="slider-row">
            <span>Transition (s)</span>
            <input
              type="range"
              min={0}
              max={60}
              step={1}
              value={layer.transition}
              onChange={(e) => updateLayer('transition', Number(e.target.value))}
            />
            <em className="val">{layer.transition}</em>
          </label>
          <div className="color-row-line" style={{ alignItems: 'flex-start' }}>
            <span>Axis</span>
            <div style={{ display: 'flex', gap: 6, flex: 1 }}>
              {([0, 1, 2] as const).map((i) => (
                <label key={i} className="slider-row" style={{ marginBottom: 0 }}>
                  <span style={{ fontSize: 11 }}>{['x', 'y', 'z'][i]}</span>
                  <input
                    type="number"
                    step={0.05}
                    min={-1}
                    max={1}
                    value={layer.axis[i]}
                    onChange={(e) => setAxisField(i, Number(e.target.value))}
                  />
                  <em className="val">{layer.axis[i].toFixed(2)}</em>
                </label>
              ))}
            </div>
          </div>
          <label className="slider-row">
            <span>Rotate</span>
            <input
              type="checkbox"
              checked={layer.rotate}
              onChange={(e) => updateLayer('rotate', e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            <em className="val">{layer.rotate ? 'yes' : 'no'}</em>
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              className="pill primary"
              onClick={addLayer}
              disabled={state.sky.layers.length >= 3}
              style={{ flex: 1 }}
            >
              + Add layer
            </button>
            <button
              className="pill ghost"
              onClick={removeLayer}
              disabled={state.sky.layers.length <= 1}
              style={{ flex: 1 }}
            >
              Remove layer
            </button>
          </div>
          <label className="slider-row" style={{ marginTop: 12 }}>
            <span>Cover (fill + crop)</span>
            <input
              type="checkbox"
              checked={state.cover !== false}
              onChange={(e) => setState((s) => ({ ...s, cover: e.target.checked }))}
              style={{ width: 18, height: 18 }}
            />
            <em className="val">{state.cover !== false ? 'on' : 'off'}</em>
          </label>
        </Section>

        <Section title="Fade times" defaultOpen={false}>
          <div className="color-row-line">
            <span>Start fade in</span>
            <input
              type="time"
              value={layer.startFadeIn ?? ''}
              onChange={(e) => updateLayer('startFadeIn', e.target.value || undefined)}
            />
          </div>
          <div className="color-row-line">
            <span>End fade in</span>
            <input
              type="time"
              value={layer.endFadeIn ?? ''}
              onChange={(e) => updateLayer('endFadeIn', e.target.value || undefined)}
            />
          </div>
          <div className="color-row-line">
            <span>Start fade out</span>
            <input
              type="time"
              value={layer.startFadeOut ?? ''}
              onChange={(e) => updateLayer('startFadeOut', e.target.value || undefined)}
            />
          </div>
          <div className="color-row-line">
            <span>End fade out</span>
            <input
              type="time"
              value={layer.endFadeOut ?? ''}
              onChange={(e) => updateLayer('endFadeOut', e.target.value || undefined)}
            />
          </div>
        </Section>

        <Section title="Layer conditions" defaultOpen={false}>
          <label className="color-row-line" style={{ alignItems: 'flex-start' }}>
            <span>Biomes</span>
            <input
              type="text"
              placeholder="plains forest !desert"
              value={layer.biomes ?? ''}
              onChange={(e) => updateLayer('biomes', e.target.value || undefined)}
              style={{ flex: 1 }}
            />
          </label>
          <label className="color-row-line">
            <span>Heights</span>
            <input
              type="text"
              placeholder="70 72 100-115"
              value={layer.heights ?? ''}
              onChange={(e) => updateLayer('heights', e.target.value || undefined)}
              style={{ flex: 1 }}
            />
          </label>
          <label className="color-row-line">
            <span>Days</span>
            <input
              type="text"
              placeholder="0 1 2 6-10 14"
              value={layer.days ?? ''}
              onChange={(e) => updateLayer('days', e.target.value || undefined)}
              style={{ flex: 1 }}
            />
          </label>
        </Section>

        <button className="pill primary" onClick={save} style={{ marginTop: 16, width: '100%' }}>
          Save changes
        </button>
        <div className="hint" style={{ marginTop: 8 }}>
          On export, filled textures become real pack files; empty slots are skipped.
        </div>
      </aside>

      <section className="studio-main">
        <header className="studio-head">
          <div className="tabs">
            <button className={`tab ${tab === 'sky' ? 'active' : ''}`} onClick={() => setTab('sky')}>
              Sky
            </button>
            <button
              className={`tab ${tab === 'loading' ? 'active' : ''}`}
              onClick={() => setTab('loading')}
            >
              Main Menu
            </button>
          </div>
          <h2 className="studio-head-title">
            {tab === 'sky' ? 'Skyboxify-compatible Overworld sky' : 'Main menu panorama (background)'}
          </h2>
        </header>

        {tab === 'sky' && (
          <div className="studio-cols">
            <div className="panel">
              <div className="panel-title">
                Layer {selectedLayer + 1} — cube faces ({SKY_FACE_SIZE}×{SKY_FACE_SIZE} each)
                <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--fg-3)', fontWeight: 500 }}>
                  · {filledFaceCount}/6 filled
                </span>
              </div>
              <div className="sky-face-grid">
                {SKY_FACE_NAMES.map((name, i) => (
                  <FaceEditor
                    key={i}
                    label={name}
                    hint={`face ${i + 1}`}
                    dataUrl={layer.faces[i].dataUrl}
                    size={SKY_FACE_SIZE}
                    cover={state.cover !== false}
                    onChange={(d) => setSkyFace(i as 0 | 1 | 2 | 3 | 4 | 5, d)}
                  />
                ))}
              </div>
              <p className="hint" style={{ marginTop: 12 }}>
                Import each of the 6 cube faces as a square image. The studio
                composes them into the 3×2 Skyboxify strip on export. Order:
                Down / Up / East (top row), South / West / North (bottom row).
                A layer is only exported if all 6 faces are filled.
              </p>
            </div>

            <div className="panel">
              <div className="panel-title">Composed strip preview (1536×1024)</div>
              <div className="sky-strip-canvas-wrap">
                <ComposedPreview faces={layer.faces} />
              </div>
              <div className="panel-title" style={{ marginTop: 16 }}>
                .properties preview (sky{selectedLayer + 1}.properties)
              </div>
              <pre className="sky-props-preview">{buildSkyProperties(layer, selectedLayer + 1)}</pre>
              <p className="hint" style={{ marginTop: 12 }}>
                Skyboxify mod required to see this in-world; the resource pack is harmless without it.
              </p>
            </div>
          </div>
        )}

        {tab === 'loading' && (
          <div className="studio-cols">
            <div className="panel">
              <div className="panel-title">Panorama faces ({MENU_FACE_SIZE}×{MENU_FACE_SIZE} each)</div>
              <div className="face-grid">
                {MENU_FACE_NAMES.map((name, i) => (
                  <FaceEditor
                    key={i}
                    label={name}
                    hint={`panorama_${i}.png`}
                    dataUrl={state.loading.panorama[i].dataUrl}
                    size={MENU_FACE_SIZE}
                    cover={state.cover !== false}
                    onChange={(d) => setMenuFace(i, d)}
                  />
                ))}
              </div>
              <p className="hint" style={{ marginTop: 12 }}>
                These 6 panorama faces set the main menu (title screen) background.
                All faces must be square (MC 1.21.6+); non-square uploads are
                letterboxed to {MENU_FACE_SIZE}×{MENU_FACE_SIZE}. Empty slots are not
                written on export.
              </p>
              <p className="hint" style={{ marginTop: 8, color: 'var(--warning)' }}>
                This does NOT change the world-loading screen you see when joining a
                world. The world-loading screen background is controlled by the
                launcher / client (e.g. Lunar Client), not by resource packs. The
                panorama files written here only affect the main menu background.
              </p>
            </div>
          </div>
        )}

        <p className="hint" style={{ marginTop: 16 }}>
          Skyboxify is GPL-3.0; your pack is yours, but redistribution obligations apply to derived works of the mod.
        </p>
      </section>
    </div>
  );
}
