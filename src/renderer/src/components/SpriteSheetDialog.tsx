import { useEffect, useMemo, useState } from 'react';
import { exportSpriteSheet, type SheetFrame } from '../lib/spriteSheet';
import { Button } from './Button';

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

export interface SheetActiveTexture {
  id: string;
  name: string;
  width: number;
  height: number;
  current: Uint8ClampedArray;
  animation?: { frames: { pixels: Uint8ClampedArray; tickDuration: number }[] };
}

interface Props {
  projectId: string;
  activeTexture?: SheetActiveTexture;
  onClose: () => void;
}

interface TexOption {
  id: string;
  name: string;
}

export function SpriteSheetDialog({ projectId, activeTexture, onClose }: Props) {
  const [options, setOptions] = useState<TexOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [layout, setLayout] = useState<'grid' | 'packed'>('grid');
  const [columns, setColumns] = useState(4);
  const [cell, setCell] = useState(16);
  const [padding, setPadding] = useState(2);
  const [trim, setTrim] = useState(false);
  const [includeFrames, setIncludeFrames] = useState(false);
  const [busy, setBusy] = useState(false);

  const hasFrames = !!activeTexture?.animation?.frames?.length;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await window.api.textures.list(projectId);
        const opts: TexOption[] = [];
        for (const id of list) {
          const tex = await window.api.textures.load(projectId, id);
          if (cancelled) return;
          opts.push({ id, name: tex.name || basename(tex.path) || id });
        }
        if (cancelled) return;
        setOptions(opts);
        const initial = new Set<string>();
        if (activeTexture && opts.some((o) => o.id === activeTexture.id)) {
          initial.add(activeTexture.id);
        }
        setSelected(initial);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, activeTexture]);

  const allSelected = useMemo(
    () => options.length > 0 && selected.size === options.length,
    [options, selected],
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
    setSelected(allSelected ? new Set() : new Set(options.map((o) => o.id)));
  }

  async function handleExport() {
    if (busy) return;
    setBusy(true);
    try {
      const frames: SheetFrame[] = [];
      for (const id of selected) {
        const opt = options.find((o) => o.id === id);
        const name = opt?.name || id;
        if (id === activeTexture?.id && activeTexture.current) {
          frames.push({
            name,
            pixels: activeTexture.current,
            width: activeTexture.width,
            height: activeTexture.height,
          });
        } else {
          const tex = await window.api.textures.load(projectId, id);
          frames.push({ name, pixels: tex.pixels, width: tex.width, height: tex.height });
        }
        if (id === activeTexture?.id && includeFrames && hasFrames) {
          activeTexture.animation!.frames.forEach((f, i) => {
            frames.push({
              name: `${name}__f${i}`,
              pixels: f.pixels,
              width: activeTexture.width,
              height: activeTexture.height,
            });
          });
        }
      }
      if (frames.length === 0) return;
      await exportSpriteSheet(frames, { layout, columns, cell, padding, trim });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="resize-backdrop" onMouseDown={onClose}>
      <div
        className="resize-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Sprite-sheet export"
        style={{ maxWidth: 460, width: '100%' }}
      >
        <h3>Sprite-sheet export</h3>
        <p style={{ fontSize: 11, color: 'var(--fg-3)', margin: '0 0 12px 0' }}>
          Select textures to pack into a sheet. PNG + JSON atlas download together.
        </p>

        <div className="resize-row">
          <label>Layout</label>
          <div className="resize-mode-row" style={{ flex: 1 }}>
            <button
              className={'resize-mode' + (layout === 'grid' ? ' active' : '')}
              onClick={() => setLayout('grid')}
            >
              Grid
            </button>
            <button
              className={'resize-mode' + (layout === 'packed' ? ' active' : '')}
              onClick={() => setLayout('packed')}
            >
              Packed
            </button>
          </div>
        </div>

        {layout === 'grid' ? (
          <>
            <div className="resize-row">
              <label>Columns</label>
              <input
                className="resize-input"
                type="number"
                min={1}
                value={columns}
                onChange={(e) => setColumns(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </div>
            <div className="resize-row">
              <label>Cell</label>
              <input
                className="resize-input"
                type="number"
                min={1}
                value={cell}
                onChange={(e) => setCell(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </div>
          </>
        ) : (
          <div className="resize-row">
            <label>Padding</label>
            <input
              className="resize-input"
              type="number"
              min={0}
              value={padding}
              onChange={(e) => setPadding(Math.max(0, parseInt(e.target.value, 10) || 0))}
            />
          </div>
        )}

        <div className="resize-row" style={{ alignItems: 'center' }}>
          <label>Trim transparent</label>
          <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} />
        </div>

        {hasFrames && (
          <div className="resize-row" style={{ alignItems: 'center' }}>
            <label>Include animation frames of active sprite</label>
            <input
              type="checkbox"
              checked={includeFrames}
              onChange={(e) => setIncludeFrames(e.target.checked)}
            />
          </div>
        )}

        <div className="resize-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <label style={{ fontWeight: 600 }}>Textures</label>
          {loading ? (
            <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>Loading…</span>
          ) : (
            <div
              style={{
                maxHeight: 220,
                overflowY: 'auto',
                border: '1px solid var(--border, #333)',
                borderRadius: 6,
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                <strong>Select all</strong>
              </label>
              {options.map((o) => (
                <label key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} />
                  {o.name}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="resize-actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleExport} disabled={busy || selected.size === 0}>
            {busy ? 'Exporting…' : 'Export'}
          </Button>
        </div>
      </div>
    </div>
  );
}
