import { app, dialog } from 'electron';
import { join, basename } from 'node:path';
import { existsSync, promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';

const LIB_ROOT = (): string => join(app.getPath('userData'), 'user-library');
const TEX_DIR = (): string => join(LIB_ROOT(), 'textures');
const PACKS_DIR = (): string => join(LIB_ROOT(), 'packs');
const ADMINS_PATH = (): string => join(LIB_ROOT(), 'admins.json');

export interface UserTextureMeta {
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

export interface UserPackMeta {
  id: string;
  fileName: string;
  originalFileName: string;
  description: string;
  packFormat?: number;
  textureCount: number;
  sizeBytes: number;
  uploader: string;
  uploadedAt: number;
  tags: string[];
}

export interface AdminStore {
  admins: string[];
}

async function ensureDirs(): Promise<void> {
  await fs.mkdir(TEX_DIR(), { recursive: true });
  await fs.mkdir(PACKS_DIR(), { recursive: true });
}

async function readAdminsRaw(): Promise<string[]> {
  try {
    if (!existsSync(ADMINS_PATH())) return ['cassianbach'];
    let raw: string;
    try {
      const enc = await fs.readFile(ADMINS_PATH(), 'utf8');
      // Try safeStorage decrypt first (if file was encrypted)
      const { safeStorage } = await import('electron');
      if (safeStorage.isEncryptionAvailable()) {
        try {
          const parsedEnc = JSON.parse(enc) as { encrypted?: string };
          if (parsedEnc.encrypted) {
            raw = safeStorage.decryptString(Buffer.from(parsedEnc.encrypted, 'base64'));
          } else raw = enc;
        } catch { raw = enc; }
      } else raw = enc;
    } catch { return ['cassianbach']; }
    const parsed = JSON.parse(raw) as AdminStore;
    if (Array.isArray(parsed.admins) && parsed.admins.length > 0) return parsed.admins.map((s) => s.toLowerCase());
    return ['cassianbach'];
  } catch {
    return ['cassianbach'];
  }
}

export async function getAdmins(): Promise<string[]> {
  return readAdminsRaw();
}

export async function setAdmins(admins: string[]): Promise<string[]> {
  await ensureDirs();
  const clean = [...new Set(admins.map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (!clean.includes('cassianbach')) clean.unshift('cassianbach');
  const raw = JSON.stringify({ admins: clean }, null, 2);
  try {
    const { safeStorage } = await import('electron');
    if (safeStorage.isEncryptionAvailable()) {
      const enc = safeStorage.encryptString(raw).toString('base64');
      await fs.writeFile(ADMINS_PATH(), JSON.stringify({ encrypted: enc }, null, 2), 'utf8');
      return clean;
    }
  } catch {}
  await fs.writeFile(ADMINS_PATH(), raw, 'utf8');
  return clean;
}

export async function addAdmin(handle: string): Promise<string[]> {
  const { getVerifiedHandle } = await import('./auth');
  const caller = await getVerifiedHandle();
  const cur = await readAdminsRaw();
  if (!caller || !cur.includes(caller.toLowerCase())) throw new Error('Only admins can grant admin — please login as an admin');
  const h = handle.trim().toLowerCase();
  if (!h || cur.includes(h)) return cur;
  return setAdmins([...cur, h]);
}

export async function removeAdmin(handle: string): Promise<string[]> {
  const { getVerifiedHandle } = await import('./auth');
  const caller = await getVerifiedHandle();
  const cur = await readAdminsRaw();
  if (!caller || !cur.includes(caller.toLowerCase())) throw new Error('Only admins can revoke admin');
  const h = handle.trim().toLowerCase();
  // never remove cassianbach
  if (h === 'cassianbach') return cur;
  return setAdmins(cur.filter((x) => x !== h));
}

export async function isAdmin(handle: string): Promise<boolean> {
  const admins = await readAdminsRaw();
  return admins.includes(handle.trim().toLowerCase());
}

// --- Moderation log for deletes ---
const MODERATION_PATH = (): string => join(LIB_ROOT(), 'moderation.json');
export interface ModerationEntry { id: string; type: 'texture' | 'pack'; deletedAt: number; deletedBy: string | null; reason: string; author: string; originalName: string; }
async function readModeration(): Promise<ModerationEntry[]> {
  try {
    if (!existsSync(MODERATION_PATH())) return [];
    return JSON.parse(await fs.readFile(MODERATION_PATH(), 'utf8')) as ModerationEntry[];
  } catch { return []; }
}
export async function getModerationLog(): Promise<ModerationEntry[]> { return readModeration(); }
async function appendModeration(e: ModerationEntry): Promise<void> {
  const cur = await readModeration();
  cur.unshift(e);
  await ensureDirs();
  await fs.writeFile(MODERATION_PATH(), JSON.stringify(cur.slice(0, 200), null, 2), 'utf8');
}

// Handle is now verified via GitHub OAuth (auth.ts). Keep legacy handle.json
// for backwards compat — delegate to auth.
export async function getMyHandle(): Promise<string | null> {
  const { getVerifiedHandle } = await import('./auth');
  const v = await getVerifiedHandle();
  if (v) return v;
  // fallback to legacy file
  const HANDLE_PATH = join(LIB_ROOT(), 'handle.json');
  try {
    if (!existsSync(HANDLE_PATH)) return null;
    const raw = await fs.readFile(HANDLE_PATH, 'utf8');
    const j = JSON.parse(raw) as { handle?: string };
    return j.handle?.trim() || null;
  } catch { return null; }
}
export async function setMyHandle(handle: string): Promise<string | null> {
  // Setting handle manually is deprecated — login via GitHub is required.
  // Still support it for backwards compat, but mark as unverified.
  await ensureDirs();
  const h = handle.trim();
  const HANDLE_PATH = join(LIB_ROOT(), 'handle.json');
  if (!h) {
    try { await fs.unlink(HANDLE_PATH); } catch {}
    return null;
  }
  await fs.writeFile(HANDLE_PATH, JSON.stringify({ handle: h }, null, 2), 'utf8');
  return h;
}

export async function listUserTextures(): Promise<UserTextureMeta[]> {
  await ensureDirs();
  const files = await fs.readdir(TEX_DIR()).catch(() => [] as string[]);
  const metas: UserTextureMeta[] = [];
  for (const f of files) {
    if (!f.endsWith('.meta.json')) continue;
    try {
      const raw = await fs.readFile(join(TEX_DIR(), f), 'utf8');
      metas.push(JSON.parse(raw) as UserTextureMeta);
    } catch {}
  }
  return metas.sort((a, b) => b.uploadedAt - a.uploadedAt);
}

export async function listUserPacks(): Promise<UserPackMeta[]> {
  await ensureDirs();
  const files = await fs.readdir(PACKS_DIR()).catch(() => [] as string[]);
  const metas: UserPackMeta[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    // skip legacy? packs are stored as <id>.json + <id>.zip
    try {
      const raw = await fs.readFile(join(PACKS_DIR(), f), 'utf8');
      const j = JSON.parse(raw) as UserPackMeta;
      if (j.id) metas.push(j);
    } catch {}
  }
  return metas.sort((a, b) => b.uploadedAt - a.uploadedAt);
}

export async function uploadUserTexture(): Promise<{ cancelled?: boolean; meta?: UserTextureMeta }> {
  const res = await dialog.showOpenDialog({
    title: 'Upload texture (PNG)',
    properties: ['openFile'],
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  if (res.canceled || res.filePaths.length === 0) return { cancelled: true };
  const src = res.filePaths[0];
  const buf = await fs.readFile(src);
  let png: PNG;
  try { png = PNG.sync.read(buf); } catch { return { cancelled: true }; }
  const handle = (await getMyHandle()) ?? 'anonymous';
  const id = `${basename(src).replace(/\.png$/i, '').replace(/[^a-zA-Z0-9_.-]/g, '_')}_${randomUUID().slice(0, 6)}`;
  await ensureDirs();
  const meta: UserTextureMeta = {
    id,
    path: basename(src).replace(/\.png$/i, ''),
    name: basename(src).replace(/\.png$/i, ''),
    width: png.width,
    height: png.height,
    uploader: handle,
    uploadedAt: Date.now(),
    sizeBytes: buf.length,
    originalFileName: basename(src),
    tags: [],
  };
  await fs.writeFile(join(TEX_DIR(), `${id}.png`), buf);
  await fs.writeFile(join(TEX_DIR(), `${id}.meta.json`), JSON.stringify(meta, null, 2), 'utf8');
  return { meta };
}

export async function uploadUserPack(): Promise<{ cancelled?: boolean; meta?: UserPackMeta }> {
  const res = await dialog.showOpenDialog({
    title: 'Upload pack (ZIP)',
    properties: ['openFile'],
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });
  if (res.canceled || res.filePaths.length === 0) return { cancelled: true };
  const src = res.filePaths[0];
  const buf = await fs.readFile(src);
  if (buf.length > 50 * 1024 * 1024) throw new Error('Pack too large (max 50 MB)');
  // quick validate it is a zip with pack.mcmeta? not strict for Phase 1
  const handle = (await getMyHandle()) ?? 'anonymous';
  const id = randomUUID();
  await ensureDirs();
  await fs.writeFile(join(PACKS_DIR(), `${id}.zip`), buf);
  // try to extract texture count + description
  let description = '';
  let packFormat: number | undefined;
  let textureCount = 0;
  try {
    const yauzl = await import('yauzl');
    const entries: string[] = await new Promise((resolve, reject) => {
      const list: string[] = [];
      yauzl.open(src, { lazyEntries: true }, (err: Error | null, z: unknown) => {
        if (err || !z) return reject(err);
        const zip = z as { on(e: string, cb: (...a: unknown[]) => void): void; readEntry(): void; close(): void };
        zip.on('entry', (e: unknown) => { const en = e as { fileName: string }; list.push(en.fileName); (zip as unknown as { readEntry(): void }).readEntry(); });
        zip.on('end', () => resolve(list));
        zip.on('error', reject);
        zip.readEntry();
      });
    });
    textureCount = entries.filter((n) => n.toLowerCase().endsWith('.png')).length;
  } catch {}
  const meta: UserPackMeta = {
    id,
    fileName: `${id}.zip`,
    originalFileName: basename(src),
    description,
    packFormat,
    textureCount,
    sizeBytes: buf.length,
    uploader: handle,
    uploadedAt: Date.now(),
    tags: [],
  };
  await fs.writeFile(join(PACKS_DIR(), `${id}.json`), JSON.stringify(meta, null, 2), 'utf8');
  return { meta };
}

export async function deleteUserTexture(id: string, reason?: string): Promise<boolean> {
  let meta: UserTextureMeta | null = null;
  try { meta = JSON.parse(await fs.readFile(join(TEX_DIR(), `${id}.meta.json`), 'utf8')) as UserTextureMeta; } catch {}
  const { getVerifiedHandle } = await import('./auth');
  const deleter = await getVerifiedHandle();
  if (meta) {
    const isOwner = !!(deleter && meta.uploader.toLowerCase() === deleter.toLowerCase());
    const isCallerAdmin = deleter ? await isAdmin(deleter) : false;
    if (!isOwner && !isCallerAdmin) throw new Error('Only owner or admin can delete');
    try { await appendModeration({ id, type: 'texture', deletedAt: Date.now(), deletedBy: deleter, reason: reason ?? '', author: meta.uploader, originalName: meta.originalFileName }); } catch {}
  }
  await ensureDirs();
  try { await fs.unlink(join(TEX_DIR(), `${id}.png`)); } catch {}
  try { await fs.unlink(join(TEX_DIR(), `${id}.meta.json`)); } catch {}
  return true;
}
export async function deleteUserPack(id: string, reason?: string): Promise<boolean> {
  let meta: UserPackMeta | null = null;
  try { meta = JSON.parse(await fs.readFile(join(PACKS_DIR(), `${id}.json`), 'utf8')) as UserPackMeta; } catch {}
  const { getVerifiedHandle } = await import('./auth');
  const deleter = await getVerifiedHandle();
  if (meta) {
    const isOwner = !!(deleter && meta.uploader.toLowerCase() === deleter.toLowerCase());
    const isCallerAdmin = deleter ? await isAdmin(deleter) : false;
    if (!isOwner && !isCallerAdmin) throw new Error('Only owner or admin can delete');
    try { await appendModeration({ id, type: 'pack', deletedAt: Date.now(), deletedBy: deleter, reason: reason ?? '', author: meta.uploader, originalName: meta.originalFileName }); } catch {}
  }
  await ensureDirs();
  try { await fs.unlink(join(PACKS_DIR(), `${id}.zip`)); } catch {}
  try { await fs.unlink(join(PACKS_DIR(), `${id}.json`)); } catch {}
  return true;
}

export async function updateTextureTags(id: string, tags: string[]): Promise<UserTextureMeta | null> {
  const p = join(TEX_DIR(), `${id}.meta.json`);
  if (!existsSync(p)) return null;
  const raw = await fs.readFile(p, 'utf8');
  const meta = JSON.parse(raw) as UserTextureMeta;
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
  meta.tags = clean;
  await fs.writeFile(p, JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}
export async function updatePackTags(id: string, tags: string[]): Promise<UserPackMeta | null> {
  const p = join(PACKS_DIR(), `${id}.json`);
  if (!existsSync(p)) return null;
  const raw = await fs.readFile(p, 'utf8');
  const meta = JSON.parse(raw) as UserPackMeta;
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
  meta.tags = clean;
  await fs.writeFile(p, JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

// Migration: ensure existing metas have tags array
async function ensureTags(): Promise<void> {
  for (const m of await listUserTextures()) {
    if (!Array.isArray((m as unknown as { tags?: unknown }).tags)) {
      await updateTextureTags(m.id, []);
    }
  }
  for (const m of await listUserPacks()) {
    if (!Array.isArray((m as unknown as { tags?: unknown }).tags)) {
      await updatePackTags(m.id, []);
    }
  }
}
void ensureTags().catch(() => {});

export async function addUserTextureToProject(projectId: string, libraryId: string): Promise<{ ok: boolean; newId?: string }> {
  const { join } = await import('node:path');
  const { app: app2 } = await import('electron');
  const projectDir = (id: string) => join(app2.getPath('userData'), 'projects', id);
  // dynamic import to avoid circular
  const srcPng = join(TEX_DIR(), `${libraryId}.png`);
  const srcMeta = join(TEX_DIR(), `${libraryId}.meta.json`);
  if (!existsSync(srcPng)) return { ok: false };
  const buf = await fs.readFile(srcPng);
  let png: PNG;
  try { png = PNG.sync.read(buf); } catch { return { ok: false }; }
  let meta: UserTextureMeta | null = null;
  try { meta = JSON.parse(await fs.readFile(srcMeta, 'utf8')) as UserTextureMeta; } catch {}
  const { writeTextureBundle, idFromPath } = await import('./projectStore');
  const targetPath = meta?.path ?? libraryId;
  const nid = `${idFromPath(targetPath)}_${randomUUID().slice(0, 6)}`;
  await writeTextureBundle(projectId, nid, {
    width: png.width,
    height: png.height,
    frameCount: 1,
    pngBuffer: buf,
    source: 'user',
    path: targetPath,
    name: meta?.name ?? targetPath,
    animation: undefined,
  });
  // also need to ensure project exists - writeTextureBundle will create dir
  void projectId;
  return { ok: true, newId: nid };
}
