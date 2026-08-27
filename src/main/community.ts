import { app, dialog } from 'electron';
import { basename } from 'node:path';
import { promises as fs } from 'node:fs';

const BASE_URL = 'https://mcsprite-manager-community.cassian-raban-bach.workers.dev';

async function getToken(): Promise<string | null> {
  const { getToken } = await import('./auth');
  return getToken();
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface CommunityTexture {
  id: string;
  path: string;
  name: string;
  width: number;
  height: number;
  uploader: string;
  uploadedAt: number;
  sizeBytes: number;
  originalFileName: string;
  tags: string[];
}
export interface CommunityPack {
  id: string;
  fileName: string;
  originalFileName: string;
  description: string;
  textureCount: number;
  sizeBytes: number;
  uploader: string;
  uploadedAt: number;
  tags: string[];
}

export async function communityList(opts?: { q?: string; tag?: string; type?: string }): Promise<{ textures: CommunityTexture[]; packs: CommunityPack[] }> {
  const params = new URLSearchParams();
  if (opts?.q) params.set('q', opts.q);
  if (opts?.tag) params.set('tag', opts.tag);
  if (opts?.type) params.set('type', opts.type);
  const qs = params.toString();
  const res = await fetch(`${BASE_URL}/api/catalog${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`Community list failed: ${res.status}`);
  return (await res.json()) as { textures: CommunityTexture[]; packs: CommunityPack[] };
}

async function pickAndUpload(kind: 'texture' | 'pack'): Promise<{ cancelled?: boolean; meta?: unknown }> {
  const isTexture = kind === 'texture';
  const maxBytes = isTexture ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
  const res = await dialog.showOpenDialog({
    title: isTexture ? 'Upload texture (PNG)' : 'Upload pack (ZIP)',
    properties: ['openFile'],
    filters: [{ name: isTexture ? 'PNG' : 'ZIP', extensions: [isTexture ? 'png' : 'zip'] }],
  });
  if (res.canceled || res.filePaths.length === 0) return { cancelled: true };
  const src = res.filePaths[0];
  let buf: Buffer;
  try {
    buf = await fs.readFile(src);
  } catch {
    throw new Error('Could not read the selected file. Check the path and try again.');
  }
  if (buf.length > maxBytes) {
    throw new Error(`File too large — max ${isTexture ? '5 MB' : '20 MB'} for a ${isTexture ? 'texture' : 'pack'}.`);
  }
  const form = new FormData();
  form.append('file', new Blob([buf]), basename(src));
  const headers = await authHeaders();
  let r: Response;
  try {
    r = await fetch(`${BASE_URL}/api/catalog/${isTexture ? 'textures' : 'packs'}`, { method: 'POST', headers, body: form });
  } catch (e) {
    throw new Error(`Upload failed (network): ${(e as Error).message}`);
  }
  if (!r.ok) {
    let detail = `HTTP ${r.status}`;
    try {
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      if (j && j.error) detail = j.error;
    } catch {}
    throw new Error(`Upload failed: ${detail}`);
  }
  return { meta: (await r.json()) as unknown };
}

export async function communityUploadTexture(): Promise<{ cancelled?: boolean; meta?: unknown }> {
  return pickAndUpload('texture');
}
export async function communityUploadPack(): Promise<{ cancelled?: boolean; meta?: unknown }> {
  return pickAndUpload('pack');
}

export async function communityDeleteTexture(id: string, reason?: string): Promise<boolean> {
  const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
  const r = await fetch(`${BASE_URL}/api/catalog/texture/${id}`, { method: 'DELETE', headers, body: JSON.stringify({ reason: reason ?? '' }) });
  if (!r.ok) { const j = (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as { error?: string }; throw new Error(j.error || 'Delete failed'); }
  return true;
}
export async function communityDeletePack(id: string, reason?: string): Promise<boolean> {
  const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
  const r = await fetch(`${BASE_URL}/api/catalog/pack/${id}`, { method: 'DELETE', headers, body: JSON.stringify({ reason: reason ?? '' }) });
  if (!r.ok) { const j = (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as { error?: string }; throw new Error(j.error || 'Delete failed'); }
  return true;
}

export async function communityGetModeration(): Promise<unknown[]> {
  const headers = await authHeaders();
  const r = await fetch(`${BASE_URL}/api/admin/moderation`, { headers });
  if (!r.ok) throw new Error('Admin only');
  return (await r.json()) as unknown[];
}

export async function communityGetAdmins(): Promise<string[]> {
  const headers = await authHeaders();
  const r = await fetch(`${BASE_URL}/api/admin/admins`, { headers });
  if (!r.ok) throw new Error('Admin only');
  const j = (await r.json()) as { admins: string[] };
  return j.admins ?? [];
}
export async function communityAddAdmin(handle: string): Promise<string[]> {
  const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
  const r = await fetch(`${BASE_URL}/api/admin/admins`, { method: 'POST', headers, body: JSON.stringify({ handle }) });
  if (!r.ok) { const j = (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as { error?: string }; throw new Error(j.error || 'Add admin failed'); }
  const j = (await r.json()) as { admins: string[] };
  return j.admins ?? [];
}
export async function communityRemoveAdmin(handle: string): Promise<string[]> {
  const headers = await authHeaders();
  const r = await fetch(`${BASE_URL}/api/admin/admins/${encodeURIComponent(handle)}`, { method: 'DELETE', headers });
  if (!r.ok) { const j = (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as { error?: string }; throw new Error(j.error || 'Remove admin failed'); }
  const j = (await r.json()) as { admins: string[] };
  return j.admins ?? [];
}

export async function communityAddToProject(projectId: string, id: string): Promise<{ ok: boolean; newId?: string }> {
  const res = await fetch(`${BASE_URL}/api/catalog/texture/${id}.png`);
  if (!res.ok) return { ok: false };
  const buf = Buffer.from(await res.arrayBuffer());
  const { PNG } = await import('pngjs');
  let png: InstanceType<typeof PNG>;
  try { png = PNG.sync.read(buf); } catch { return { ok: false }; }
  // fetch meta for name/path
  let name = id;
  let path = id;
  try {
    const list = await communityList();
    const t = list.textures.find((x) => x.id === id);
    if (t) { name = t.name; path = t.path; }
  } catch {}
  const { writeTextureBundle, idFromPath } = await import('./projectStore');
  const { randomUUID } = await import('node:crypto');
  const nid = `${idFromPath(path)}_${randomUUID().slice(0, 6)}`;
  await writeTextureBundle(projectId, nid, {
    width: png.width,
    height: png.height,
    frameCount: 1,
    pngBuffer: buf,
    source: 'user',
    path,
    name,
    animation: undefined,
  });
  return { ok: true, newId: nid };
}

export async function communityAddPackToProject(projectId: string, id: string): Promise<{ ok: boolean; imported?: number }> {
  const res = await fetch(`${BASE_URL}/api/catalog/pack/${id}.zip`);
  if (!res.ok) return { ok: false };
  const buf = Buffer.from(await res.arrayBuffer());
  const { join } = await import('node:path');
  const { app: app2 } = await import('electron');
  const { randomUUID } = await import('node:crypto');
  const tmp = join(app2.getPath('temp'), `community-pack-${randomUUID()}.zip`);
  await fs.writeFile(tmp, buf);
  try {
    const { readImportZip, applyImport } = await import('./projectStore');
    const session = await readImportZip(projectId, tmp);
    const selections = session.previews.map((p) => ({ path: p.path, action: 'import' as const }));
    const result = await applyImport(projectId, session, selections);
    return { ok: true, imported: result.imported };
  } finally {
    try { await fs.unlink(tmp); } catch {}
  }
}

export async function communityUpdateTextureTags(id: string, tags: string[]): Promise<unknown> {
  const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
  const r = await fetch(`${BASE_URL}/api/catalog/texture/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ tags }) });
  if (!r.ok) { const j = (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as { error?: string }; throw new Error(j.error || 'Tag update failed'); }
  return (await r.json()) as unknown;
}
export async function communityUpdatePackTags(id: string, tags: string[]): Promise<unknown> {
  const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
  const r = await fetch(`${BASE_URL}/api/catalog/pack/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ tags }) });
  if (!r.ok) { const j = (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as { error?: string }; throw new Error(j.error || 'Tag update failed'); }
  return (await r.json()) as unknown;
}
