import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Catalog.css';

interface UserTex { id: string; path: string; name: string; width: number; height: number; uploader: string; uploadedAt: number; tags?: string[]; }
interface UserPack { id: string; fileName: string; originalFileName: string; description: string; textureCount: number; sizeBytes: number; uploader: string; uploadedAt: number; tags?: string[]; }

function TexturePreview({ id, w, h }: { id: string; w: number; h: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void window.api.library.getTextureDataUrl(id).then((url) => { if (alive) setSrc(url); });
    return () => { alive = false; };
  }, [id]);
  if (!src) return <div style={{ width: 96, height: 96, background: 'var(--bg-2)', borderRadius: 4 }} />;
  const scale = Math.min(96 / w, 96 / h, 6);
  return <img src={src} alt="" width={Math.round(w * scale)} height={Math.round(h * scale)} style={{ imageRendering: 'pixelated', borderRadius: 2, background: 'var(--bg-2)' }} />;
}

function TagEditor({ tags, onChange, canEdit }: { tags: string[]; onChange: (tags: string[]) => void; canEdit: boolean }) {
  const [input, setInput] = useState('');
  const add = () => {
    const t = input.trim().toLowerCase();
    if (!t || tags.includes(t)) { setInput(''); return; }
    onChange([...tags, t]);
    setInput('');
  };
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
      {tags.map((t) => (
        <span key={t} style={{ fontSize: 10, border: '1px solid var(--line)', borderRadius: 10, padding: '1px 6px', display: 'inline-flex', gap: 4, alignItems: 'center', background: 'var(--bg-0)' }}>
          #{t} {canEdit && <button onClick={() => onChange(tags.filter((x) => x !== t))} style={{ color: 'var(--fg-3)' }}>×</button>}
        </span>
      ))}
      {canEdit && (
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <input className="color-input" style={{ width: 90, fontSize: 11, padding: '2px 4px' }} placeholder="add tag" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <button className="btn btn-ghost" style={{ padding: '2px 6px', fontSize: 11 }} onClick={add}>+</button>
        </span>
      )}
    </div>
  );
}

export function UploadedCatalog(): JSX.Element {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'textures' | 'packs'>('textures');
  const [textures, setTextures] = useState<UserTex[]>([]);
  const [packs, setPacks] = useState<UserPack[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [addTarget, setAddTarget] = useState('');
  const [handle, setHandle] = useState<string | null>(null);
  const [admins, setAdmins] = useState<string[]>([]);
  const [newAdmin, setNewAdmin] = useState('');
  const [msg, setMsg] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const isAdmin = !!handle && admins.map((a) => a.toLowerCase()).includes(handle.toLowerCase());

  async function refresh() {
    try {
      const [tex, pa, projs, h, ads] = await Promise.all([
        window.api.library.listTextures(),
        window.api.library.listPacks(),
        window.api.projects.list(),
        window.api.auth.getHandle(),
        window.api.library.getAdmins(),
      ]);
      setTextures(tex as UserTex[]);
      setPacks(pa as UserPack[]);
      setProjects(projs.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
      setHandle(h as string | null);
      setAdmins(ads);
      if (projs.length > 0 && !addTarget) setAddTarget(projs[0].id);
    } catch {}
  }
  useEffect(() => { void refresh(); }, []);

  const [deviceInfo, setDeviceInfo] = useState<{ user_code: string; verification_uri: string } | null>(null);

  async function onLogin() {
    setLoggingIn(true); setDeviceInfo(null); setMsg('');
    try {
      const dev = await window.api.auth.startDeviceFlow() as { user_code: string; verification_uri: string; verification_uri_complete?: string; device_code: string; interval: number; expires_in: number };
      setDeviceInfo({ user_code: dev.user_code, verification_uri: dev.verification_uri });
      setMsg(`Browser opened to ${dev.verification_uri}. Enter code: ${dev.user_code}`);
      const res = await window.api.auth.pollDeviceFlow(dev.device_code, dev.interval, dev.expires_in) as { handle: string };
      setHandle(res.handle); setMsg(`Logged in as ${res.handle}.`); setDeviceInfo(null); void refresh();
    } catch (e) { setMsg(`Login failed: ${(e as Error).message}`); setDeviceInfo(null); }
    finally { setLoggingIn(false); }
  }
  async function onLogout() {
    await window.api.auth.logout(); setHandle(null); setMsg('Logged out.');
  }
  async function onUploadTexture() {
    if (!handle) { setMsg('Please login with GitHub first.'); return; }
    const res = await window.api.library.uploadTexture() as { cancelled?: boolean };
    if (!res.cancelled) { setMsg('Texture uploaded to My Uploads.'); void refresh(); }
  }
  async function onUploadPack() {
    if (!handle) { setMsg('Please login with GitHub first.'); return; }
    const res = await window.api.library.uploadPack() as { cancelled?: boolean };
    if (!res.cancelled) { setMsg('Pack uploaded to My Uploads.'); void refresh(); }
  }
  async function onDeleteTex(id: string) {
    const t = textures.find((x) => x.id === id);
    if (!isAdmin && t && t.uploader !== handle) { setMsg('Only owner or admin can delete.'); return; }
    const reason = isAdmin ? (prompt('Delete reason:') ?? null) : '';
    if (reason === null) return;
    try { await window.api.library.deleteTexture(id, reason); void refresh(); } catch (e) { setMsg((e as Error).message); }
  }
  async function onDeletePack(id: string) {
    const p = packs.find((x) => x.id === id);
    if (!isAdmin && p && p.uploader !== handle) { setMsg('Only owner or admin can delete.'); return; }
    const reason = prompt('Delete reason (stored for moderation log):');
    if (reason === null) return;
    try { await window.api.library.deletePack(id, reason); void refresh(); } catch (e) { setMsg((e as Error).message); }
  }
  async function onAddToProject(texId: string) {
    if (!addTarget) { setMsg('Pick a project first.'); return; }
    const r = await window.api.library.addToProject(addTarget, texId) as { ok: boolean };
    if (r.ok) setMsg('Added to project.'); else setMsg('Failed to add.');
  }
  async function doAddAdmin() {
    if (!newAdmin.trim()) return;
    try {
      const ads = await window.api.library.addAdmin(newAdmin) as string[];
      setAdmins(ads); setNewAdmin(''); setMsg(`Admin added: ${newAdmin}`);
    } catch (e) { setMsg((e as Error).message); }
  }
  async function doRemoveAdmin(h: string) {
    try {
      const ads = await window.api.library.removeAdmin(h) as string[];
      setAdmins(ads);
    } catch (e) { setMsg((e as Error).message); }
  }
  async function onTagTex(id: string, tags: string[]) {
    await window.api.library.updateTextureTags(id, tags); void refresh();
  }
  async function onTagPack(id: string, tags: string[]) {
    await window.api.library.updatePackTags(id, tags); void refresh();
  }

  const allTags = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of textures) for (const tag of (t.tags ?? [])) c.set(tag, (c.get(tag) ?? 0) + 1);
    for (const p of packs) for (const tag of (p.tags ?? [])) c.set(tag, (c.get(tag) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  }, [textures, packs]);

  const q = search.trim().toLowerCase();
  const filteredTextures = useMemo(() => textures.filter((t) => {
    if (tagFilter && !(t.tags ?? []).includes(tagFilter)) return false;
    if (!q) return true;
    return t.name.toLowerCase().includes(q) || t.path.toLowerCase().includes(q) || t.uploader.toLowerCase().includes(q) || (t.tags ?? []).some((x) => x.includes(q));
  }), [textures, q, tagFilter]);
  const filteredPacks = useMemo(() => packs.filter((p) => {
    if (tagFilter && !(p.tags ?? []).includes(tagFilter)) return false;
    if (!q) return true;
    return p.originalFileName.toLowerCase().includes(q) || p.uploader.toLowerCase().includes(q) || (p.tags ?? []).some((x) => x.includes(q));
  }), [packs, q, tagFilter]);

  return (
    <div className="catalog">
      <header className="catalog-head">
        <h1>Community Catalogue</h1>
        <p className="catalog-sub">My Uploads are local. Community (Fly.io) comes next — this builds the local foundation.</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          {handle ? (
            <>
              <span style={{ fontSize: 12, fontWeight: 600 }}>@{handle}</span>
              <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{isAdmin ? 'Admin ✓' : 'Not admin'}</span>
              <button className="btn btn-ghost" onClick={onLogout}>Logout</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={onLogin} disabled={loggingIn}>{loggingIn ? 'Waiting for GitHub...' : 'Login with GitHub'}</button>
              <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>Login to upload — prevents impersonating admins.</span>
            </>
          )}
        </div>
        {deviceInfo && (
          <div style={{ marginTop: 8, padding: 8, border: '1px solid var(--accent)', borderRadius: 6, background: 'var(--bg-1)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>GitHub authorization required</span>
            <span style={{ fontSize: 12 }}>Go to <a href={deviceInfo.verification_uri} target="_blank" rel="noreferrer">{deviceInfo.verification_uri}</a> and enter code:</span>
            <code style={{ fontSize: 20, letterSpacing: 4, fontWeight: 700, userSelect: 'all', background: 'var(--bg-0)', padding: '4px 8px', borderRadius: 4, alignSelf: 'flex-start' }}>{deviceInfo.user_code}</code>
            <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>The browser should have opened automatically. This code expires in ~15 minutes.</span>
          </div>
        )}
      </header>

      <div className="catalog-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onUploadTexture} disabled={!handle}>Upload Texture</button>
        <button className="btn" onClick={onUploadPack} disabled={!handle}>Upload Pack</button>
        <button className="btn btn-ghost" onClick={() => navigate('/projects')}>Back to Projects</button>
        {msg && <span style={{ fontSize: 12, color: 'var(--fg-2)', alignSelf: 'center' }}>{msg}</span>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="catalog-search" placeholder="Search name, tag, uploader..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 300 }} />
        {tagFilter && <button className="btn btn-ghost" onClick={() => setTagFilter(null)}>Clear tag: #{tagFilter} ×</button>}
      </div>
      {allTags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {allTags.map(([tag, count]) => (
            <button key={tag} onClick={() => setTagFilter(tagFilter === tag ? null : tag)} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, border: tagFilter === tag ? '1px solid var(--accent)' : '1px solid var(--line)', background: tagFilter === tag ? 'var(--accent-soft)' : 'var(--bg-1)', color: tagFilter === tag ? 'var(--accent)' : 'var(--fg-2)' }}>#{tag} ({count})</button>
          ))}
        </div>
      )}

      <div className="catalog-tabs" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className={`btn ${tab === 'textures' ? '' : 'btn-ghost'}`} onClick={() => setTab('textures')}>Textures ({filteredTextures.length}/{textures.length})</button>
        <button className={`btn ${tab === 'packs' ? '' : 'btn-ghost'}`} onClick={() => setTab('packs')}>Packs ({filteredPacks.length}/{packs.length})</button>
      </div>

      {tab === 'textures' ? (
        filteredTextures.length === 0 ? <p style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 12 }}>{textures.length === 0 ? 'No uploads yet. Login and use Upload Texture.' : 'No matches.'}</p> :
        <div className="catalog-grid" style={{ marginTop: 12 }}>
          {filteredTextures.map((t) => (
            <div key={t.id} className="catalog-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div className="catalog-thumb-wrap" style={{ minHeight: 120 }}>
                <TexturePreview id={t.id} w={t.width} h={t.height} />
              </div>
              <div className="catalog-text" style={{ flex: 1 }}>
                <div className="catalog-name">{t.name}</div>
                <div className="catalog-path">{t.path} · {t.width}×{t.height} · by {t.uploader}</div>
                <TagEditor tags={t.tags ?? []} onChange={(nt) => onTagTex(t.id, nt)} canEdit={isAdmin || t.uploader === handle} />
              </div>
              <div style={{ display: 'flex', gap: 6, padding: '6px 8px', borderTop: '1px solid var(--line)', alignItems: 'center' }}>
                <select value={addTarget} onChange={(e) => setAddTarget(e.target.value)} style={{ flex: 1, fontSize: 11, minWidth: 0 }}>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button className="btn btn-ghost" onClick={() => onAddToProject(t.id)} style={{ fontSize: 11, padding: '4px 8px' }}>Add</button>
                <button className="btn btn-ghost" onClick={() => onDeleteTex(t.id)} style={{ fontSize: 11, padding: '4px 8px' }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        filteredPacks.length === 0 ? <p style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 12 }}>{packs.length === 0 ? 'No packs yet. Login and use Upload Pack.' : 'No matches.'}</p> :
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {filteredPacks.map((p) => (
            <div key={p.id} className="catalog-card" style={{ padding: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{p.originalFileName}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{p.textureCount} textures · {(p.sizeBytes/1024).toFixed(0)} KB · by {p.uploader}</div>
                </div>
                {isAdmin && <button className="btn btn-ghost" onClick={() => onDeletePack(p.id)} style={{ color: 'var(--danger)' }}>Delete</button>}
              </div>
              <TagEditor tags={p.tags ?? []} onChange={(nt) => onTagPack(p.id, nt)} canEdit={isAdmin || p.uploader === handle} />
            </div>
          ))}
        </div>
      )}

      <section className="catalog-card" style={{ marginTop: 16, borderLeft: isAdmin ? '3px solid var(--danger)' : undefined }}>
        <h3 style={{ fontSize: 13, margin: 0 }}>Admin Panel {isAdmin ? '✓' : '(admin only)'}</h3>
        {!isAdmin ? <p style={{ fontSize: 11, color: 'var(--fg-3)' }}>Login as an admin to manage admins.</p> : (
          <>
            <p style={{ fontSize: 11, color: 'var(--fg-3)' }}>Add GitHub usernames to grant admin (delete). You ({handle}) {isAdmin ? 'are' : 'are not'} admin.</p>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input className="color-input" placeholder="github username" value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doAddAdmin()} />
              <button className="btn" onClick={doAddAdmin}>Add admin</button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {admins.map((a) => (
                <span key={a} style={{ fontSize: 12, border: '1px solid var(--line)', borderRadius: 6, padding: '2px 6px', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  {a} {a !== 'cassianbach' && <button onClick={() => doRemoveAdmin(a)} style={{ color: 'var(--danger)' }}>×</button>}
                </span>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
