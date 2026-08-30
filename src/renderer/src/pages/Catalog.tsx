import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { useTranslate } from '../i18n';
import './Catalog.css';

interface VanillaTexture {
  id: string;
  path: string;
  category: string;
}

const MAX_VISIBLE = 300;

export function Catalog(): JSX.Element {
  const t = useTranslate();
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

  async function handleAdd(tex: VanillaTexture) {
    if (busy) return;
    setBusy(tex.id);
    try {
      const res = await window.api.textures.addVanilla(projectId, tex.id);
      if (res.id) {
        setAdded((prev) => new Set(prev).add(tex.id));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="catalog">
      <div className="catalog-header">
        <Link className="btn-ghost" to={`/project/${projectId}`}>
          {t('catalog.backToEditor')}
        </Link>
        <div className="catalog-title">
          <h1>{t('catalog.title')}</h1>
          {version && <span className="catalog-version">{t('catalog.version', { version })}</span>}
        </div>
        <div className="catalog-header-spacer" />
        <Button variant="primary" onClick={() => navigate(`/project/${projectId}`)}>
          {t('catalog.done')}
        </Button>
      </div>

      {textures === null ? (
        <div className="catalog-empty">
          <h2>{t('catalog.empty.title')}</h2>
          <p>{t('catalog.empty.body')}</p>
          <pre className="catalog-cmd">{t('catalog.empty.cmd')}</pre>
          <p className="catalog-hint">{t('catalog.empty.hint')}</p>
        </div>
      ) : (
        <>
          <div className="catalog-controls">
            <input
              className="catalog-search"
              placeholder={t('catalog.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="catalog-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">{t('catalog.allCategories', { n: textures.length })}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="catalog-count">
            {t('catalog.count', { n: filtered.length, max: MAX_VISIBLE })}
            {added.size > 0 && t('catalog.addedCount', { n: added.size })}
          </div>

          <div className="catalog-grid">
            {visible.map((tex) => {
              const name = tex.id.split('/').pop() || tex.id;
              const isAdded = added.has(tex.id);
              return (
                <div key={tex.id} className="catalog-card">
                  <div className="catalog-thumb-wrap">
                    <VanillaThumb id={tex.id} />
                  </div>
                  <div className="catalog-text">
                    <div className="catalog-name" title={tex.id}>
                      {name}
                    </div>
                    <div className="catalog-path">{tex.category}</div>
                  </div>
                  <button
                    className={'btn-primary catalog-add' + (isAdded ? ' added' : '')}
                    disabled={busy !== null || isAdded}
                    onClick={() => handleAdd(tex)}
                  >
                    {isAdded ? t('catalog.added') : busy === tex.id ? t('catalog.adding') : t('catalog.add')}
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
