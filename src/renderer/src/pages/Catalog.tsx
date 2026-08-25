import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../components/Button';
import './Catalog.css';

interface VanillaTexture {
  id: string;
  path: string;
  category: string;
}

const MAX_VISIBLE = 300;

export function Catalog(): JSX.Element {
  const { id: projectId = '' } = useParams();
  const navigate = useNavigate();
  const [textures, setTextures] = useState<VanillaTexture[] | null>(null);
  const [version, setVersion] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.api.textures.readVanillaIndex().then((idx) => {
      if (cancelled) return;
      if (idx) {
        setTextures(idx.textures);
        setVersion(idx.version);
      } else {
        setTextures(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    if (!textures) return [] as string[];
    const set = new Set(textures.map((t) => t.category));
    return Array.from(set).sort();
  }, [textures]);

  const filtered = useMemo(() => {
    if (!textures) return [] as VanillaTexture[];
    const q = query.trim().toLowerCase();
    return textures.filter((t) => {
      if (category !== 'all' && t.category !== category) return false;
      if (q && !t.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [textures, query, category]);

  const visible = filtered.slice(0, MAX_VISIBLE);

  async function handleAdd(t: VanillaTexture) {
    if (busy) return;
    setBusy(t.id);
    try {
      const res = await window.api.textures.addVanilla(projectId, t.id);
      if (res.id) {
        setAdded((prev) => new Set(prev).add(t.id));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="catalog">
      <div className="catalog-header">
        <Link className="btn-ghost" to={`/project/${projectId}`}>
          ← Editor
        </Link>
        <div className="catalog-title">
          <h1>Vanilla Catalog</h1>
          {version && <span className="catalog-version">MC {version}</span>}
        </div>
        <div className="catalog-header-spacer" />
        <Button variant="primary" onClick={() => navigate(`/project/${projectId}`)}>
          Done
        </Button>
      </div>

      {textures === null ? (
        <div className="catalog-empty">
          <h2>No vanilla textures bundled</h2>
          <p>
            The catalog reads Minecraft assets from <code>resources/vanilla/</code>, which is populated by the
            build-time sync script. Run it once (requires internet) to download the latest client:
          </p>
          <pre className="catalog-cmd">npm run sync:vanilla</pre>
          <p className="catalog-hint">
            After it finishes, restart the app and reopen this page.
          </p>
        </div>
      ) : (
        <>
          <div className="catalog-controls">
            <input
              className="catalog-search"
              placeholder="Search textures (e.g. grass, diamond, gui)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="catalog-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">All categories ({textures.length})</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="catalog-count">
            {filtered.length} texture{filtered.length === 1 ? '' : 's'}
            {filtered.length > MAX_VISIBLE && ` — showing first ${MAX_VISIBLE}, refine search`}
            {added.size > 0 && ` · ${added.size} added`}
          </div>

          <div className="catalog-grid">
            {visible.map((t) => {
              const name = t.id.split('/').pop() || t.id;
              const isAdded = added.has(t.id);
              return (
                <div key={t.id} className="catalog-card">
                  <div className="catalog-thumb-wrap">
                    <VanillaThumb id={t.id} />
                  </div>
                  <div className="catalog-text">
                    <div className="catalog-name" title={t.id}>
                      {name}
                    </div>
                    <div className="catalog-path">{t.category}</div>
                  </div>
                  <button
                    className={'btn-primary catalog-add' + (isAdded ? ' added' : '')}
                    disabled={busy !== null || isAdded}
                    onClick={() => handleAdd(t)}
                  >
                    {isAdded ? 'Added ✓' : busy === t.id ? 'Adding…' : 'Add'}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function VanillaThumb({ id }: { id: string }): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    window.api.textures.readVanillaPng(id).then((bytes) => {
      if (!bytes || !active) return;
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      setUrl(objectUrl);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return url ? <img className="catalog-thumb" src={url} alt={id} /> : <div className="catalog-thumb catalog-thumb-empty" />;
}
