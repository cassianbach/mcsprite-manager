import { downloadBytes } from './gif';

export interface SheetFrame {
  name: string;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface SheetOptions {
  layout: 'grid' | 'packed';
  cell: number;
  columns: number;
  padding: number;
  trim: boolean;
}

interface Placed {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
}

function computeTrim(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = pixels[(y * width + x) * 4 + 3];
      if (a !== 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: width, h: height };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function layoutFrames(frames: SheetFrame[], opts: SheetOptions): { placed: Placed[]; sheetW: number; sheetH: number } {
  const placed: Placed[] = frames.map((f) => {
    const box = opts.trim ? computeTrim(f.pixels, f.width, f.height) : { x: 0, y: 0, w: f.width, h: f.height };
    return {
      name: f.name,
      x: 0,
      y: 0,
      w: box.w,
      h: box.h,
      srcX: box.x,
      srcY: box.y,
      srcW: box.w,
      srcH: box.h,
    };
  });

  if (opts.layout === 'grid') {
    const cols = Math.max(1, Math.floor(opts.columns));
    const maxW = placed.reduce((m, p) => Math.max(m, p.w), 0);
    const maxH = placed.reduce((m, p) => Math.max(m, p.h), 0);
    const step = Math.max(opts.cell, maxW, maxH);
    const rows = Math.ceil(placed.length / cols);
    placed.forEach((p, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      p.x = c * step;
      p.y = r * step;
    });
    return { placed, sheetW: cols * step, sheetH: rows * step };
  }

  const pad = Math.max(0, Math.floor(opts.padding));
  let cursorX = pad;
  let cursorY = pad;
  let rowH = 0;
  let sheetW = 0;
  for (const p of placed) {
    const fw = p.w + pad;
    const fh = p.h + pad;
    if (cursorX + fw > 4096) {
      cursorX = pad;
      cursorY += rowH;
      rowH = 0;
    }
    p.x = cursorX;
    p.y = cursorY;
    cursorX += fw;
    rowH = Math.max(rowH, fh);
    sheetW = Math.max(sheetW, cursorX);
  }
  return { placed, sheetW: sheetW + pad, sheetH: cursorY + rowH + pad };
}

export async function exportSpriteSheet(frames: SheetFrame[], opts: SheetOptions): Promise<void> {
  const { placed, sheetW, sheetH } = layoutFrames(frames, opts);
  const sheet = document.createElement('canvas');
  sheet.width = Math.max(1, sheetW);
  sheet.height = Math.max(1, sheetH);
  const sctx = sheet.getContext('2d');
  if (!sctx) throw new Error('No 2D context');
  sctx.clearRect(0, 0, sheet.width, sheet.height);

  const tmp = document.createElement('canvas');
  const tctx = tmp.getContext('2d');
  if (!tctx) throw new Error('No 2D context');

  const meta: Record<string, unknown> = {
    meta: { app: 'texture-editor', version: 1, layout: opts.layout, sheetWidth: sheet.width, sheetHeight: sheet.height },
    frames: {} as Record<string, unknown>,
  };
  const frameMap = meta.frames as Record<string, unknown>;
  const usedNames = new Set<string>();

  placed.forEach((p, i) => {
    const f = frames[i];
    tmp.width = f.width;
    tmp.height = f.height;
    tctx.clearRect(0, 0, f.width, f.height);
    tctx.putImageData(new ImageData(new Uint8ClampedArray(f.pixels), f.width, f.height), 0, 0);
    sctx.drawImage(tmp, p.srcX, p.srcY, p.srcW, p.srcH, p.x, p.y, p.w, p.h);

    let key = p.name || `frame_${i}`;
    if (usedNames.has(key)) {
      let n = 1;
      while (usedNames.has(`${key}_${n}`)) n++;
      key = `${key}_${n}`;
    }
    usedNames.add(key);
    frameMap[key] = {
      frame: { x: p.x, y: p.y, w: p.w, h: p.h },
      rotated: false,
      trimmed: opts.trim,
      spriteSourceSize: { x: p.srcX, y: p.srcY, w: p.w, h: p.h },
      sourceSize: { w: f.width, h: f.height },
    };
  });

  const png = await new Promise<Blob | null>((resolve) => sheet.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('Failed to encode PNG');
  const baseName = frames.length === 1 ? frames[0].name || 'spritesheet' : 'spritesheet';
  await downloadBytes(new Uint8Array(await png.arrayBuffer()), `${baseName}.png`, 'image/png');

  const json = JSON.stringify(meta, null, 2);
  await downloadBytes(new TextEncoder().encode(json), `${baseName}.json`, 'application/json');
}
