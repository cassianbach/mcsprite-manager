# MCsprite Manager

A Windows desktop app for Minecraft resource packs and pixel art — paint, animate, and manage textures with vanilla catalog, project workspaces, bulk editing, and community uploads.

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


