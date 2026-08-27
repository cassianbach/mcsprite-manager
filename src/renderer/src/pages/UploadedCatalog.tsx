import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import './Catalog.css';

interface UserTex { id: string; path: string; name: string; width: number; height: number; uploader: string; uploadedAt: number; tags?: string[]; }
interface UserPack { id: string; fileName: string; originalFileName: string; description: string; textureCount: number; sizeBytes: number; uploader: string; uploadedAt: number; tags?: string[]; }

const COMMUNITY_BASE = 'https://mcsprite-manager-community.cassian-raban-bach.workers.dev';

function TexturePreview({ id, w, h, remote }: { id: string; w: number; h: number; remote?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (remote) {
      setSrc(`${COMMUNITY_BASE}/api/catalog/texture/${id}.png`);
    } else {
      void window.api.library.getTextureDataUrl(id).then((url) => { if (alive) setSrc(url); });
    }
    return () => { alive = false; };
  }, [id, remote]);
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
  const [scope, setScope] = useState<'community' | 'mine'>('community');
  const [tab, setTab] = useState<'textures' | 'packs'>('textures');
  const [textures, setTextures] = useState<UserTex[]>([]);
  const [packs, setPacks] = useState<UserPack[]>([]);
  const [communityTextures, setCommunityTextures] = useState<UserTex[]>([]);
  const [communityPacks, setCommunityPacks] = useState<UserPack[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [addTarget, setAddTarget] = useState('');
  const [handle, setHandle] = useState<string | null>(null);
  const [admins, setAdmins] = useState<string[]>([]);
  const [communityAdmins, setCommunityAdmins] = useState<string[]>([]);
  const [newAdmin, setNewAdmin] = useState('');
  const [msg, setMsg] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'texture' | 'pack'; id: string; name: string; scope: 'community' | 'mine' } | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const activeAdmins = scope === 'community' ? communityAdmins : admins;
  const isAdmin = !!handle && activeAdmins.map((a) => a.toLowerCase()).includes(handle.toLowerCase());

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

  async function refreshCommunity() {
    setCommunityLoading(true);
    try {
      const res = await window.api.community.list({ q: search || undefined, tag: tagFilter || undefined });
      setCommunityTextures((res.textures ?? []) as UserTex[]);
      setCommunityPacks((res.packs ?? []) as UserPack[]);
      if (handle) {
        try { setCommunityAdmins(await window.api.community.getAdmins()); } catch {}
      }
    } catch (e) { setMsg(`Community: ${(e as Error).message}`); }
    finally { setCommunityLoading(false); }
  }
  useEffect(() => { if (scope === 'community') void refreshCommunity(); }, [scope, search, tagFilter]);

  useEffect(() => {
    if (scope === 'community' && handle) {
      window.api.community.getAdmins().then((a) => setCommunityAdmins(a as string[])).catch(() => {});
    } else {
      setCommunityAdmins([]);
    }
  }, [scope, handle]);

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
    if (scope === 'community') {
      const res = await window.api.community.uploadTexture() as { cancelled?: boolean };
      if (!res.cancelled) { setMsg('Texture uploaded to Community.'); void refreshCommunity(); }
    } else {
      const res = await window.api.library.uploadTexture() as { cancelled?: boolean };
      if (!res.cancelled) { setMsg('Texture uploaded to My Uploads.'); void refresh(); }
    }
  }
  async function onUploadPack() {
    if (!handle) { setMsg('Please login with GitHub first.'); return; }
    if (scope === 'community') {
      const res = await window.api.community.uploadPack() as { cancelled?: boolean };
      if (!res.cancelled) { setMsg('Pack uploaded to Community.'); void refreshCommunity(); }
    } else {
      const res = await window.api.library.uploadPack() as { cancelled?: boolean };
      if (!res.cancelled) { setMsg('Pack uploaded to My Uploads.'); void refresh(); }
    }
  }
  async function onDeleteTex(id: string) {
    const list = scope === 'community' ? communityTextures : textures;
    const t = list.find((x) => x.id === id);
    if (!isAdmin && t && t.uploader !== handle) { setMsg('Only owner or admin can delete.'); return; }
    setDeleteTarget({ kind: 'texture', id, name: t?.name ?? id, scope });
    setDeleteReason('');
  }
  async function onDeletePack(id: string) {
    const list = scope === 'community' ? communityPacks : packs;
    const p = list.find((x) => x.id === id);
    if (!isAdmin && p && p.uploader !== handle) { setMsg('Only owner or admin can delete.'); return; }
    setDeleteTarget({ kind: 'pack', id, name: p?.originalFileName ?? id, scope });
    setDeleteReason('');
  }
  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.scope === 'community') {
        if (deleteTarget.kind === 'texture') await window.api.community.deleteTexture(deleteTarget.id, deleteReason);
        else await window.api.community.deletePack(deleteTarget.id, deleteReason);
        void refreshCommunity();
      } else {
        if (deleteTarget.kind === 'texture') await window.api.library.deleteTexture(deleteTarget.id, deleteReason);
        else await window.api.library.deletePack(deleteTarget.id, deleteReason);
        void refresh();
      }
      setMsg('Deleted.');
      setDeleteTarget(null);
    } catch (e) { setMsg((e as Error).message); }
  }
  async function onAddToProject(texId: string) {
    if (!addTarget) { setMsg('Pick a project first.'); return; }
    try {
      const r = scope === 'community'
        ? await window.api.community.addToProject(addTarget, texId) as { ok: boolean }
        : await window.api.library.addToProject(addTarget, texId) as { ok: boolean };
      if (r.ok) setMsg('Added to project.'); else setMsg('Failed to add.');
    } catch (e) { setMsg((e as Error).message); }
  }
  async function onAddPackToProject(packId: string) {
    if (!addTarget) { setMsg('Pick a project first.'); return; }
    try {
      const r = scope === 'community'
        ? await window.api.community.addPackToProject(addTarget, packId) as { ok: boolean; imported?: number }
        : { ok: false };
      if (r.ok) setMsg(`Added pack (${r.imported ?? 0} textures).`); else setMsg('Failed to add pack.');
    } catch (e) { setMsg((e as Error).message); }
  }
  async function doAddAdmin() {
    if (!newAdmin.trim()) return;
    try {
      if (scope === 'community') {
        const ads = await window.api.community.addAdmin(newAdmin) as string[];
        setCommunityAdmins(ads); setNewAdmin(''); setMsg(`Community admin added: ${newAdmin}`);
      } else {
        const ads = await window.api.library.addAdmin(newAdmin) as string[];
        setAdmins(ads); setNewAdmin(''); setMsg(`Admin added: ${newAdmin}`);
      }
    } catch (e) { setMsg((e as Error).message); }
  }
  async function doRemoveAdmin(h: string) {
    try {
      if (scope === 'community') {
        const ads = await window.api.community.removeAdmin(h) as string[];
        setCommunityAdmins(ads);
      } else {
        const ads = await window.api.library.removeAdmin(h) as string[];
        setAdmins(ads);
      }
    } catch (e) { setMsg((e as Error).message); }
  }
  async function onTagTex(id: string, tags: string[]) {
    try {
      if (scope === 'community') { await window.api.community.updateTextureTags(id, tags); void refreshCommunity(); }
      else { await window.api.library.updateTextureTags(id, tags); void refresh(); }
    } catch (e) { setMsg((e as Error).message); }
  }
  async function onTagPack(id: string, tags: string[]) {
    try {
      if (scope === 'community') { await window.api.community.updatePackTags(id, tags); void refreshCommunity(); }
      else { await window.api.library.updatePackTags(id, tags); void refresh(); }
    } catch (e) { setMsg((e as Error).message); }
  }

  const allTags = useMemo(() => {
    const c = new Map<string, number>();
    const srcTex = scope === 'community' ? communityTextures : textures;
    const srcPack = scope === 'community' ? communityPacks : packs;
    for (const t of srcTex) for (const tag of (t.tags ?? [])) c.set(tag, (c.get(tag) ?? 0) + 1);
    for (const p of srcPack) for (const tag of (p.tags ?? [])) c.set(tag, (c.get(tag) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  }, [textures, packs, communityTextures, communityPacks, scope]);

  const q = search.trim().toLowerCase();
  const srcTextures = scope === 'community' ? communityTextures : textures;
  const srcPacks = scope === 'community' ? communityPacks : packs;
  const filteredTextures = useMemo(() => srcTextures.filter((t) => {
    if (tagFilter && !(t.tags ?? []).includes(tagFilter)) return false;
    if (!q) return true;
    return t.name.toLowerCase().includes(q) || t.path.toLowerCase().includes(q) || t.uploader.toLowerCase().includes(q) || (t.tags ?? []).some((x) => x.includes(q));
  }), [srcTextures, q, tagFilter]);
  const filteredPacks = useMemo(() => srcPacks.filter((p) => {
    if (tagFilter && !(p.tags ?? []).includes(tagFilter)) return false;
    if (!q) return true;
    return p.originalFileName.toLowerCase().includes(q) || p.uploader.toLowerCase().includes(q) || (p.tags ?? []).some((x) => x.includes(q));
  }), [srcPacks, q, tagFilter]);

  return (
    <div className="catalog">
      <header className="catalog-head">
        <h1>Community Catalogue</h1>
        <p className="catalog-sub">Browse and upload textures & packs. Community is global (Cloudflare); My Uploads is local.</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <div className="seg">
            <button className={scope === 'community' ? 'active' : ''} onClick={() => setScope('community')}>Community</button>
            <button className={scope === 'mine' ? 'active' : ''} onClick={() => setScope('mine')}>My Uploads</button>
          </div>
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
        {communityLoading && <span style={{ fontSize: 12, color: 'var(--fg-3)', alignSelf: 'center' }}>Loading community…</span>}
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
        <button className={`btn ${tab === 'textures' ? '' : 'btn-ghost'}`} onClick={() => setTab('textures')}>Textures ({filteredTextures.length}/{srcTextures.length})</button>
        <button className={`btn ${tab === 'packs' ? '' : 'btn-ghost'}`} onClick={() => setTab('packs')}>Packs ({filteredPacks.length}/{srcPacks.length})</button>
      </div>

      {tab === 'textures' ? (
        filteredTextures.length === 0 ? <p style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 12 }}>{srcTextures.length === 0 ? (scope === 'community' ? 'No community uploads yet.' : 'No uploads yet. Login and use Upload Texture.') : 'No matches.'}</p> :
        <div className="catalog-grid" style={{ marginTop: 12 }}>
          {filteredTextures.map((t) => (
            <div key={t.id} className="catalog-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div className="catalog-thumb-wrap" style={{ minHeight: 120 }}>
                <TexturePreview id={t.id} w={t.width} h={t.height} remote={scope === 'community'} />
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
                {(isAdmin || t.uploader === handle) && <button className="btn btn-ghost" onClick={() => onDeleteTex(t.id)} style={{ fontSize: 11, padding: '4px 8px' }}>Delete</button>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        filteredPacks.length === 0 ? <p style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 12 }}>{srcPacks.length === 0 ? (scope === 'community' ? 'No community packs yet.' : 'No packs yet. Login and use Upload Pack.') : 'No matches.'}</p> :
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {filteredPacks.map((p) => (
            <div key={p.id} className="catalog-card" style={{ padding: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{p.originalFileName}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{p.textureCount} textures · {(p.sizeBytes/1024).toFixed(0)} KB · by {p.uploader}</div>
                </div>
                {(isAdmin || p.uploader === handle) && <button className="btn btn-ghost" onClick={() => onDeletePack(p.id)} style={{ color: 'var(--danger)' }}>Delete</button>}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                <select value={addTarget} onChange={(e) => setAddTarget(e.target.value)} style={{ flex: 1, fontSize: 11, minWidth: 0 }}>
                  {projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                </select>
                <button className="btn btn-ghost" onClick={() => onAddPackToProject(p.id)} style={{ fontSize: 11, padding: '4px 8px' }}>Add to project</button>
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
              {activeAdmins.map((a) => (
                <span key={a} style={{ fontSize: 12, border: '1px solid var(--line)', borderRadius: 6, padding: '2px 6px', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  {a} {a !== 'cassianbach' && <button onClick={() => doRemoveAdmin(a)} style={{ color: 'var(--danger)' }}>×</button>}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete {deleteTarget.kind}?</h3>
            <p>
              This will permanently delete <strong>{deleteTarget.name}</strong>.
            </p>
            {isAdmin && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: 'var(--fg-2)', display: 'block', marginBottom: 4 }}>
                  Reason (stored in moderation log)
                </label>
                <input
                  className="color-input"
                  style={{ width: '100%', background: 'var(--bg-1)', padding: '6px 8px', fontSize: 12 }}
                  placeholder="e.g. NSFW, copyright, spam…"
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  autoFocus
                />
              </div>
            )}
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button variant="danger" onClick={confirmDelete}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
