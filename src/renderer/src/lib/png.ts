/**
 * Encode RGBA pixels as a clean PNG (no iCCP/color-profile chunk).
 *
 * Minecraft's texture loader rejects PNGs that carry an sRGB iCCP chunk on
 * resource-pack reload, so we re-encode via the main process (which has
 * access to pngjs — the renderer can't run pngjs because it depends on
 * Node's `zlib`/`stream` modules).
 *
 * Returns a `data:image/png;base64,...` URL suitable for storage in studio
 * JSON or direct `<img src>` use.
 */
export async function encodeCleanPng(
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray,
): Promise<string> {
  const ab = await window.api.studio.encodePng(width, height, rgba);
  const bytes = new Uint8Array(ab);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return `data:image/png;base64,${btoa(bin)}`;
}
