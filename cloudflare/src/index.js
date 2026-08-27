// MCsprite Manager Community Catalogue — Cloudflare Worker + Workers KV
// HTTP-only (no collab). Global community: upload/list/search/tag/delete.
// KV stores strings (25MB max value) — binary files are base64-encoded.

const ADMIN_SEED = ['cassianbach'];
const MAX_TEXTURE = 5 * 1024 * 1024;   // 5 MB
const MAX_PACK = 20 * 1024 * 1024;     // 20 MB (KV 25MB limit minus base64 overhead)

function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return res;
}
function json(data, status = 200) {
  return cors(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }));
}

async function readJson(env, key, fallback) {
  try {
    const s = await env.COMMUNITY.get(key);
    if (!s) return fallback;
    return JSON.parse(s);
  } catch { return fallback; }
}
async function writeJson(env, key, data) {
  await env.COMMUNITY.put(key, JSON.stringify(data));
}

async function getAdmins(env) {
  const j = await readJson(env, 'admins.json', { admins: ADMIN_SEED });
  const list = Array.isArray(j.admins) ? j.admins : ADMIN_SEED;
  return list.map((s) => String(s).toLowerCase());
}
async function isAdmin(env, handle) {
  const a = await getAdmins(env);
  return a.includes(String(handle).toLowerCase());
}

async function verifyHandle(req) {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'mcsprite-manager' },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.login ? String(j.login) : null;
  } catch { return null; }
}

async function listTextures(env) {
  const j = await readJson(env, 'index.json', { textures: [], packs: [] });
  return Array.isArray(j.textures) ? j.textures : [];
}
async function listPacks(env) {
  const j = await readJson(env, 'index.json', { textures: [], packs: [] });
  return Array.isArray(j.packs) ? j.packs : [];
}
async function saveIndex(env, textures, packs) {
  await writeJson(env, 'index.json', { textures, packs });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    if (url.pathname === '/health' || url.pathname === '/') {
      return cors(new Response('MCsprite Manager community is running.\n', { status: 200, headers: { 'Content-Type': 'text/plain' } }));
    }

    // GET /api/catalog?q=&tag=&type=textures|packs
    if (method === 'GET' && url.pathname === '/api/catalog') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const tag = (url.searchParams.get('tag') || '').toLowerCase();
      const type = url.searchParams.get('type');
      const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '100', 10) || 100);
      let textures = await listTextures(env);
      let packs = await listPacks(env);
      const match = (m) => {
        const tags = (m.tags || []).map((t) => String(t).toLowerCase());
        if (tag && !tags.includes(tag)) return false;
        if (q) {
          const hay = [m.name, m.path, m.uploader, m.originalFileName, ...tags].join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      };
      textures = textures.filter(match).sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
      packs = packs.filter(match).sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
      return json({ textures: textures.slice(0, limit), packs: packs.slice(0, limit), total: { textures: textures.length, packs: packs.length } });
    }

    // GET file (base64 stored in KV)
    if (method === 'GET' && url.pathname.startsWith('/api/catalog/texture/')) {
      const id = decodeURIComponent(url.pathname.replace('/api/catalog/texture/', '').replace(/\.png$/, ''));
      const b64 = await env.COMMUNITY.get(`textures/${id}.png`);
      if (!b64) return json({ error: 'not found' }, 404);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return cors(new Response(bytes, { headers: { 'Content-Type': 'image/png' } }));
    }
    if (method === 'GET' && url.pathname.startsWith('/api/catalog/pack/')) {
      const id = decodeURIComponent(url.pathname.replace('/api/catalog/pack/', '').replace(/\.zip$/, ''));
      const b64 = await env.COMMUNITY.get(`packs/${id}.zip`);
      if (!b64) return json({ error: 'not found' }, 404);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return cors(new Response(bytes, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${id}.zip"` } }));
    }

    // GET /api/admin/moderation
    if (method === 'GET' && url.pathname === '/api/admin/moderation') {
      const handle = await verifyHandle(request);
      if (!handle || !(await isAdmin(env, handle))) return json({ error: 'admin only' }, 403);
      const log = await readJson(env, 'moderation.json', []);
      return json(log);
    }

    // GET /api/admin/admins — list admins (admin only)
    if (method === 'GET' && url.pathname === '/api/admin/admins') {
      const handle = await verifyHandle(request);
      if (!handle || !(await isAdmin(env, handle))) return json({ error: 'admin only' }, 403);
      return json({ admins: await getAdmins(env) });
    }

    // POST /api/admin/admins — add admin (admin only)
    if (method === 'POST' && url.pathname === '/api/admin/admins') {
      const handle = await verifyHandle(request);
      if (!handle || !(await isAdmin(env, handle))) return json({ error: 'admin only' }, 403);
      let target = '';
      try { const body = await request.json(); target = String(body.handle || '').trim().toLowerCase(); } catch {}
      if (!target) return json({ error: 'missing handle' }, 400);
      const admins = await getAdmins(env);
      if (!admins.includes(target)) admins.push(target);
      await writeJson(env, 'admins.json', { admins });
      return json({ admins });
    }

    // DELETE /api/admin/admins/:handle — remove admin (admin only, cannot remove cassianbach)
    if (method === 'DELETE' && url.pathname.startsWith('/api/admin/admins/')) {
      const handle = await verifyHandle(request);
      if (!handle || !(await isAdmin(env, handle))) return json({ error: 'admin only' }, 403);
      const target = decodeURIComponent(url.pathname.split('/').pop() || '').toLowerCase();
      if (target === 'cassianbach') return json({ error: 'cannot remove cassianbach' }, 400);
      const admins = (await getAdmins(env)).filter((a) => a !== target);
      await writeJson(env, 'admins.json', { admins });
      return json({ admins });
    }

    // POST upload
    if (method === 'POST' && (url.pathname === '/api/catalog/textures' || url.pathname === '/api/catalog/packs')) {
      const isTexture = url.pathname.endsWith('/textures');
      const handle = await verifyHandle(request);
      if (!handle) return json({ error: 'GitHub login required' }, 401);
      let form;
      try { form = await request.formData(); } catch { return json({ error: 'invalid form' }, 400); }
      const file = form.get('file');
      if (!file || typeof file === 'string') return json({ error: 'missing file' }, 400);
      const buf = new Uint8Array(await file.arrayBuffer());
      const originalName = file.name || 'upload';
      const extOk = isTexture ? originalName.toLowerCase().endsWith('.png') : originalName.toLowerCase().endsWith('.zip');
      if (!extOk) return json({ error: 'wrong file type' }, 400);
      const maxBytes = isTexture ? MAX_TEXTURE : MAX_PACK;
      if (buf.length > maxBytes) return json({ error: isTexture ? 'texture too large (max 5 MB)' : 'pack too large (max 20 MB)' }, 413);
      const id = crypto.randomUUID();
      const b64 = btoa(String.fromCharCode(...buf));
      if (isTexture) {
        const meta = { id, path: originalName.replace(/\.png$/i, ''), name: originalName.replace(/\.png$/i, ''), width: 16, height: 16, uploader: handle, uploadedAt: Date.now(), sizeBytes: buf.length, originalFileName: originalName, tags: [] };
        await env.COMMUNITY.put(`textures/${id}.png`, b64);
        await env.COMMUNITY.put(`textures/${id}.meta.json`, JSON.stringify(meta));
        const textures = await listTextures(env);
        textures.unshift(meta);
        await saveIndex(env, textures, await listPacks(env));
        return json(meta, 201);
      } else {
        await env.COMMUNITY.put(`packs/${id}.zip`, b64);
        const meta = { id, fileName: `${id}.zip`, originalFileName: originalName, description: '', textureCount: 0, sizeBytes: buf.length, uploader: handle, uploadedAt: Date.now(), tags: [] };
        await env.COMMUNITY.put(`packs/${id}.json`, JSON.stringify(meta));
        const packs = await listPacks(env);
        packs.unshift(meta);
        await saveIndex(env, await listTextures(env), packs);
        return json(meta, 201);
      }
    }

    // PATCH tags (owner or admin)
    if (method === 'PATCH' && (url.pathname.startsWith('/api/catalog/texture/') || url.pathname.startsWith('/api/catalog/pack/'))) {
      const isTex = url.pathname.includes('/texture/');
      const id = decodeURIComponent(url.pathname.split('/').pop() || '');
      const handle = await verifyHandle(request);
      if (!handle) return json({ error: 'login required' }, 401);
      let meta = null;
      try {
        const key = isTex ? `textures/${id}.meta.json` : `packs/${id}.json`;
        const s = await env.COMMUNITY.get(key);
        if (s) meta = JSON.parse(s);
      } catch {}
      if (!meta) return json({ error: 'not found' }, 404);
      const isOwner = String(meta.uploader).toLowerCase() === handle.toLowerCase();
      const admin = await isAdmin(env, handle);
      if (!isOwner && !admin) return json({ error: 'only owner or admin' }, 403);
      let tags = [];
      try { const body = await request.json(); tags = Array.isArray(body.tags) ? body.tags : []; } catch {}
      const clean = [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 12);
      meta.tags = clean;
      const key = isTex ? `textures/${id}.meta.json` : `packs/${id}.json`;
      await env.COMMUNITY.put(key, JSON.stringify(meta));
      // update index
      if (isTex) {
        const textures = (await listTextures(env)).map((m) => (m.id === id ? meta : m));
        await saveIndex(env, textures, await listPacks(env));
      } else {
        const packs = (await listPacks(env)).map((m) => (m.id === id ? meta : m));
        await saveIndex(env, await listTextures(env), packs);
      }
      return json(meta);
    }

    // DELETE with reason
    if (method === 'DELETE' && (url.pathname.startsWith('/api/catalog/texture/') || url.pathname.startsWith('/api/catalog/pack/'))) {
      const isTex = url.pathname.includes('/texture/');
      const id = decodeURIComponent(url.pathname.split('/').pop() || '');
      const handle = await verifyHandle(request);
      if (!handle) return json({ error: 'login required' }, 401);
      let meta = null;
      try {
        const key = isTex ? `textures/${id}.meta.json` : `packs/${id}.json`;
        const s = await env.COMMUNITY.get(key);
        if (s) meta = JSON.parse(s);
      } catch {}
      const isOwner = meta && String(meta.uploader).toLowerCase() === handle.toLowerCase();
      const admin = await isAdmin(env, handle);
      if (!isOwner && !admin) return json({ error: 'only owner or admin' }, 403);
      let reason = '';
      try { const body = await request.json(); reason = body.reason || ''; } catch {}
      if (isTex) {
        await env.COMMUNITY.delete(`textures/${id}.png`);
        await env.COMMUNITY.delete(`textures/${id}.meta.json`);
        const textures = (await listTextures(env)).filter((m) => m.id !== id);
        await saveIndex(env, textures, await listPacks(env));
      } else {
        await env.COMMUNITY.delete(`packs/${id}.zip`);
        await env.COMMUNITY.delete(`packs/${id}.json`);
        const packs = (await listPacks(env)).filter((m) => m.id !== id);
        await saveIndex(env, await listTextures(env), packs);
      }
      const log = await readJson(env, 'moderation.json', []);
      log.unshift({ id, type: isTex ? 'texture' : 'pack', deletedAt: Date.now(), deletedBy: handle, reason, author: meta?.uploader || 'unknown', originalName: meta?.originalFileName || id });
      await writeJson(env, 'moderation.json', log.slice(0, 200));
      return json({ ok: true });
    }

    return json({ error: 'not found' }, 404);
  },
};
