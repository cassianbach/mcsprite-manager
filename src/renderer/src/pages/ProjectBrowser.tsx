import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';
import { useTranslate, translateLabelWith } from '../i18n';
import { useSettings } from '../store/settings';
import type { ProjectListEntry } from '@shared/types';
import './ProjectBrowser.css';

type Filter = 'all' | 'mc' | 'sprite' | 'modified';

export function ProjectBrowser(): JSX.Element {
  const t = useTranslate();
  const lang = useSettings((s) => s.language ?? 'en');
  const [projects, setProjects] = useState<ProjectListEntry[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [modifiedOnly, setModifiedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('My Project');
  const [newKind, setNewKind] = useState<'mc' | 'sprite'>('mc');

  async function refresh(): Promise<void> {
    setLoading(true);
    try {
      const list = await window.api.projects.list();
      setProjects(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleCreate(): Promise<void> {
    const project = await window.api.projects.create({
      name: newName,
      kind: newKind,
      packFormat: newKind === 'mc' ? 75 : undefined,
    });
    setShowCreate(false);
    setNewName('My Project');
    setNewKind('mc');
    await refresh();
    window.location.hash = `#/project/${project.id}`;
  }

  async function handleDelete(id: string, name: string): Promise<void> {
    if (!confirm(t('projects.deleteConfirm', { name }))) return;
    await window.api.projects.delete(id);
    await refresh();
  }

  const visible = projects.filter((p) => {
    if (modifiedOnly && p.modifiedCount === 0) return false;
    if (filter === 'mc') return p.kind === 'mc' || p.kind === 'mixed';
    if (filter === 'sprite') return p.kind === 'sprite';
    return true;
  });

  return (
    <div className="project-browser">
      <header className="project-browser-header">
        <div className="project-browser-hero">
          <Logo size={56} />
          <div>
            <h1>{t('projects.title')}</h1>
            <p>{t('projects.subtitle')}</p>
          </div>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          {t('projects.newProject')}
        </Button>
      </header>

      <div className="filter-row">
        {(['all', 'mc', 'sprite'] as const).map((f) => (
          <button
            key={f}
            className={'filter-chip' + (filter === f ? ' active' : '')}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? t('projects.filter.all') : f === 'mc' ? t('projects.filter.mc') : t('projects.filter.sprite')}
          </button>
        ))}
        <button
          className={'filter-chip' + (modifiedOnly ? ' active' : '')}
          onClick={() => setModifiedOnly((v) => !v)}
        >
          {t('projects.filter.modified')}
        </button>
      </div>

      {showCreate && (
        <div
          className="empty"
          style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'stretch', marginBottom: 16 }}
        >
          <h2>{t('projects.create.title')}</h2>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{t('projects.create.nameLabel')}</span>
            <input
              className="color-input"
              style={{ background: 'var(--bg-1)' }}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{t('projects.create.kindLabel')}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['mc', 'sprite'] as const).map((k) => (
                <button
                  key={k}
                  className={'filter-chip' + (newKind === k ? ' active' : '')}
                  onClick={() => setNewKind(k)}
                >
                  {k === 'mc' ? t('projects.create.kindMc') : t('projects.create.kindSprite')}
                </button>
              ))}
            </div>
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={handleCreate}>
              {t('common.create')}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty">{t('common.loading')}</div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <h2>{t('projects.empty.title')}</h2>
          <p>{t('projects.empty.body')}</p>
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            {t('projects.newProject')}
          </Button>
        </div>
      ) : (
        <div className="project-grid">
          {visible.map((p) => (
            <div key={p.id} className="project-card-wrap" style={{ position: 'relative' }}>
              <Link to={`/project/${p.id}`} className="project-card">
                <div className="project-card-thumb">{t('projects.noPreview')}</div>
                <div className="project-card-body">
                  <h3 className="project-card-title">{p.name}</h3>
                  <div className="project-card-meta">
                    <span className={'badge ' + (p.kind === 'mc' ? 'badge-mc' : 'badge-sprite')}>
                      {p.kind === 'mc' ? t('projects.kind.mc') : p.kind === 'sprite' ? t('projects.kind.sprite') : t('projects.kind.mixed')}
                    </span>
                    {p.mcVersion && <span>{p.mcVersion}</span>}
                    {p.modifiedCount > 0 && (
                      <span className="badge badge-modified">{t('projects.modifiedBadge', { n: p.modifiedCount })}</span>
                    )}
                    <span style={{ marginLeft: 'auto' }}>{t('projects.textureCount', { n: p.textureCount })}</span>
                  </div>
                </div>
              </Link>
              <button
                onClick={() => handleDelete(p.id, p.name)}
                title={t('projects.deleteTitle')}
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  width: 28,
                  height: 28,
                  borderRadius: 4,
                  background: 'rgba(0,0,0,0.4)',
                  color: 'var(--fg-1)',
                  fontSize: 14,
                }}
                aria-label={t('common.delete')}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
