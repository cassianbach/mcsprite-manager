# Building & contributing

## Environment

- Windows 10/11
- Node.js 18+ (LTS recommended)
- npm 9+

Verify:

```powershell
node --version
npm --version
```

## First run

```powershell
git clone <your-repo>
cd texture-editor
npm install
npm run dev
```

If `npm install` complains about native modules (it shouldn't — nothing native here), open an issue with the log.

## Code signing (for installers)

The Windows installer can be code-signed for SmartScreen trust.

1. Get a code-signing cert (`.pfx`).
2. Set env vars before `npm run package`:

```powershell
$env:CSC_LINK      = 'C:\path\to\cert.pfx'
$env:CSC_KEY_PASSWORD = 'your-password'
```

3. `electron-builder` picks them up automatically.

If you skip signing, the installer still works — Windows SmartScreen will warn on first run.

## Auto-update

Auto-update is wired via `electron-updater` and reads GitHub Releases:

```yaml
# electron-builder.yml
publish:
  provider: github
  owner: yourname
  repo: texture-editor
```

Release flow:

```powershell
npm version patch         # bumps package.json
npm run package           # builds installers in release/<version>/
# Then upload release/<version>/* to a GitHub release tagged v<version>
```

App users get the update on next launch.

## Vanilla texture sync

The catalog of bundled vanilla textures lives in `resources/vanilla/<mc-version>/`. It's not committed to git (binaries).

To refresh:

```powershell
npm run sync:vanilla
```

This downloads the latest Minecraft client jar from Mojang's official manifest, extracts `assets/minecraft/`, and writes a `version.json` with metadata. The script is idempotent and overwrites the previous sync.

The app reads these files at runtime — paths are exposed read-only to the renderer via `extraResources` in `electron-builder.yml`.

## Adding a new IPC channel

1. Add the channel name to `IPC` in `src/shared/types.ts`.
2. Register the handler in `src/main/index.ts` under `registerIpc()`.
3. Expose it in `src/preload/index.ts` inside the `api` object.
4. Use it from the renderer via `window.api.<namespace>.<method>(...)`.

The `Api` type is inferred from `api` and re-exported from preload, so `window.api` is fully typed in TS.

## Adding a tool

1. Add the id to `ToolId` in `src/renderer/src/store/editor.ts`.
2. Add the icon case to `ToolIcon` in `src/renderer/src/pages/Editor.tsx`.
3. Wire the tool's behavior in the canvas input handler (Phase 1).

## Theme

All colors come from CSS variables in `src/renderer/src/styles/tokens.css`. To tweak the look, edit tokens only — never hard-code colors in components.

The theme is controlled by `document.documentElement.dataset.theme` (`'dark'` or `'light'`). The store sets this on load and on toggle.

## Performance

- Decoded textures cache to IndexedDB via `idb-keyval` (Phase 1).
- Heavy filters run in `OffscreenCanvas` where possible (Phase 1+).
- Long bulk operations run in a Web Worker (Phase 7).
- Export streaming happens in the main process via `archiver` (Phase 6) so the renderer never holds the whole zip in memory.

## Testing (planned)

- Vitest for unit (color math, MC path parsing, mcmeta generation, GIF encoder wrapper)
- Playwright for editor E2E (open texture → pencil stroke → undo → save → reload)

## Troubleshooting

**Window is blank in dev.**
Open DevTools (Ctrl+Shift+I in dev). Check Console. Likely a missing dep.

**`Cannot find module 'electron'` after install.**
Delete `node_modules` and `package-lock.json`, then `npm install` again.

**Installer blocked by SmartScreen.**
Click "More info" → "Run anyway". Or sign the installer (see above).
