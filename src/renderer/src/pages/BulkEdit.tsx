import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { rescalePixels, recolorPixels, replaceColor, type RescaleMode } from '../lib/canvas';
import './BulkEdit.css';

type Op = 'replace' | 'recolor' | 'resize';

interface TexItem {
  id: string;
  name: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function PreviewCanvas({ pixels, w, h }: { pixels: Uint8ClampedArray; w: number; h: number }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(w, h);
    img.data.set(pixels);
    ctx.putImageData(img, 0, 0);
  }, [pixels, w, h]);
  return <canvas ref={ref} className="preview-canvas" style={{ imageRendering: 'pixelated' }} title={`${w}×${h}`} />;
}

export function BulkEdit(): JSX.Element {
  const { id: projectId = '' } = useParams();
  const [items, setItems] = useState<TexItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [op, setOp] = useState<Op>('replace');

  // replace
  const [fromHex, setFromHex] = useState('#ffffff');
  const [fromA, setFromA] = useState(255);
  const [toHex, setToHex] = useState('#000000');
  const [toA, setToA] = useState(255);
  const [tolerance, setTolerance] = useState(0);

  // recolor
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(0);
  const [bright, setBright] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [invert, setInvert] = useState(false);
  const [grayscale, setGrayscale] = useState(false);

  // resize
  const [targetW, setTargetW] = useState(16);
  const [targetH, setTargetH] = useState(16);
  const [mode, setMode] = useState<RescaleMode>('nearest');

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // live preview (before/after) of the operation on a single texture
  const [previewId, setPreviewId] = useState('');
  const [previewTex, setPreviewTex] = useState<{ pixels: Uint8ClampedArray; w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await window.api.textures.list(projectId);
        const loaded: TexItem[] = [];
        for (const tid of list) {
          const tex = await window.api.textures.load(projectId, tid);
          if (cancelled) return;
          loaded.push({ id: tid, name: tex.name || tid });
        }
        if (!cancelled) setItems(loaded);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Load the texture used for the live preview. Prefer an explicit choice, then
  // the first selected texture, then the first texture in the list.
  useEffect(() => {
    let cancelled = false;
    const pid = previewId || selected.values().next().value || items[0]?.id;
    if (!pid) {
      setPreviewTex(null);
      return;
    }
    (async () => {
      try {
        const tex = await window.api.textures.load(projectId, pid);
        if (!cancelled) setPreviewTex({ pixels: tex.pixels, w: tex.width, h: tex.height });
      } catch {
        if (!cancelled) setPreviewTex(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, previewId, items, selected]);

  const previewOut = useMemo(() => {
    if (!previewTex) return null;
    return applyOp(previewTex.pixels, previewTex.w, previewTex.h);
  }, [previewTex, op, fromHex, toHex, fromA, toA, tolerance, hue, sat, bright, contrast, invert, grayscale, targetW, targetH, mode]);

  const allSelected = useMemo(
    () => items.length > 0 && selected.size === items.length,
    [items, selected],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  }

  function applyOp(pixels: Uint8ClampedArray, w: number, h: number): { out: Uint8ClampedArray; ow: number; oh: number } {
    if (op === 'replace') {
      const from = [...hexToRgb(fromHex), fromA] as [number, number, number, number];
      const to = [...hexToRgb(toHex), toA] as [number, number, number, number];
      const r = replaceColor(pixels, w, h, from, to, tolerance);
      return { out: r.pixels, ow: w, oh: h };
    }
    if (op === 'recolor') {
      const out = recolorPixels(pixels, w, h, {
        hue,
        saturation: sat,
        brightness: bright,
        contrast,
        invert,
        grayscale,
      });
      return { out, ow: w, oh: h };
    }
    const out = rescalePixels(pixels, w, h, targetW, targetH, mode);
    return { out, ow: targetW, oh: targetH };
  }

  async function handleApply() {
    if (busy || selected.size === 0) return;
    setBusy(true);
    setResult(null);
    let done = 0;
    let failed = 0;
    for (const id of selected) {
      try {
        const tex = await window.api.textures.load(projectId, id);
        const { out, ow, oh } = applyOp(tex.pixels, tex.width, tex.height);
        await window.api.textures.savePixels(projectId, id, ow, oh, out);
        done++;
      } catch {
        failed++;
      }
    }
    setBusy(false);
    setResult(`Applied to ${done} texture${done === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`);
  }

  return (
    <div className="bulk">
      <div className="bulk-header">
        <h1>Bulk Edit</h1>
        <p className="bulk-sub">
          Multi-select textures and apply a pixel operation to all of them at once.
        </p>
      </div>

      <div className="bulk-body">
        <section className="panel bulk-list-panel">
          <div className="bulk-list-head">
            <span>Textures ({items.length})</span>
            <label className="checkbox">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <strong>Select all</strong>
            </label>
          </div>
          {loading ? (
            <p className="bulk-hint">Loading…</p>
          ) : (
            <div className="bulk-list">
              {items.map((it) => (
                <label key={it.id} className="checkbox bulk-row">
                  <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)} />
                  {it.name}
                </label>
              ))}
            </div>
          )}
          <div className="bulk-selected">Selected: {selected.size}</div>
        </section>

        <section className="panel bulk-op-panel">
          <div className="bulk-op-tabs">
            <button className={'bulk-tab' + (op === 'replace' ? ' active' : '')} onClick={() => setOp('replace')}>
              Replace color
            </button>
            <button className={'bulk-tab' + (op === 'recolor' ? ' active' : '')} onClick={() => setOp('recolor')}>
              Recolor (HSL)
            </button>
            <button className={'bulk-tab' + (op === 'resize' ? ' active' : '')} onClick={() => setOp('resize')}>
              Resize
            </button>
          </div>

          {op === 'replace' && (
            <div className="bulk-fields">
              <label className="bulk-field">
                <span>From</span>
                <div className="bulk-color">
                  <input type="color" value={fromHex} onChange={(e) => setFromHex(e.target.value)} />
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={fromA}
                    onChange={(e) => setFromA(Math.max(0, Math.min(255, Number(e.target.value) || 0)))}
                    title="Alpha 0–255"
                  />
                </div>
              </label>
              <label className="bulk-field">
                <span>To</span>
                <div className="bulk-color">
                  <input type="color" value={toHex} onChange={(e) => setToHex(e.target.value)} />
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={toA}
                    onChange={(e) => setToA(Math.max(0, Math.min(255, Number(e.target.value) || 0)))}
                    title="Alpha 0–255"
                  />
                </div>
              </label>
              <label className="bulk-field">
                <span>Tolerance</span>
                <input
                  type="number"
                  min={0}
                  max={255}
                  value={tolerance}
                  onChange={(e) => setTolerance(Math.max(0, Math.min(255, Number(e.target.value) || 0)))}
                />
              </label>
            </div>
          )}

          {op === 'recolor' && (
            <div className="bulk-fields">
              <label className="bulk-field">
                <span>Hue {hue}°</span>
                <input type="range" min={-180} max={180} value={hue} onChange={(e) => setHue(Number(e.target.value))} />
              </label>
              <label className="bulk-field">
                <span>Saturation {sat}%</span>
                <input type="range" min={-100} max={100} value={sat} onChange={(e) => setSat(Number(e.target.value))} />
              </label>
              <label className="bulk-field">
                <span>Brightness {bright}%</span>
                <input type="range" min={-100} max={100} value={bright} onChange={(e) => setBright(Number(e.target.value))} />
              </label>
              <label className="bulk-field">
                <span>Contrast {contrast}%</span>
                <input type="range" min={-100} max={100} value={contrast} onChange={(e) => setContrast(Number(e.target.value))} />
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
                Invert
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={grayscale} onChange={(e) => setGrayscale(e.target.checked)} />
                Grayscale
              </label>
            </div>
          )}

          {op === 'resize' && (
            <div className="bulk-fields">
              <label className="bulk-field">
                <span>Target width</span>
                <input type="number" min={1} max={1024} value={targetW} onChange={(e) => setTargetW(Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="bulk-field">
                <span>Target height</span>
                <input type="number" min={1} max={1024} value={targetH} onChange={(e) => setTargetH(Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="bulk-field">
                <span>Mode</span>
                <select value={mode} onChange={(e) => setMode(e.target.value as RescaleMode)}>
                  <option value="nearest">Nearest (pixel-perfect)</option>
                  <option value="bilinear">Bilinear (smooth)</option>
                </select>
              </label>
              <p className="bulk-hint">Note: animated textures are saved as a single frame after editing.</p>
            </div>
          )}

          <div className="bulk-actions">
            <Button variant="primary" onClick={handleApply} disabled={busy || selected.size === 0}>
              {busy ? 'Applying…' : `Apply to ${selected.size || 0} selected`}
            </Button>
            {result && <span className="bulk-result">{result}</span>}
          </div>
        </section>

        <section className="panel bulk-preview-panel">
          <div className="bulk-list-head">
            <span>Preview</span>
            <select
              className="bulk-preview-select"
              value={previewId}
              onChange={(e) => setPreviewId(e.target.value)}
            >
              <option value="">First selected / first texture</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
          </div>

          {!previewTex ? (
            <p className="bulk-hint">No texture available to preview.</p>
          ) : (
            <div className="bulk-preview-grid">
              <figure className="bulk-preview-fig">
                <figcaption>Before</figcaption>
                <PreviewCanvas pixels={previewTex.pixels} w={previewTex.w} h={previewTex.h} />
              </figure>
              <figure className="bulk-preview-fig">
                <figcaption>After</figcaption>
                {previewOut && <PreviewCanvas pixels={previewOut.out} w={previewOut.ow} h={previewOut.oh} />}
              </figure>
            </div>
          )}
          <p className="bulk-hint">Preview shows the effect on one texture. Apply writes to every selected texture.</p>
        </section>
      </div>
    </div>
  );
}
