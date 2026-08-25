/**
 * Download newest Minecraft client jar, extract its assets, and write them to
 * resources/vanilla/<version>/assets/minecraft/...
 *
 * Build-time only. Runs via `npm run sync:vanilla`.
 * Requires internet access to Mojang's version manifest.
 */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import AdmZip from 'adm-zip';
// Note: `adm-zip` is an optional devDependency for this script. Install on demand:
//   npm i -D adm-zip @types/adm-zip

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'resources', 'vanilla');

interface VersionManifest {
  latest: { release: string; snapshot: string };
  versions: { id: string; url: string }[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

interface VersionDetail {
  id: string;
  downloads: { client: { url: string; sha1: string; size: number } };
  assetIndex: { url: string; id: string };
}

interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>;
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  if (!res.body) throw new Error(`No body for ${url}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
}

export async function syncVanilla(): Promise<string> {
  const manifestUrl = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
  console.log('Fetching version manifest…');
  const manifest = await fetchJson<VersionManifest>(manifestUrl);
  const version = manifest.latest.release;
  console.log(`Latest release: ${version}`);

  const versionEntry = manifest.versions.find((v) => v.id === version);
  if (!versionEntry) throw new Error(`Version ${version} not found in manifest`);

  const versionDetail = await fetchJson<VersionDetail>(versionEntry.url);
  const versionDir = join(OUT_DIR, version);

  // Clean and recreate target
  if (existsSync(versionDir)) await rm(versionDir, { recursive: true, force: true });
  await mkdir(versionDir, { recursive: true });

  // Download client jar
  const jarPath = join(versionDir, 'client.jar');
  console.log(`Downloading ${version} client.jar…`);
  await downloadToFile(versionDetail.downloads.client.url, jarPath);

  // Extract assets/minecraft textures from jar
  console.log('Extracting assets…');
  const zip = new AdmZip(jarPath);
  const entries = zip.getEntries().filter((e) => e.entryName.startsWith('assets/minecraft/'));
  const extractedRoot = join(versionDir, 'assets', 'minecraft');
  await mkdir(extractedRoot, { recursive: true });

  for (const entry of entries) {
    const rel = entry.entryName.replace(/^assets\/minecraft\//, '');
    const outPath = join(extractedRoot, rel);
    await mkdir(dirname(outPath), { recursive: true });
    if (!entry.isDirectory) {
      await writeFile(outPath, entry.getData());
    }
  }

  // Drop the jar — we have what we need
  await rm(jarPath);

  // Write a tiny index marker (Phase 5 will turn this into a full catalog)
  await writeFile(
    join(versionDir, 'version.json'),
    JSON.stringify(
      {
        id: version,
        packFormat: inferPackFormat(version),
        syncedAt: new Date().toISOString(),
        textureCount: entries.length,
      },
      null,
      2,
    ),
  );

  console.log(`Done. ${entries.length} assets in ${versionDir}`);
  return version;
}

function inferPackFormat(id: string): number {
  // Approximate; Phase 5 will keep an authoritative table.
  const v = parseInt(id.split('.').slice(1).join('.'), 10);
  if (!Number.isFinite(v)) return 34;
  if (v >= 21) return 34;
  if (v >= 20) return 26;
  if (v >= 19) return 15;
  if (v >= 18) return 8;
  return 6;
}

syncVanilla().catch((err) => {
  console.error(err);
  process.exit(1);
});
