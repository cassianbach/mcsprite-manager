import { writeIco, encodePng, rasterizeLogo } from '../src/main/logoRaster';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'build');
mkdirSync(outDir, { recursive: true });

// Multi-size Windows ICO (embedded into the exe + used for the desktop shortcut).
writeIco(outDir, 'icon', [16, 24, 32, 48, 64, 128, 256]);

// 256x256 PNG (electron-builder also reads this for the installer/portable).
writeFileSync(join(outDir, 'icon.png'), encodePng(rasterizeLogo(256, 0xc1), 256, 256));

console.log('Icons written to', outDir);
