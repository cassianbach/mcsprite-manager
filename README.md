# MCsprite Manager

A Windows desktop app for:

- **Minecraft texture editing** — paint, recolor, animate the vanilla catalog, export a `.zip` resource pack with `pack.mcmeta`
- **Game sprite editing** — standalone pixel art with PNG / GIF / sprite-sheet exports
- **Project workspaces** — isolate edits per project, see exactly what you modified
- **Collaboration** — share a link and edit the same project with others (work in progress)

## Coming soon

- **Minecraft version changer** — switch the target MC version for your resource pack

## Prerequisites

- Windows 10/11
- **Node.js 18+** (for building from source only — end users don't need Node)

## Build a Windows installer

```powershell
npm install
npm run package          # NSIS installer + portable .exe in release/
npm run package:portable # just the portable .exe
```

The installer bundles everything (Electron runtime included), so end users don't need Node.js. It creates a desktop shortcut and Start Menu entry.

## Scripts

| Script | What |
|---|---|
| `npm run dev` | Electron + Vite HMR |
| `npm run build` | Build main/preload/renderer to `out/` |
| `npm run typecheck` | TS check for Node + Web |
| `npm run package` | Build Windows installer + portable |
| `npm run sync:vanilla` | Download newest MC client jar and extract vanilla textures to `resources/vanilla/` |

## Architecture

```
src/
  main/        Electron main process (Node) — IPC, file dialogs, settings, project store
  preload/     contextBridge API exposed to renderer as window.api
  renderer/    React + TS app
    src/
      components/  Shell, CanvasViewport, ColorPicker, Button, ...
      pages/       ProjectBrowser, Editor, SpriteEditor, Catalog, BulkEdit, ImportExport
      store/       Zustand: settings, editor UI, project (with history), clipboard
      lib/         color utils, canvas pixel ops
      styles/      tokens.css + global.css
  shared/      Types and IPC channel constants shared between main/renderer
scripts/
  sync-vanilla.ts   Build-time vanilla texture downloader
resources/
  vanilla/          Bundled vanilla textures (synced, gitignored for binaries)
dev.bat             Sets PATH and runs `npm run dev`
build-installer.bat Sets PATH and runs `npm run package`
```

## Notes on disk layout

Because C: was full, the project and all caches live on D::

- Project: `D:\texture-editor\`
- node_modules: `D:\texture-editor\node_modules\`
- npm cache: `D:\npm-cache\`
- npm tmp: `D:\npm-tmp\`
- Electron cache: `D:\electron-cache\`
- Electron download cache: `D:\electron-download\`
- App data (created at runtime): `%APPDATA%\texture-editor\projects\<uuid>\`

User projects are stored under `%APPDATA%` (C:) by default — if you'd rather keep them on D: too, change `PROJECTS_ROOT` in `src/main/projectStore.ts` to `join('D:', 'texture-editor-projects')`.
