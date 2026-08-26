import { promises as fs, existsSync, readdirSync, statSync, createWriteStream, readFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { PNG } from 'pngjs';
import archiver from 'archiver';
import yauzl from 'yauzl';
import type {
  Project,
  ProjectListEntry,
  TextureMetaInfo,
  McAnimationMeta,
  AnimationStrip,
  TextureDetailed,
  ImportTexturePreview,
  ImportSelection,
  ImportResult,
  ExportResult,
  AddTextureResult,
} from '../shared/types';
import { packFormatForVersion } from '../shared/types';

const PROJECTS_ROOT = (): string => join(app.getPath('userData'), 'projects');

function projectDir(id: string): string {
  return join(PROJECTS_ROOT(), id);
}

export async function listProjects(): Promise<ProjectListEntry[]> {
  const root = PROJECTS_ROOT();
  await fs.mkdir(root, { recursive: true });
  const entries = await fs.readdir(root, { withFileTypes: true });
  const out: ProjectListEntry[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = join(root, ent.name);
    const metaPath = join(dir, 'project.json');
    if (!existsSync(metaPath)) continue;
    try {
      const raw = await fs.readFile(metaPath, 'utf8');
      const meta = JSON.parse(raw) as Project;
      const textures = await listProjectTextures(meta.id);
      let modifiedCount = 0;
      try {
        const texDirs = await fs.readdir(join(dir, 'textures'));
        for (const f of texDirs) {
          if (f.endsWith('.meta.json')) modifiedCount++;
        }
      } catch {
        modifiedCount = 0;
      }
      out.push({
        id: meta.id,
        name: meta.name,
        kind: meta.kind,
        mcVersion: meta.mcVersion,
        textureCount: textures.length,
        modifiedCount,
        updatedAt: meta.updatedAt,
      });
    } catch {
      // skip corrupt project
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createProject(partial: Partial<Project>): Promise<Project> {
  const now = Date.now();
  const project: Project = {
    id: cryptoRandomId(),
    name: partial.name?.trim() || 'Untitled Project',
    description: partial.description ?? '',
    kind: partial.kind ?? 'mc',
    mcVersion: partial.mcVersion,
    packFormat: partial.packFormat,
    dir: '',
    createdAt: now,
    updatedAt: now,
  };
  const dir = projectDir(project.id);
  project.dir = dir;
  await fs.mkdir(join(dir, 'textures'), { recursive: true });
  await fs.writeFile(join(dir, 'project.json'), JSON.stringify(project, null, 2), 'utf8');
  return project;
}

export async function deleteProject(id: string): Promise<boolean> {
  const dir = projectDir(id);
  if (!existsSync(dir)) return false;
  await fs.rm(dir, { recursive: true, force: true });
  return true;
}

export async function renameProject(id: string, name: string): Promise<boolean> {
  const dir = projectDir(id);
  const metaPath = join(dir, 'project.json');
  if (!existsSync(metaPath)) return false;
  const raw = await fs.readFile(metaPath, 'utf8');
  const meta = JSON.parse(raw) as Project;
  meta.name = name.trim() || meta.name;
  meta.updatedAt = Date.now();
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  return true;
}

export async function setProjectVersion(id: string, mcVersion: string): Promise<boolean> {
  const dir = projectDir(id);
  const metaPath = join(dir, 'project.json');
  if (!existsSync(metaPath)) return false;
  const raw = await fs.readFile(metaPath, 'utf8');
  const meta = JSON.parse(raw) as Project;
  meta.mcVersion = mcVersion;
  meta.packFormat = packFormatForVersion(mcVersion);
  meta.updatedAt = Date.now();
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  return true;
}

export async function listProjectTextures(projectId: string): Promise<string[]> {
  const dir = join(projectDir(projectId), 'textures');
  if (!existsSync(dir)) return [];
  const files = await fs.readdir(dir);
  return files
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.replace(/\.png$/, ''));
}

interface LoadedTexture {
  textureId: string;
  width: number;
  height: number;
  pixels: Uint8ClampedArray; // RGBA (frame 0)
  base: Uint8ClampedArray;
  modified: boolean;
  source: 'vanilla' | 'user' | 'imported';
  path: string;
  name: string;
  frameCount: number;
  frameHeight: number;
  animation?: AnimationStrip;
}

export async function loadProjectTexture(
  projectId: string,
  textureId: string,
): Promise<LoadedTexture> {
  const dir = join(projectDir(projectId), 'textures');
  const pngPath = join(dir, `${textureId}.png`);
  const metaPath = join(dir, `${textureId}.meta.json`);

  if (!existsSync(pngPath)) {
    throw new Error(`Texture not found: ${textureId}`);
  }

  const png = PNG.sync.read(await fs.readFile(pngPath));

  let meta: TextureMetaInfo | null = null;
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    } catch {
      meta = null;
    }
  }

  const width = png.width;
  // Derive frame dimensions from the actual PNG (robust to stale metadata written
  // by older imports). Prefer the explicit mcmeta `height` hint for non-square
  // frames, then the persisted `frameHeight`, otherwise assume square frames
  // (frameHeight == width). A non-square static texture (e.g. 341x800) must keep
  // its real height, not be squished into `width`-tall frames.
  const hintFH =
    meta?.animation && typeof meta.animation.frameHeight === 'number' && meta.animation.frameHeight > 0
      ? meta.animation.frameHeight
      : meta && typeof meta.frameHeight === 'number' && meta.frameHeight > 0
        ? meta.frameHeight
        : undefined;
  const frameHeight = hintFH ?? Math.max(1, width);
  const frameCount = Math.max(1, Math.round(png.height / frameHeight));
  const height = frameHeight;

  const frames = stripToFrames(png, frameHeight, frameCount);
  const pixels = new Uint8ClampedArray(frames[0] ?? new Uint8ClampedArray(width * height * 4));
  const base = new Uint8ClampedArray(pixels);

  let animation: AnimationStrip | undefined;
  if (meta?.animation && frameCount > 1) {
    const ft = meta.animation.frameTime ?? [];
    animation = {
      interpolate: meta.animation.interpolate,
      defaultFrameTicks: meta.animation.defaultFrameTicks,
      frames: frames.map((px, i) => ({
        pixels: px,
        tickDuration: ft[i] ?? meta!.animation!.defaultFrameTicks,
      })),
      ...(meta.animation.frameList ? { frameList: meta.animation.frameList } : {}),
      ...(typeof meta.animation.frameWidth === 'number' && meta.animation.frameWidth > 0
        ? { frameWidth: meta.animation.frameWidth }
        : {}),
      ...(typeof meta.animation.frameHeight === 'number' && meta.animation.frameHeight > 0
        ? { frameHeight: meta.animation.frameHeight }
        : {}),
    };
  }

  const path = meta?.path ?? textureId;
  const name = meta?.name ?? basename(textureId);
  const source = meta?.source ?? 'user';

  return {
    textureId,
    width,
    height,
    pixels: new Uint8ClampedArray(pixels),
    base,
    modified: !!meta,
    source,
    path,
    name,
    frameCount,
    frameHeight,
    animation,
  };
}

export async function saveProjectTexture(
  projectId: string,
  textureId: string,
  pngBytes: Buffer,
): Promise<{ ok: true }> {
  const dir = join(projectDir(projectId), 'textures');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, `${textureId}.png`), pngBytes);
  return { ok: true };
}

export async function deleteProjectTexture(
  projectId: string,
  textureId: string,
): Promise<{ ok: true }> {
  const dir = join(projectDir(projectId), 'textures');
  const pngPath = join(dir, `${textureId}.png`);
  const metaPath = join(dir, `${textureId}.meta.json`);
  if (existsSync(pngPath)) await fs.unlink(pngPath);
  if (existsSync(metaPath)) await fs.unlink(metaPath);
  return { ok: true };
}

export async function saveProjectTexturePixels(
  projectId: string,
  textureId: string,
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray,
): Promise<{ ok: true }> {
  const png = new PNG({ width, height, colorType: 6 });
  for (let i = 0; i < rgba.length; i++) png.data[i] = rgba[i];
  const bytes = PNG.sync.write(png);
  return saveProjectTexture(projectId, textureId, Buffer.from(bytes));
}

function vanillaRoots(): string[] {
  const roots: string[] = [];
  // Packaged app: bundled under resources/vanilla.
  roots.push(join(process.resourcesPath, 'vanilla'));
  // Dev: sync:vanilla writes to <project>/resources/vanilla.
  try {
    roots.push(join(app.getAppPath(), 'resources', 'vanilla'));
  } catch {
    /* app.getAppPath may throw before ready */
  }
  return roots;
}

function resolveVanillaVersion(): { version: string; versionDir: string } | null {
  for (const candidate of vanillaRoots()) {
    if (!existsSync(candidate)) continue;
    const versions = readdirSync(candidate).filter((v) => statSync(join(candidate, v)).isDirectory());
    if (!versions.length) continue;
    const version = versions.sort().pop()!;
    const versionDir = join(candidate, version, 'assets', 'minecraft');
    if (!existsSync(versionDir)) continue;
    return { version, versionDir };
  }
  return null;
}

export async function readVanillaIndex(): Promise<
  { version: string; textures: { id: string; path: string; category: string }[] } | null
> {
  const r = resolveVanillaVersion();
  if (!r) return null;
  const { version, versionDir } = r;
  const textures = walkTextures(versionDir, versionDir);
  return { version, textures };
}

/** Raw PNG bytes for a vanilla texture (for thumbnails). Null if unavailable. */
export async function readVanillaPng(vanillaId: string): Promise<Uint8Array | null> {
  const r = resolveVanillaVersion();
  if (!r) return null;
  const pngPath = join(r.versionDir, 'textures', `${vanillaId}.png`);
  if (!existsSync(pngPath)) return null;
  return readFileSync(pngPath);
}

/** Copy a bundled vanilla texture into the project as a new texture (source: 'vanilla'). */
export async function addVanillaTexture(projectId: string, vanillaId: string): Promise<AddTextureResult> {
  const r = resolveVanillaVersion();
  if (!r) return { cancelled: false };
  const pngPath = join(r.versionDir, 'textures', `${vanillaId}.png`);
  if (!existsSync(pngPath)) return { cancelled: false };

  let png: PNG;
  try {
    png = PNG.sync.read(readFileSync(pngPath));
  } catch {
    return { cancelled: false };
  }
  const width = png.width;
  const height = png.height;

  const mcmetaPath = `${pngPath}.mcmeta`;
  let animBlock: { interpolate?: boolean; frametime?: number; frames?: unknown } | null = null;
  if (existsSync(mcmetaPath)) {
    try {
      const parsed = JSON.parse(readFileSync(mcmetaPath, 'utf8')) as {
        animation?: { interpolate?: boolean; frametime?: number; frames?: unknown };
      };
      animBlock = parsed.animation ?? null;
    } catch {
      animBlock = null;
    }
  }

  const parsed = parseAnimationMeta(animBlock, width, height);
  const frameCount = parsed.frameCount;
  const frameHeight = parsed.frameHeight;
  const animation: McAnimationMeta | undefined = parsed.animation;

  const frames = stripToFrames(png, frameHeight, frameCount);

  let id = idFromPath(vanillaId);
  const existing = await listProjectTextures(projectId);
  if (existing.includes(id)) {
    id = `${id}_${cryptoRandomId().slice(0, 6)}`;
  }
  const name = basename(vanillaId);
  await saveProjectTextureFull(projectId, id, {
    width,
    height: frameHeight,
    frameCount,
    frames,
    source: 'vanilla',
    path: vanillaId,
    name,
    animation,
  });
  return { id, name, path: vanillaId };
}

function walkTextures(root: string, dir: string): { id: string; path: string; category: string }[] {
  const out: { id: string; path: string; category: string }[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walkTextures(root, p));
    } else if (ent.name.endsWith('.png')) {
      const rel = p.slice(root.length + 1).replace(/\\/g, '/');
      const noExt = rel.replace(/\.png$/, '');
      // Store the path relative to assets/minecraft/textures/ (e.g. "item/diamond_pickaxe"),
      // matching imported textures and the exporter's prefix.
      const relToTextures = noExt.replace(/^textures\//, '');
      const category = relToTextures.split('/')[0] || 'misc';
      out.push({ id: relToTextures, path: relToTextures, category });
    }
  }
  return out;
}

function cryptoRandomId(): string {
  return randomUUID();
}

// ============================================================================
// Persistence helpers (strip PNG + meta.json)
// ============================================================================

/** Turn an MC-style path into a safe on-disk texture id. */
export function idFromPath(path: string): string {
  return path.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

/** Split a vertical animation-strip PNG into per-frame RGBA buffers. */
function stripToFrames(
  png: PNG,
  frameHeight: number,
  frameCount: number,
): Uint8ClampedArray[] {
  const { width, data } = png;
  const out: Uint8ClampedArray[] = [];
  for (let i = 0; i < frameCount; i++) {
    const fr = new Uint8ClampedArray(width * frameHeight * 4);
    const srcStart = i * frameHeight * width * 4;
    for (let r = 0; r < frameHeight; r++) {
      const sOff = srcStart + r * width * 4;
      const dOff = r * width * 4;
      fr.set(data.subarray(sOff, sOff + width * 4), dOff);
    }
    out.push(fr);
  }
  return out;
}

/** Compose a vertical animation-strip PNG from per-frame RGBA buffers. */
function buildStripPng(
  width: number,
  frameHeight: number,
  frameCount: number,
  frames: Array<Uint8Array | Uint8ClampedArray>,
): Buffer {
  const png = new PNG({ width, height: frameHeight * frameCount, colorType: 6 });
  for (let i = 0; i < frameCount; i++) {
    const f = frames[i];
    const dstStart = i * frameHeight * width * 4;
    for (let r = 0; r < frameHeight; r++) {
      const sOff = r * width * 4;
      const dOff = dstStart + r * width * 4;
      for (let c = 0; c < width * 4; c++) png.data[dOff + c] = f[sOff + c];
    }
  }
  return PNG.sync.write(png);
}

interface BundleInput {
  width: number;
  height: number; // single-frame height (frameHeight)
  frameCount: number;
  pngBuffer: Buffer; // raw strip PNG bytes (height = height * frameCount)
  source: 'vanilla' | 'user' | 'imported';
  path: string;
  name: string;
  animation?: McAnimationMeta;
}

export async function writeTextureBundle(
  projectId: string,
  textureId: string,
  bundle: BundleInput,
): Promise<{ ok: true }> {
  const dir = join(projectDir(projectId), 'textures');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, `${textureId}.png`), bundle.pngBuffer);
  const meta: TextureMetaInfo = {
    source: bundle.source,
    path: bundle.path,
    name: bundle.name,
    width: bundle.width,
    height: bundle.height,
    frameCount: bundle.frameCount,
    frameHeight: bundle.height,
    animation: bundle.animation,
  };
  await fs.writeFile(
    join(dir, `${textureId}.meta.json`),
    JSON.stringify(meta, null, 2),
    'utf8',
  );
  return { ok: true };
}

/** Persist a texture (possibly animated) from in-memory frame buffers. */
export async function saveProjectTextureFull(
  projectId: string,
  textureId: string,
  input: {
    width: number;
    height: number;
    frameCount: number;
    frames: Array<Uint8Array | Uint8ClampedArray>;
    source: 'vanilla' | 'user' | 'imported';
    path: string;
    name: string;
    animation?: McAnimationMeta;
  },
): Promise<{ ok: true }> {
  const strip = buildStripPng(input.width, input.height, input.frameCount, input.frames);
  return writeTextureBundle(projectId, textureId, {
    width: input.width,
    height: input.height,
    frameCount: input.frameCount,
    pngBuffer: strip,
    source: input.source,
    path: input.path,
    name: input.name,
    animation: input.animation,
  });
}

export async function listDetailed(projectId: string): Promise<TextureDetailed[]> {
  const ids = await listProjectTextures(projectId);
  const out: TextureDetailed[] = [];
  for (const id of ids) {
    const metaPath = join(projectDir(projectId), 'textures', `${id}.meta.json`);
    let meta: TextureMetaInfo | null = null;
    if (existsSync(metaPath)) {
      try {
        meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      } catch {
        meta = null;
      }
    }
    out.push({
      id,
      source: meta?.source ?? 'user',
      path: meta?.path ?? id,
      name: meta?.name ?? basename(id),
      width: meta?.width ?? 0,
      height: meta?.height ?? 0,
      frameCount: meta?.frameCount ?? 1,
      frameHeight: meta?.frameHeight ?? (meta?.height ?? 0),
      animation: meta?.animation,
    });
  }
  return out;
}

// ============================================================================
// Export (MC-ready .zip)
// ============================================================================

async function readProject(projectId: string): Promise<Project | null> {
  const p = join(projectDir(projectId), 'project.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

function makePackIcon(): Buffer {
  const S = 128;
  const png = new PNG({ width: S, height: S, colorType: 6 });
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      let r = 0x0b;
      let g = 0x0d;
      let b = 0x10;
      if (x >= 18 && x < S - 18 && y >= 18 && y < S - 18) {
        const t = (x + y) % 26;
        if (t < 13) {
          r = 0x6c;
          g = 0xf0;
          b = 0xd6;
        } else {
          r = 0x14;
          g = 0x2c;
          b = 0x29;
        }
      }
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function buildMcMcmeta(anim: McAnimationMeta): { animation: Record<string, unknown> } | null {
  if (anim.frameTime.length === 0) return null;
  const allEqual = anim.frameTime.every((t) => t === anim.frameTime[0]);
  const animation: Record<string, unknown> = { interpolate: anim.interpolate };

  // Preserve non-square frame dimensions so MC slices the strip correctly.
  if (typeof anim.frameWidth === 'number' && anim.frameWidth > 0) {
    animation.width = anim.frameWidth;
  }
  if (typeof anim.frameHeight === 'number' && anim.frameHeight > 0) {
    animation.height = anim.frameHeight;
  }

  if (anim.frameList && anim.frameList.length > 0) {
    // Reproduce the original display sequence. Each step's duration is the
    // duration of the (actual) frame it points at.
    const steps = anim.frameList.map((idx) => ({
      index: idx,
      time: anim.frameTime[idx] ?? anim.defaultFrameTicks,
    }));
    const stepTimesEqual = steps.every((s) => s.time === steps[0].time);
    if (stepTimesEqual) {
      animation.frames = anim.frameList;
      animation.frametime = steps[0].time;
    } else {
      animation.frames = steps.map((s) => ({ index: s.index, time: s.time }));
    }
  } else if (allEqual) {
    animation.frametime = anim.frameTime[0] ?? anim.defaultFrameTicks;
  } else {
    animation.frames = anim.frameTime.map((time, index) => ({ index, time }));
  }
  return { animation };
}

export async function exportZipTo(
  projectId: string,
  targetPath: string,
  opts?: { packFormat?: number; description?: string },
): Promise<ExportResult> {
  const project = await readProject(projectId);
  // Resolve the target pack format. Precedence: explicit option > the project's
  // MC version > a stored format (if not a stale pre-1.20.5 value) > latest.
  let packFormat = opts?.packFormat;
  if (!packFormat) {
    if (project?.mcVersion) packFormat = packFormatForVersion(project.mcVersion);
    else if (project?.packFormat && project.packFormat >= 32) packFormat = project.packFormat;
    else packFormat = packFormatForVersion();
  }
  const description =
    opts?.description ?? project?.description ?? project?.name ?? 'Resource Pack';

  const detailed = await listDetailed(projectId);
  // Level 0 = store-only (fastest). PNGs/JPGs are already compressed, so
  // re-compressing them at high levels is very slow and saves nothing.
  const archive = archiver('zip', { zlib: { level: 0 } });
  const output = createWriteStream(targetPath);
  let textureCount = 0;

  await new Promise<void>((resolve, reject) => {
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('close', resolve);
    archive.pipe(output);

    // Carry over every file from the original pack (models, lang, pack info,
    // untouched textures, etc.). Edited textures below take precedence.
    const passDir = join(projectDir(projectId), 'passthrough');
    const exportedTexturePaths = new Set<string>();
    for (const t of detailed) {
      const mcPath = t.path.replace(/^textures\//, '');
      exportedTexturePaths.add(`assets/minecraft/textures/${mcPath}.png`);
      exportedTexturePaths.add(`assets/minecraft/textures/${mcPath}.png.mcmeta`);
    }

    let packMcmetaWritten = false;
    let packPngWritten = false;
    if (existsSync(passDir)) {
      const walk = (dir: string, relBase: string): void => {
        for (const f of readdirSync(dir)) {
          const full = join(dir, f);
          const st = statSync(full);
          if (st.isDirectory()) {
            walk(full, relBase ? `${relBase}/${f}` : f);
            continue;
          }
          const relPath = relBase ? `${relBase}/${f}` : f;
          // Edited textures/mcmetas are re-exported below; skip to avoid dupes.
          if (exportedTexturePaths.has(relPath)) continue;
          if (relPath === 'pack.mcmeta') {
            try {
              const parsed = JSON.parse(readFileSync(full, 'utf8'));
              // Always stamp the correct pack format; a stale value (e.g. an
              // old format 34 pack loaded into 1.21.11) causes MC to run its
              // path "fixers" and break armor layers / drop netherite.
              parsed.pack = { ...(parsed.pack ?? {}), pack_format: packFormat };
              archive.append(JSON.stringify(parsed, null, 2), { name: 'pack.mcmeta' });
              packMcmetaWritten = true;
              continue;
            } catch {
              /* fall through to default below */
            }
          }
          if (relPath === 'pack.png') {
            archive.file(full, { name: 'pack.png' });
            packPngWritten = true;
            continue;
          }
          archive.file(full, { name: relPath });
        }
      };
      walk(passDir, '');
    }

    if (!packMcmetaWritten) {
      archive.append(
        JSON.stringify({ pack: { pack_format: packFormat, description } }, null, 2),
        { name: 'pack.mcmeta' },
      );
    }
    if (!packPngWritten) {
      archive.append(makePackIcon(), { name: 'pack.png' });
    }

    for (const t of detailed) {
      const pngPath = join(projectDir(projectId), 'textures', `${t.id}.png`);
      if (!existsSync(pngPath)) continue;
      // Path is stored relative to assets/minecraft/textures/ (e.g. "item/diamond_pickaxe").
      // Strip any stray leading "textures/" so we never double-prefix.
      const mcPath = t.path.replace(/^textures\//, '');
      const pngName = `${mcPath}.png`;

      // Derive the real frame count from the PNG itself (robust to stale metadata).
      let pngFrameCount = t.frameCount;
      try {
        const buf = readFileSync(pngPath);
        const png = PNG.sync.read(buf);
        const hintFH =
          t.animation && typeof t.animation.frameHeight === 'number' && t.animation.frameHeight > 0
            ? t.animation.frameHeight
            : undefined;
        const fh = hintFH ?? Math.max(1, png.width);
        pngFrameCount = Math.max(1, Math.round(png.height / fh));
      } catch {
        /* fall back to metadata value */
      }

      archive.file(pngPath, { name: `assets/minecraft/textures/${pngName}` });

      const metaPath = join(projectDir(projectId), 'textures', `${t.id}.meta.json`);
      if (existsSync(metaPath) && (pngFrameCount > 1 || t.frameCount > 1)) {
        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as TextureMetaInfo;
          if (meta.animation) {
            const mc = buildMcMcmeta(meta.animation);
            if (mc) {
              // Minecraft requires the mcmeta to be named `<texture>.png.mcmeta`.
              archive.append(JSON.stringify(mc, null, 2), {
                name: `assets/minecraft/textures/${pngName}.mcmeta`,
              });
            }
          }
        } catch {
          // ignore malformed meta
        }
      }
      textureCount++;
    }

    void archive.finalize();
  });

  return { ok: true, path: targetPath, textureCount };
}

// ============================================================================
// Import (resource-pack .zip)
// ============================================================================

interface ParsedTexture {
  pngBuffer: Buffer;
  width: number;
  frameHeight: number;
  frameCount: number;
  animation?: McAnimationMeta;
}

interface YauzlEntry {
  fileName: string;
}
interface YauzlZip {
  on(event: string, listener: (...args: unknown[]) => void): void;
  readEntry(): void;
  openReadStream(
    entry: YauzlEntry,
    callback: (err: Error | null, stream: NodeJS.ReadableStream | null) => void,
  ): void;
  close(): void;
}

export interface ImportSession {
  textures: Map<string, ParsedTexture>;
  previews: ImportTexturePreview[];
  /** Every file in the imported zip (full pack), keyed by its zip-relative path. */
  assets: Map<string, Buffer>;
}

async function readZipEntries(zipPath: string): Promise<Map<string, Buffer>> {
  const zip = await new Promise<YauzlZip>((resolve, reject) => {
    yauzl.open(
      zipPath,
      { lazyEntries: true },
      (err: Error | null, z: unknown) => {
        if (err || !z) reject(err ?? new Error('Failed to open zip'));
        else resolve(z as unknown as YauzlZip);
      },
    );
  });
  const entries = new Map<string, Buffer>();
  await new Promise<void>((resolve, reject) => {
    zip.on('error', (...args: unknown[]) => reject(args[0]));
    zip.on('end', () => resolve());
    zip.readEntry();
    zip.on('entry', (...args: unknown[]) => {
      const entry = args[0] as YauzlEntry;
      if (/\/$/.test(entry.fileName)) {
        zip.readEntry();
        return;
      }
      zip.openReadStream(entry, (err: Error | null, stream: NodeJS.ReadableStream | null) => {
        if (err || !stream) {
          if (err) reject(err);
          return;
        }
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => {
          entries.set(entry.fileName, Buffer.concat(chunks));
          zip.readEntry();
        });
        stream.on('error', (e: unknown) => reject(e));
      });
    });
  });
  await zip.close();
  return entries;
}

interface RawAnimBlock {
  interpolate?: boolean;
  frametime?: number;
  frames?: unknown;
  width?: number;
  height?: number;
}

/**
 * Detect a vertical strip whose frames are separated by (mostly) transparent
 * gap rows, crop the gaps out, and return a clean contiguous strip plus its real
 * frame height. Minecraft cannot animate strips that contain spacing between
 * frames, so we rebuild a gap-free strip for export. Detection tolerates
 * anti-aliased edges / stray pixels in the gap rows (a row is a gap when less
 * than GAP_T of its pixels are opaque). Returns null when there are no gaps
 * (already clean) or when the layout is ambiguous.
 */
function cleanStripGaps(png: PNG): { png: PNG; frameHeight: number; frameCount: number } | null {
  const { width, height, data } = png;
  if (width <= 0 || height <= width) return null; // only vertical strips

  const GAP_T = 0.1; // a row is a gap when <10% of its pixels are opaque
  const opaqueFrac = (y: number): number => {
    const off = y * width * 4;
    let c = 0;
    for (let x = 0; x < width; x++) {
      if (data[off + x * 4 + 3] > 8) c++;
    }
    return c / width;
  };
  const isGap = (y: number): boolean => opaqueFrac(y) < GAP_T;

  // Group consecutive rows into runs of frame / gap.
  const runs: { gap: boolean; h: number }[] = [];
  let y = 0;
  while (y < height) {
    const gap = isGap(y);
    let h = 0;
    while (y < height && isGap(y) === gap) {
      y++;
      h++;
    }
    runs.push({ gap, h });
  }

  const frameRuns = runs.filter((r) => !r.gap);
  const gapRuns = runs.filter((r) => r.gap);
  if (frameRuns.length < 2 || gapRuns.length === 0) return null;

  // Frame height = the shortest frame band, so we never copy gap pixels into a
  // frame. Each frame is cropped to exactly H rows (remaining rows stay
  // transparent) so the result is a uniform MC-ready strip.
  const H = frameRuns.reduce((m, r) => Math.min(m, r.h), Infinity);
  if (!isFinite(H) || H <= 0) return null;
  const frameCount = frameRuns.length;

  const out = new PNG({ width, height: H * frameCount, colorType: 6 });
  let srcY = 0;
  let dstY = 0;
  for (const run of runs) {
    if (!run.gap) {
      const take = Math.min(run.h, H);
      for (let r = 0; r < take; r++) {
        const sOff = (srcY + r) * width * 4;
        const dOff = (dstY + r) * width * 4;
        for (let x = 0; x < width * 4; x++) out.data[dOff + x] = data[sOff + x];
      }
      dstY += H; // uniform height; unwritten rows stay transparent
    }
    srcY += run.h;
  }

  return { png: out, frameHeight: H, frameCount };
}

/**
 * Resolve a Minecraft animation block into the actual strip frame count and the
 * metadata we persist. Crucially, `frameCount` is always the number of frames
 * physically present in the PNG. A `frames` array in the mcmeta is a *display
 * sequence* (which may repeat indices) — it does NOT change how many frames are
 * stored; we preserve it separately as `frameList`. Non-square frames use the
 * mcmeta `width`/`height` to size each frame (MC supports this for animations).
 */
function parseAnimationMeta(
  animBlock: RawAnimBlock | null,
  width: number,
  height: number,
): { frameCount: number; frameHeight: number; animation?: McAnimationMeta } {
  const ft = animBlock && typeof animBlock.frametime === 'number' ? animBlock.frametime : 2;

  // Frame dimensions: prefer an explicit mcmeta `height` (non-square frames),
  // otherwise assume square frames (frameHeight == texture width).
  const explicitFH =
    animBlock && typeof animBlock.height === 'number' && animBlock.height > 0
      ? animBlock.height
      : undefined;
  const frameHeight = explicitFH ?? Math.max(1, width);
  const frameCount = Math.max(1, Math.round(height / frameHeight));

  if (!animBlock) {
    // No animation metadata: the whole image is a single static frame. Preserve
    // its real (possibly non-square) height instead of assuming square frames,
    // which would squish a 341x800 image into 341x341 and drop the rest.
    return { frameCount: 1, frameHeight: height };
  }

  let frameList: number[] | undefined;
  let frameTime: number[];

  if (Array.isArray(animBlock.frames)) {
    const steps = (animBlock.frames as unknown[]).map((f) => {
      if (typeof f === 'object' && f !== null) {
        const o = f as { index?: number; time?: number };
        return {
          index: typeof o.index === 'number' ? o.index : 0,
          time: typeof o.time === 'number' ? o.time : ft,
        };
      }
      return { index: typeof f === 'number' ? f : 0, time: ft };
    });
    frameList = steps.map((s) => s.index);
    // Per-actual-frame duration = the time of the first step showing that frame.
    frameTime = [];
    for (let i = 0; i < frameCount; i++) {
      const step = steps.find((s) => s.index === i);
      frameTime.push(step ? step.time : ft);
    }
    // Drop frameList when it's just the identity sequence (no repeats / reorder).
    const isIdentity =
      frameList.length === frameCount && frameList.every((v, i) => v === i);
    if (isIdentity) frameList = undefined;
  } else {
    frameTime = Array(frameCount).fill(ft);
  }

  const animation: McAnimationMeta = {
    interpolate: !!animBlock.interpolate,
    defaultFrameTicks: ft,
    frameTime,
    ...(frameList ? { frameList } : {}),
    ...(animBlock && typeof animBlock.width === 'number' && animBlock.width > 0
      ? { frameWidth: animBlock.width }
      : {}),
    ...(explicitFH ? { frameHeight: explicitFH } : {}),
  };
  return { frameCount, frameHeight, animation };
}

export async function readImportZip(
  projectId: string,
  zipPath: string,
): Promise<ImportSession> {
  // Build a map of existing texture paths -> source for conflict detection.
  const existing = new Map<string, 'vanilla' | 'user' | 'imported'>();
  const texDir = join(projectDir(projectId), 'textures');
  if (existsSync(texDir)) {
    const files = await fs.readdir(texDir);
    for (const f of files) {
      if (!f.endsWith('.meta.json')) continue;
      try {
        const meta = JSON.parse(
          await fs.readFile(join(texDir, f), 'utf8'),
        ) as TextureMetaInfo;
        if (meta.path) existing.set(meta.path, meta.source ?? 'user');
      } catch {
        // ignore
      }
    }
  }

  const entries = await readZipEntries(zipPath);
  const textures = new Map<string, ParsedTexture>();
  const previews: ImportTexturePreview[] = [];

  const prefix = 'assets/minecraft/textures/';
  for (const [rel, bufIn] of entries) {
    if (!rel.toLowerCase().endsWith('.png')) continue;
    let buf = bufIn;
    // Accept any texture layout: strict MC path, other namespaces
    // (assets/<ns>/textures/...), a bare textures/ folder, or a generic
    // (non-Minecraft) zip of PNGs — fall back to the entry path itself.
    let mcPath: string;
    if (rel.startsWith(prefix)) {
      mcPath = rel.slice(prefix.length).replace(/\.png$/i, '');
    } else {
      const texIdx = rel.lastIndexOf('textures/');
      if (texIdx >= 0) {
        mcPath = rel.slice(texIdx + 'textures/'.length).replace(/\.png$/i, '');
      } else {
        mcPath = rel.replace(/\.png$/i, '');
      }
    }
    let png: PNG;
    try {
      png = PNG.sync.read(buf);
    } catch {
      continue;
    }

    // Read the .mcmeta FIRST: it is authoritative about frame height. Only when
    // there is no .mcmeta do we attempt to auto-crop transparent gaps between
    // frames (MC cannot animate strips with spacing). Cropping a strip that has
    // a .mcmeta would corrupt frames whose own pixels contain transparent rows
    // (e.g. a diagonal axe), so we never crop in that case.
    const mcmetaRel = `${rel}.mcmeta`;
    let animBlock: { interpolate?: boolean; frametime?: number; frames?: unknown } | null = null;
    if (entries.has(mcmetaRel)) {
      try {
        const parsed = JSON.parse(entries.get(mcmetaRel)!.toString('utf8')) as {
          animation?: { interpolate?: boolean; frametime?: number; frames?: unknown };
        };
        animBlock = parsed.animation ?? null;
      } catch {
        animBlock = null;
      }
    }

    let width = png.width;
    let height = png.height;
    let cleaned: { png: PNG; frameHeight: number; frameCount: number } | null = null;
    if (!animBlock) {
      cleaned = cleanStripGaps(png);
      if (cleaned) {
        png = cleaned.png;
        buf = Buffer.from(PNG.sync.write(png));
        width = png.width;
        height = png.height;
      }
    }

    const parsed = parseAnimationMeta(animBlock, width, height);
    let frameCount = parsed.frameCount;
    let frameHeight = parsed.frameHeight;
    let animation: McAnimationMeta | undefined = parsed.animation;

    if (!animation && width > 0 && height > width && height % width === 0) {
      // No .mcmeta, but a vertical strip of square frames => treat as an animation.
      const fc = Math.round(height / width);
      frameHeight = Math.max(1, Math.round(height / fc));
      animation = {
        interpolate: false,
        defaultFrameTicks: 2,
        frameTime: Array(fc).fill(2),
      };
      frameCount = fc;
    }

    if (cleaned) {
      // Override with gap-cropped dimensions; keep any mcmeta timing if present.
      const ft = animBlock && typeof animBlock.frametime === 'number' ? animBlock.frametime : 2;
      frameCount = cleaned.frameCount;
      frameHeight = cleaned.frameHeight;
      animation = {
        interpolate: !!(animBlock && animBlock.interpolate),
        defaultFrameTicks: ft,
        frameTime: Array(frameCount).fill(ft),
        ...(cleaned.frameHeight > 0 ? { frameHeight: cleaned.frameHeight } : {}),
      };
    }

    const hasAnimation = !!animBlock || frameCount > 1;
    const name = basename(mcPath);

    textures.set(mcPath, {
      pngBuffer: buf,
      width,
      frameHeight,
      frameCount,
      animation,
    });
    previews.push({
      path: mcPath,
      name,
      width,
      frameHeight,
      frameCount,
      hasAnimation,
      sizeBytes: buf.length,
      exists: existing.has(mcPath),
      existingSource: existing.get(mcPath),
    });
  }

  return { textures, previews, assets: entries };
}

export async function applyImport(
  projectId: string,
  session: ImportSession,
  selections: ImportSelection[],
): Promise<ImportResult> {
  const ids: string[] = [];
  let imported = 0;
  let skipped = 0;

  // Persist every file from the imported pack so the export can carry them
  // through (textures, models, pack.mcmeta, pack.png, lang, etc.). Edited
  // textures/mcmetas are re-exported from the project and take precedence;
  // untouched ones simply pass through unchanged.
  const passDir = join(projectDir(projectId), 'passthrough');
  await fs.mkdir(passDir, { recursive: true });
  // Write all passthrough files concurrently (parallel Promise.all) instead of
  // serially; importing a large pack has thousands of files.
  await Promise.all(
    Array.from(session.assets.entries()).map(async ([rel, buf]) => {
      const target = join(passDir, rel);
      await fs.mkdir(dirname(target), { recursive: true });
      await fs.writeFile(target, buf);
    }),
  );

  for (const sel of selections) {
    if (sel.action === 'skip') {
      skipped++;
      continue;
    }
    const parsed = session.textures.get(sel.path);
    if (!parsed) continue;
    const targetPath =
      sel.action === 'rename' && sel.targetPath ? sel.targetPath : sel.path;
    const id = idFromPath(targetPath);

    // Manual frame-height override: crop the strip into frames of `frameHeight`
    // px, stepping `frameHeight + gapHeight` px each frame. This handles strips
    // whose gaps are opaque/solid (auto-detection only sees transparent gaps).
    let pngBuffer = parsed.pngBuffer;
    let frameHeight = parsed.frameHeight;
    let frameCount = parsed.frameCount;
    let animation = parsed.animation;
    if (sel.frameHeight && sel.frameHeight > 0) {
      try {
        const png = PNG.sync.read(parsed.pngBuffer);
        const gap = sel.gapHeight && sel.gapHeight > 0 ? sel.gapHeight : 0;
        const cropped = cropStripToFrames(png, sel.frameHeight, gap);
        if (cropped) {
          pngBuffer = Buffer.from(PNG.sync.write(cropped.png));
          frameHeight = sel.frameHeight;
          frameCount = cropped.frameCount;
          const ft = animation?.defaultFrameTicks ?? 2;
          animation = {
            interpolate: animation?.interpolate ?? false,
            defaultFrameTicks: ft,
            frameTime: Array(frameCount).fill(ft),
            ...(frameHeight > 0 ? { frameHeight } : {}),
          };
        }
      } catch {
        /* fall back to auto-detected values */
      }
    }

    await writeTextureBundle(projectId, id, {
      width: parsed.width,
      height: frameHeight,
      frameCount,
      pngBuffer,
      source: 'imported',
      path: targetPath,
      name: basename(targetPath),
      animation,
    });
    imported++;
    ids.push(id);
  }
  return { imported, skipped, ids };
}

/**
 * Crop a vertical strip into `frameHeight`-tall frames, stepping
 * `frameHeight + gapHeight` pixels between frame starts. Returns a clean,
 * gap-free strip suitable for Minecraft.
 */
function cropStripToFrames(
  png: PNG,
  frameHeight: number,
  gapHeight: number,
): { png: PNG; frameCount: number } | null {
  const { width, height } = png;
  if (width <= 0 || frameHeight <= 0) return null;
  const stride = frameHeight + Math.max(0, gapHeight);
  if (stride <= 0) return null;
  let frameCount = 0;
  for (let y = 0; y + frameHeight <= height; y += stride) frameCount++;
  if (frameCount < 1) return null;
  const out = new PNG({ width, height: frameHeight * frameCount, colorType: 6 });
  for (let k = 0; k < frameCount; k++) {
    const srcY = k * stride;
    const dstY = k * frameHeight;
    for (let r = 0; r < frameHeight; r++) {
      const sOff = (srcY + r) * width * 4;
      const dOff = (dstY + r) * width * 4;
      for (let x = 0; x < width * 4; x++) out.data[dOff + x] = png.data[sOff + x];
    }
  }
  return { png: out, frameCount };
}

export async function importPngFile(
  projectId: string,
  pngBytes: Buffer,
  suggestedName?: string,
): Promise<AddTextureResult> {
  let png: PNG;
  try {
    png = PNG.sync.read(pngBytes);
  } catch {
    return { cancelled: false };
  }
  const name = suggestedName ?? 'imported_texture';
  const path = name;
  const id = `${idFromPath(path)}_${cryptoRandomId().slice(0, 6)}`;
  await writeTextureBundle(projectId, id, {
    width: png.width,
    height: png.height,
    frameCount: 1,
    pngBuffer: pngBytes,
    source: 'imported',
    path,
    name,
    animation: undefined,
  });
  return { id, name, path };
}
