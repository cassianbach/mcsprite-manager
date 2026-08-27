// Hybrid Relay + Community Catalogue for MCsprite Manager (Fly.io)
// ws  : y-websocket collab (kept for backwards compat, can be scaled to 0 later)
// http: Community Catalogue REST (global, tag/search/verified-handle/admin)

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_ROOT = process.env.DATA_ROOT || (process.env.FLY_APP_NAME ? '/data' : './data-fly');
const COMMUNITY_ROOT = path.join(DATA_ROOT, 'community');
const TEX_DIR = path.join(COMMUNITY_ROOT, 'textures');
const PACKS_DIR = path.join(COMMUNITY_ROOT, 'packs');
const ADMIN_PATH = path.join(COMMUNITY_ROOT, 'admins.json');
const MODERATION_PATH = path.join(COMMUNITY_ROOT, 'moderation.json');

// --- Ensure dirs + seed admin ---
async function ensureCommunityDirs() {
  await fs.promises.mkdir(TEX_DIR, { recursive: true });
  await fs.promises.mkdir(PACKS_DIR, { recursive: true });
  try {
    await fs.promises.access(ADMIN_PATH);
  } catch {
    await fs.promises.writeFile(ADMIN_PATH, JSON.stringify({ admins: ['cassianbach'] }, null, 2));
  }
}
await ensureCommunityDirs().catch(() => {});

async function readAdmins() {
  try {
    const raw = await fs.promises.readFile(ADMIN_PATH, 'utf8');
    const j = JSON.parse(raw);
    if (Array.isArray(j.admins)) return j.admins.map((s) => String(s).toLowerCase());
  } catch {}
  return ['cassianbach'];
}
async function verifyHandleFromAuth(req) {
  const auth = req.headers['authorization'];
  if (!auth || !String(auth).startsWith('Bearer ')) return null;
  const token = String(auth).slice(7).trim();
  if (!token) return null;
  try {
    const r = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
    if (!r.ok) return null;
    const j = await r.json();
    return j.login ? String(j.login) : null;
  } catch { return null; }
}
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// Simple multipart parser (single file + fields) — avoids extra deps for Fly image
async function parseMultipart(req) {
  const ctype = req.headers['content-type'] || '';
  const m = /boundary=(.+)/.exec(ctype);
  if (!m) throw new Error('Missing boundary');
  const boundary = '--' + m[1];
  const buf = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
  const parts = buf.toString('binary').split(boundary);
  const fields = {};
  let file = null;
  for (const part of parts) {
    if (!part || part === '--\r\n' || part === '--') continue;
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = part.slice(0, headerEnd);
    let body = part.slice(headerEnd + 4);
    if (body.endsWith('\r\n')) body = body.slice(0, -2);
    const disp = /Content-Disposition:[^\r\n]*name="([^"]+)"/.exec(headers);
    const fname = /filename="([^"]+)"/.exec(headers);
    const name = disp ? disp[1] : '';
    if (fname) {
      file = { fieldName: name, originalName: fname[1], buffer: Buffer.from(body, 'binary') };
    } else {
      fields[name] = body;
    }
  }
  return { fields, file };
}

// --- y-websocket collab (unchanged) ---
const messageSync = 0;
const messageAwareness = 1;
const docs = new Map();
function toUint8Array(m) {
  if (Array.isArray(m)) {
    const total = m.reduce((n, part) => n + part.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const part of m) { out.set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength), off); off += part.length; }
    return out;
  }
  if (m instanceof ArrayBuffer) return new Uint8Array(m);
  if (typeof m === 'string') return new TextEncoder().encode(m);
  return new Uint8Array(m.buffer, m.byteOffset, m.byteLength);
}
class WSSharedDoc extends Y.Doc {
  constructor(name) {
    super({ gc: true });
    this.name = name; this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);
    this.awareness.on('update', (changes, origin) => {
      const changedClients = changes.added.concat(changes.updated, changes.removed);
      if (origin != null) {
        const controlled = this.conns.get(origin);
        if (controlled !== undefined) { changes.added.forEach((id) => controlled.add(id)); changes.removed.forEach((id) => controlled.delete(id)); }
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients));
      const buff = encoding.toUint8Array(encoder);
      this.conns.forEach((_c, conn) => send(this, conn, buff));
    });
    this.on('update', (update, _origin, doc) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      const buff = encoding.toUint8Array(encoder);
      doc.conns.forEach((_c, conn) => send(doc, conn, buff));
    });
  }
}
function getYDoc(docName) {
  let doc = docs.get(docName);
  if (!doc) { doc = new WSSharedDoc(docName); docs.set(docName, doc); }
  return doc;
}
function send(doc, conn, m) {
  if (conn.readyState !== WebSocket.CONNECTING && conn.readyState !== WebSocket.OPEN) { closeConn(doc, conn); return; }
  try { conn.send(m, (err) => { if (err != null) closeConn(doc, conn); }); } catch { closeConn(doc, conn); }
}
function closeConn(doc, conn) {
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn);
    if (controlledIds) awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
    doc.conns.delete(conn);
    if (doc.conns.size === 0) { doc.destroy(); docs.delete(doc.name); }
  }
  try { conn.close(); } catch {}
}
function messageListener(conn, doc, message) {
  const encoder = encoding.createEncoder();
  const decoder = decoding.createDecoder(message);
  const messageType = decoding.readVarUint(decoder);
  switch (messageType) {
    case messageSync:
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
      if (encoding.length(encoder) > 1) send(doc, conn, encoding.toUint8Array(encoder));
      break;
    case messageAwareness:
      awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn);
      break;
  }
}
function setupWSConnection(conn) {
  conn.binaryType = 'arraybuffer';
  const docName = (conn.url || '/').slice(1).split('?')[0] || 'default';
  const doc = getYDoc(docName);
  doc.conns.set(conn, new Set());
  conn.on('message', (message) => { try { messageListener(conn, doc, toUint8Array(message)); } catch (e) { console.error('collab message error', e); } });
  conn.on('close', () => closeConn(doc, conn));
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, doc);
  send(doc, conn, encoding.toUint8Array(encoder));
  const states = doc.awareness.getStates();
  if (states.size > 0) {
    const aEncoder = encoding.createEncoder();
    encoding.writeVarUint(aEncoder, messageAwareness);
    encoding.writeVarUint8Array(aEncoder, awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(states.keys())));
    send(doc, conn, encoding.toUint8Array(aEncoder));
  }
}

// --- HTTP ---
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Health
  if (url.pathname === '/' || url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('MCsprite Manager relay + community catalogue is running.\n');
    return;
  }

  // GET /api/catalog[?q=&tag=&type=textures|packs&limit=]
  if (req.method === 'GET' && url.pathname === '/api/catalog') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const tag = url.searchParams.get('tag');
    const type = url.searchParams.get('type');
    const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '100', 10) || 100);
    const textures = [];
    const packs = [];
    try {
      const tFiles = await fs.promises.readdir(TEX_DIR).catch(() => []);
      for (const f of tFiles) if (f.endsWith('.meta.json')) {
        try {
          const m = JSON.parse(await fs.promises.readFile(path.join(TEX_DIR, f), 'utf8'));
          if (tag && !(m.tags || []).map((t) => String(t).toLowerCase()).includes(tag.toLowerCase())) continue;
          if (q && ![m.name, m.path, m.uploader, ...(m.tags || [])].join(' ').toLowerCase().includes(q)) continue;
          if (!type || type === 'textures') textures.push(m);
        } catch {}
      }
      const pFiles = await fs.promises.readdir(PACKS_DIR).catch(() => []);
      for (const f of pFiles) if (f.endsWith('.json')) {
        try {
          const m = JSON.parse(await fs.promises.readFile(path.join(PACKS_DIR, f), 'utf8'));
          if (!m.id) continue;
          if (tag && !(m.tags || []).map((t) => String(t).toLowerCase()).includes(tag.toLowerCase())) continue;
          if (q && ![m.originalFileName, m.uploader, ...(m.tags || [])].join(' ').toLowerCase().includes(q)) continue;
          if (!type || type === 'packs') packs.push(m);
        } catch {}
      }
    } catch {}
    textures.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
    packs.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
    json(res, 200, { textures: textures.slice(0, limit), packs: packs.slice(0, limit), total: { textures: textures.length, packs: packs.length } });
    return;
  }

  // GET /api/catalog/texture/:id.png  and  /pack/:id.zip
  if (req.method === 'GET' && url.pathname.startsWith('/api/catalog/texture/')) {
    const id = decodeURIComponent(url.pathname.replace('/api/catalog/texture/', '').replace(/\.png$/, ''));
    const p = path.join(TEX_DIR, `${id}.png`);
    try { const buf = await fs.promises.readFile(p); cors(res); res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(buf); return; } catch { json(res, 404, { error: 'not found' }); return; }
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/catalog/pack/')) {
    const id = decodeURIComponent(url.pathname.replace('/api/catalog/pack/', '').replace(/\.zip$/, ''));
    const p = path.join(PACKS_DIR, `${id}.zip`);
    try { await fs.promises.access(p); cors(res); res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${id}.zip"` }); require('fs').createReadStream(p).pipe(res); return; } catch { json(res, 404, { error: 'not found' }); return; }
  }

  // GET /api/admin/moderation
  if (req.method === 'GET' && url.pathname === '/api/admin/moderation') {
    const handle = await verifyHandleFromAuth(req);
    if (!handle || !(await isAdminHandle(handle))) { json(res, 403, { error: 'admin only' }); return; }
    try {
      const raw = await fs.promises.readFile(path.join(COMMUNITY_ROOT, 'moderation.json'), 'utf8').catch(() => '[]');
      json(res, 200, JSON.parse(raw));
    } catch { json(res, 200, []); }
    return;
  }

  // POST upload texture/pack
  if (req.method === 'POST' && (url.pathname === '/api/catalog/textures' || url.pathname === '/api/catalog/packs')) {
    const isTexture = url.pathname.endsWith('/textures');
    const handle = await verifyHandleFromAuth(req);
    if (!handle) { json(res, 401, { error: 'GitHub login required' }); return; }
    try {
      const { file } = await parseMultipart(req);
      if (!file) { json(res, 400, { error: 'missing file' }); return; }
      const extOk = isTexture ? file.originalName.toLowerCase().endsWith('.png') : file.originalName.toLowerCase().endsWith('.zip');
      if (!extOk) { json(res, 400, { error: 'wrong file type' }); return; }
      if (file.buffer.length > (isTexture ? 5 : 50) * 1024 * 1024) { json(res, 413, { error: 'too large' }); return; }
      const id = randomUUID();
      if (isTexture) {
        const meta = { id, path: file.originalName.replace(/\.png$/i, ''), name: file.originalName.replace(/\.png$/i, ''), width: 16, height: 16, uploader: handle, uploadedAt: Date.now(), sizeBytes: file.buffer.length, originalFileName: file.originalName, tags: [] };
        await fs.promises.writeFile(path.join(TEX_DIR, `${id}.png`), file.buffer);
        await fs.promises.writeFile(path.join(TEX_DIR, `${id}.meta.json`), JSON.stringify(meta, null, 2));
        json(res, 201, meta);
      } else {
        await fs.promises.writeFile(path.join(PACKS_DIR, `${id}.zip`), file.buffer);
        const meta = { id, fileName: `${id}.zip`, originalFileName: file.originalName, description: '', textureCount: 0, sizeBytes: file.buffer.length, uploader: handle, uploadedAt: Date.now(), tags: [] };
        await fs.promises.writeFile(path.join(PACKS_DIR, `${id}.json`), JSON.stringify(meta, null, 2));
        json(res, 201, meta);
      }
    } catch (e) { json(res, 500, { error: String(e) }); }
    return;
  }

  // DELETE with reason
  if (req.method === 'DELETE' && (url.pathname.startsWith('/api/catalog/texture/') || url.pathname.startsWith('/api/catalog/pack/'))) {
    const isTex = url.pathname.includes('/texture/');
    const id = decodeURIComponent(url.pathname.split('/').pop() || '');
    const handle = await verifyHandleFromAuth(req);
    if (!handle) { json(res, 401, { error: 'login required' }); return; }
    // only owner or admin
    let meta = null;
    try {
      const p = isTex ? path.join(TEX_DIR, `${id}.meta.json`) : path.join(PACKS_DIR, `${id}.json`);
      meta = JSON.parse(await fs.promises.readFile(p, 'utf8'));
    } catch {}
    const admins = await readAdminsFile();
    const isOwner = meta && String(meta.uploader).toLowerCase() === handle.toLowerCase();
    const isAdmin = admins.includes(handle.toLowerCase());
    if (!isOwner && !isAdmin) { json(res, 403, { error: 'only owner or admin' }); return; }
    let reason = '';
    try { const body = await new Promise((resolve) => { let d=''; req.on('data', c=>d+=c); req.on('end',()=>resolve(d)); }); const j = JSON.parse(body || '{}'); reason = j.reason || ''; } catch {}
    try {
      if (isTex) { await fs.promises.unlink(path.join(TEX_DIR, `${id}.png`)).catch(()=>{}); await fs.promises.unlink(path.join(TEX_DIR, `${id}.meta.json`)).catch(()=>{}); }
      else { await fs.promises.unlink(path.join(PACKS_DIR, `${id}.zip`)).catch(()=>{}); await fs.promises.unlink(path.join(PACKS_DIR, `${id}.json`)).catch(()=>{}); }
      const logPath = path.join(COMMUNITY_ROOT, 'moderation.json');
      const cur = await fs.promises.readFile(logPath, 'utf8').then(r=>JSON.parse(r)).catch(()=>[]);
      cur.unshift({ id, type: isTex?'texture':'pack', deletedAt: Date.now(), deletedBy: handle, reason, author: meta?.uploader || 'unknown', originalName: meta?.originalFileName || id });
      await fs.promises.writeFile(logPath, JSON.stringify(cur.slice(0,200), null, 2));
      json(res, 200, { ok: true });
    } catch (e) { json(res, 500, { error: String(e) }); }
    return;
  }

  json(res, 404, { error: 'not found' });
});

async function readAdminsFile() {
  try {
    const raw = await fs.promises.readFile(ADMIN_PATH, 'utf8');
    const j = JSON.parse(raw);
    if (j.encrypted) {
      // Fly has no safeStorage; fall back to plain read
      return (j.admins || ['cassianbach']).map((s)=>String(s).toLowerCase());
    }
    return (j.admins || ['cassianbach']).map((s)=>String(s).toLowerCase());
  } catch { return ['cassianbach']; }
}
async function isAdminHandle(h) {
  const a = await readAdminsFile();
  return a.includes(String(h).toLowerCase());
}

const wss = new WebSocketServer({ server });
wss.on('connection', setupWSConnection);

server.listen(PORT, HOST, () => {
  const lan = (() => {
    try {
      for (const name of Object.keys(os.networkInterfaces())) {
        for (const net of os.networkInterfaces()[name] ?? []) {
          if (net.family === 'IPv4' && !net.internal) return net.address;
        }
      }
    } catch {}
    return '127.0.0.1';
  })();
  console.log(`MCsprite Manager relay + community listening on port ${PORT}`);
  console.log(`  Local:    ws://127.0.0.1:${PORT}`);
  console.log(`  Network: ws://${lan}:${PORT}`);
  console.log(`  Community: http://${lan}:${PORT}/api/catalog`);
});
