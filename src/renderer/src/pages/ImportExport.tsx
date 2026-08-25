import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import type { TextureDetailed, ImportTexturePreview } from '@shared/types';
import './ImportExport.css';

type ImportAction = 'import' | 'skip' | 'overwrite' | 'rename';

interface Selection {
  selected: boolean;
  action: ImportAction;
  targetPath: string;
  frameHeight?: number;
  gapHeight?: number;
}

export function ImportExport(): JSX.Element {
  const { id: projectId = '' } = useParams();
  const navigate = useNavigate();

  const [list, setList] = useState<TextureDetailed[]>([]);
  const [exportMsg, setExportMsg] = useState<string>('');
  const [exporting, setExporting] = useState(false);

  const [selectedPng, setSelectedPng] = useState<string>('');
  const [pngMsg, setPngMsg] = useState<string>('');

  const [previews, setPreviews] = useState<ImportTexturePreview[]>([]);
  const [sessionId, setSessionId] = useState<string>('');
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string>('');

  useEffect(() => {
    if (!projectId) return;
    void window.api.io.exportList(projectId).then(setList).catch(() => setList([]));
  }, [projectId]);

  useEffect(() => {
    if (list.length > 0 && !selectedPng) setSelectedPng(list[0].id);
  }, [list, selectedPng]);

  async function handleExportPack(): Promise<void> {
    setExporting(true);
    setExportMsg('');
    try {
      const res = await window.api.io.exportZip(projectId);
      if (res.cancelled) setExportMsg('Export cancelled.');
      else if (res.ok) setExportMsg(`Exported ${res.textureCount} textures to ${res.path}`);
      else setExportMsg('Export failed.');
    } catch (e) {
      setExportMsg(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  async function handleExportPng(): Promise<void> {
    setPngMsg('');
    const tex = list.find((t) => t.id === selectedPng);
    if (!tex) return;
    try {
      const res = await window.api.io.exportPng(projectId, tex.id, tex.name);
      if (res.cancelled) setPngMsg('Export cancelled.');
      else if (res.ok) setPngMsg(`Saved ${res.path}`);
      else setPngMsg('Export failed.');
    } catch (e) {
      setPngMsg(`Export failed: ${(e as Error).message}`);
    }
  }

  function updateSelection(path: string, patch: Partial<Selection>): void {
    setSelections((prev) => {
      const base: Selection = { selected: true, action: 'import', targetPath: '' };
      const cur = prev[path] ?? base;
      return { ...prev, [path]: { ...cur, ...patch } };
    });
  }

  function defaultSelection(p: ImportTexturePreview): Selection {
    return {
      selected: true,
      action: p.exists ? 'overwrite' : 'import',
      targetPath: '',
      frameHeight: p.frameHeight,
      gapHeight: 0,
    };
  }

  async function handleImportOpen(): Promise<void> {
    setImportMsg('');
    try {
      const res = await window.api.io.importZipOpen(projectId);
      if (res.cancelled) return;
      if (res.sessionId && res.previews && res.previews.length > 0) {
        setSessionId(res.sessionId);
        setPreviews(res.previews);
        const init: Record<string, Selection> = {};
        for (const p of res.previews) init[p.path] = defaultSelection(p);
        setSelections(init);
      } else {
        setImportMsg('No textures found in that .zip. Is it a Minecraft resource pack?');
      }
    } catch (e) {
      setImportMsg(`Import failed: ${(e as Error).message}`);
    }
  }

  const selectedCount = useMemo(
    () => Object.values(selections).filter((s) => s.selected && s.action !== 'skip').length,
    [selections],
  );

  async function handleImportApply(): Promise<void> {
    if (!sessionId) return;
    setImporting(true);
    setImportMsg('');
    try {
      const payload = Object.entries(selections)
        .filter(([, s]) => s.selected)
        .map(([path, s]) => ({
          path,
          action: s.action,
          targetPath: s.action === 'rename' ? s.targetPath || path : undefined,
          frameHeight: s.frameHeight,
          gapHeight: s.gapHeight,
        }));
      const res = await window.api.io.importZipApply(projectId, sessionId, payload);
      setImportMsg(`Imported ${res.imported} texture(s), skipped ${res.skipped}.`);
      setPreviews([]);
      setSessionId('');
      setSelections({});
    } catch (e) {
      setImportMsg(`Import failed: ${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  }

  async function handleImportPng(): Promise<void> {
    try {
      const res = await window.api.io.importPng(projectId);
      if (res.cancelled) return;
      if (!res.id) {
        setPngMsg('Could not import that PNG (is it a valid image file?).');
        return;
      }
      navigate(`/project/${projectId}?tex=${encodeURIComponent(res.id)}`);
    } catch (e) {
      setPngMsg(`Import failed: ${(e as Error).message}`);
    }
  }

  return (
    <div className="ie-page">
      <header className="ie-header">
        <h1>Import / Export</h1>
        <p className="ie-sub">
          Export Minecraft-ready resource packs or single PNGs. Import packs with cherry-pick and
          conflict resolution, or add a single PNG as a new texture.
        </p>
      </header>

      <section className="panel ie-panel">
        <h3 className="panel-title">Export resource pack (.zip)</h3>
        <p className="ie-desc">
          Writes <code>pack.mcmeta</code>, <code>pack.png</code>, and every texture under{' '}
          <code>assets/minecraft/textures/</code>. Animated textures include a matching{' '}
          <code>*.mcmeta</code>.
        </p>
        <div className="ie-row">
          <Button variant="primary" onClick={handleExportPack} disabled={exporting || !projectId}>
            {exporting ? 'Exporting…' : 'Export .zip'}
          </Button>
          {exportMsg && <span className="ie-msg">{exportMsg}</span>}
        </div>
      </section>

      <section className="panel ie-panel">
        <h3 className="panel-title">Export texture as PNG</h3>
        <p className="ie-desc">Save a single texture (animated textures export as a vertical frame strip).</p>
        <div className="ie-row">
          <select
            className="ie-select"
            value={selectedPng}
            onChange={(e) => setSelectedPng(e.target.value)}
          >
            {list.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.frameCount > 1 ? ` (${t.frameCount} frames)` : ''}
              </option>
            ))}
          </select>
          <Button variant="default" onClick={handleExportPng} disabled={!selectedPng}>
            Export PNG
          </Button>
          {pngMsg && <span className="ie-msg">{pngMsg}</span>}
        </div>
      </section>

      <section className="panel ie-panel">
        <h3 className="panel-title">Import single PNG</h3>
        <p className="ie-desc">Adds the PNG as a new texture in this project.</p>
        <div className="ie-row">
          <Button variant="default" onClick={handleImportPng} disabled={!projectId}>
            Import PNG…
          </Button>
        </div>
      </section>

      <section className="panel ie-panel">
        <div className="ie-panel-head">
          <h3 className="panel-title">Import resource pack (.zip)</h3>
          <Button variant="default" onClick={handleImportOpen} disabled={!projectId}>
            Choose .zip…
          </Button>
        </div>
        {previews.length > 0 && (
          <div className="ie-import">
            <div className="ie-import-bar">
              <span>
                {selectedCount} selected · {previews.length} textures found
              </span>
              <Button variant="primary" onClick={handleImportApply} disabled={importing}>
                {importing ? 'Importing…' : 'Import selected'}
              </Button>
            </div>
            <ul className="ie-list">
              {previews.map((p) => {
                const sel = selections[p.path] ?? defaultSelection(p);
                return (
                  <li key={p.path} className={'ie-item' + (p.exists ? ' conflict' : '')}>
                    <label className="ie-check">
                      <input
                        type="checkbox"
                        checked={sel.selected}
                        onChange={(e) => updateSelection(p.path, { selected: e.target.checked })}
                      />
                    </label>
                    <div className="ie-item-main">
                      <div className="ie-item-name">
                        {p.name}
                        {p.hasAnimation && <span className="ie-badge">animated</span>}
                        {p.exists && <span className="ie-badge warn">conflict</span>}
                      </div>
                      <div className="ie-item-path">
                        {p.path} · {p.width}×{p.frameHeight}
                        {p.frameCount > 1 ? ` · ${p.frameCount} frames` : ''}
                      </div>
                      {p.hasAnimation && (
                        <div className="ie-anim-settings">
                          <label>
                            Frame H
                            <input
                              type="number"
                              min={1}
                              className="ie-input tiny"
                              value={sel.frameHeight ?? p.frameHeight}
                              onChange={(e) =>
                                updateSelection(p.path, {
                                  frameHeight: Math.max(1, parseInt(e.target.value, 10) || p.frameHeight),
                                })
                              }
                            />
                          </label>
                          <label>
                            Gap
                            <input
                              type="number"
                              min={0}
                              className="ie-input tiny"
                              value={sel.gapHeight ?? 0}
                              onChange={(e) =>
                                updateSelection(p.path, {
                                  gapHeight: Math.max(0, parseInt(e.target.value, 10) || 0),
                                })
                              }
                            />
                          </label>
                          <span className="ie-hint">px · only if frames have spacing</span>
                        </div>
                      )}
                    </div>
                    {p.exists && sel.selected && (
                      <div className="ie-conflict">
                        <select
                          className="ie-select small"
                          value={sel.action}
                          onChange={(e) => {
                            const action = e.target.value as ImportAction;
                            updateSelection(
                              p.path,
                              action === 'rename'
                                ? { action, targetPath: sel.targetPath || `${p.path}_imported` }
                                : { action },
                            );
                          }}
                        >
                          <option value="overwrite">Overwrite existing</option>
                          <option value="skip">Skip</option>
                          <option value="rename">Rename</option>
                        </select>
                        {sel.action === 'rename' && (
                          <input
                            className="ie-input"
                            placeholder={`recommended: ${p.path}_imported`}
                            value={sel.targetPath}
                            onChange={(e) => updateSelection(p.path, { targetPath: e.target.value })}
                          />
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {importMsg && <div className="ie-msg">{importMsg}</div>}
      </section>
    </div>
  );
}
