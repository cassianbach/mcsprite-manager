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
  const res = await dialog.showOpenDialog({
    title: isTexture ? 'Upload texture (PNG)' : 'Upload pack (ZIP)',
    properties: ['openFile'],
    filters: [{ name: isTexture ? 'PNG' : 'ZIP', extensions: [isTexture ? 'png' : 'zip'] }],
  });
  if (res.canceled || res.filePaths.length === 0) return { cancelled: true };
  const src = res.filePaths[0];
  const buf = await fs.readFile(src);
  const form = new FormData();
  form.append('file', new Blob([buf]), basename(src));
  const headers = await authHeaders();
  const r = await fetch(`${BASE_URL}/api/catalog/${isTexture ? 'textures' : 'packs'}`, { method: 'POST', headers, body: form });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as { error?: string };
    throw new Error(j.error || `Upload failed: ${r.status}`);
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
