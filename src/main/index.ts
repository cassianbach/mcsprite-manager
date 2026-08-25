import { app, BrowserWindow, ipcMain, nativeTheme, shell, dialog } from 'electron';
import { join, basename } from 'node:path';
import { existsSync, promises as fs } from 'node:fs';
import Store from 'electron-store';
import { autoUpdater } from 'electron-updater';
import { IPC } from '../shared/types';
import type {
  AppSettings,
  Project,
  ProjectListEntry,
  ImportSelection,
  ImportResult,
  ExportResult,
  ImportZipOpenResult,
  AddTextureResult,
  CollabHostInfo,
  UpdateInfo,
} from '../shared/types';
import type { ImportSession } from './projectStore';
import {
  createProject,
  deleteProject,
  listProjects,
  renameProject,
  loadProjectTexture,
  saveProjectTexture,
  deleteProjectTexture,
  saveProjectTexturePixels,
  saveProjectTextureFull,
  listProjectTextures,
  listDetailed,
  exportZipTo,
  readImportZip,
  applyImport,
  importPngFile,
  readVanillaIndex,
  readVanillaPng,
  addVanillaTexture,
} from './projectStore';
import { startCollabServer, stopCollabServer, getLanAddress } from './collabServer';
import { writeAppIconSet } from './logoRaster';

const importSessions = new Map<string, ImportSession>();

const store = new Store<AppSettings>({
  name: 'settings',
  defaults: {
    theme: 'dark',
    activeMode: 'texture',
    activeProjectId: null,
    shortcuts: {},
  },
});

let mainWindow: BrowserWindow | null = null;

// ============================================================================
// Auto-update (electron-updater). Only meaningful in a packaged build; in dev
// there is no app-update.yml so checks are skipped gracefully.
// ============================================================================
let updateState: UpdateInfo = { status: 'idle' };

function broadcastUpdate(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.update.onStatus, updateState);
  }
}

function setUpdateState(next: Partial<UpdateInfo>): void {
  updateState = { ...updateState, ...next };
  broadcastUpdate();
}

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking' }));
  autoUpdater.on('update-available', (info) =>
    setUpdateState({ status: 'available', version: info.version }),
  );
  autoUpdater.on('update-not-available', () => setUpdateState({ status: 'not-available' }));
  autoUpdater.on('download-progress', (p) =>
    setUpdateState({ status: 'downloading', percent: Math.round(p.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    setUpdateState({ status: 'downloaded', version: info.version }),
  );
  autoUpdater.on('error', (err) =>
    setUpdateState({ status: 'error', error: err?.message ?? String(err) }),
  );
}

function createWindow(): void {
  // Generate the app icon set (PNG per size + a Windows ICO) under userData
  // so the OS taskbar / Alt-Tab switcher / pinned taskbar shortcuts show the
  // nebula-C logo. Deterministic so it stays in sync with the renderer Logo.
  const iconDir = join(app.getPath('userData'), 'icons');
  const { icoPath } = writeAppIconSet(iconDir);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d10' : '#f5f7fa',
    title: 'MCsprite Manager',
    icon: icoPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Explicit setIcon in addition to the constructor option (Windows reads
  // the WM_SETICON messages, and setIcon sends them on all platforms).
  mainWindow.setIcon(icoPath);

  mainWindow.on('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.settings.get, () => ({
    theme: store.get('theme'),
    activeMode: store.get('activeMode'),
    activeProjectId: store.get('activeProjectId'),
    shortcuts: store.get('shortcuts') ?? {},
  }));
  ipcMain.handle(IPC.settings.set, (_e, next: Partial<AppSettings>) => {
    for (const [k, v] of Object.entries(next)) {
      store.set(k as keyof AppSettings, v as never);
    }
    return store.store;
  });

  ipcMain.handle(IPC.theme.set, (_e, theme: 'dark' | 'light' | 'system') => {
    nativeTheme.themeSource = theme;
    return nativeTheme.themeSource;
  });

  ipcMain.on(IPC.window.minimize, () => mainWindow?.minimize());
  ipcMain.on(IPC.window.maximize, () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on(IPC.window.close, () => mainWindow?.close());
  ipcMain.handle(IPC.window.isMaximized, () => mainWindow?.isMaximized());

  ipcMain.handle(IPC.projects.list, (): Promise<ProjectListEntry[]> => listProjects());
  ipcMain.handle(IPC.projects.create, (_e, partial): Promise<Project> => createProject(partial));
  ipcMain.handle(IPC.projects.delete, (_e, id: string) => deleteProject(id));
  ipcMain.handle(IPC.projects.rename, (_e, id: string, name: string) => renameProject(id, name));
  ipcMain.handle(IPC.projects.open, (_e, _id: string) => true);

  ipcMain.handle(IPC.textures.list, (_e, projectId: string) => listProjectTextures(projectId));
  ipcMain.handle(IPC.textures.load, (_e, projectId: string, textureId: string) =>
    loadProjectTexture(projectId, textureId),
  );
  ipcMain.handle(
    IPC.textures.save,
    (_e, projectId: string, textureId: string, pngBytes: Uint8Array) =>
      saveProjectTexture(projectId, textureId, Buffer.from(pngBytes)),
  );
  ipcMain.handle(
    IPC.textures.savePixels,
    (
      _e,
      projectId: string,
      textureId: string,
      width: number,
      height: number,
      rgba: Uint8Array | Uint8ClampedArray,
    ) => saveProjectTexturePixels(projectId, textureId, width, height, rgba),
  );
  ipcMain.handle(IPC.textures.readVanillaIndex, () => readVanillaIndex());
  ipcMain.handle(IPC.textures.readVanillaPng, (_e, vanillaId: string) => readVanillaPng(vanillaId));
  ipcMain.handle(
    IPC.textures.addVanilla,
    (_e, projectId: string, vanillaId: string) => addVanillaTexture(projectId, vanillaId),
  );

  ipcMain.handle(IPC.textures.delete, (_e, projectId: string, textureId: string) =>
    deleteProjectTexture(projectId, textureId),
  );

  ipcMain.handle(
    IPC.textures.saveFull,
    (
      _e,
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
        animation?: {
          interpolate: boolean;
          defaultFrameTicks: number;
          frameTime: number[];
          frameList?: number[];
          frameWidth?: number;
          frameHeight?: number;
        };
      },
    ) => saveProjectTextureFull(projectId, textureId, input),
  );

  ipcMain.handle(IPC.io.exportList, (_e, projectId: string) => listDetailed(projectId));

  ipcMain.handle(
    IPC.io.exportZip,
    async (_e, projectId: string, opts?: { packFormat?: number; description?: string }): Promise<ExportResult> => {
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export resource pack',
        defaultPath: 'resource-pack.zip',
        filters: [{ name: 'Resource pack', extensions: ['zip'] }],
      });
      if (result.canceled || !result.filePath) {
        return { ok: false, cancelled: true, textureCount: 0 };
      }
      return exportZipTo(projectId, result.filePath, opts);
    },
  );

  ipcMain.handle(
    IPC.io.exportPng,
    async (_e, projectId: string, textureId: string, defaultName: string): Promise<ExportResult> => {
      const pngPath = join(app.getPath('userData'), 'projects', projectId, 'textures', `${textureId}.png`);
      if (!existsSync(pngPath)) {
        return { ok: false, textureCount: 0 };
      }
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export texture as PNG',
        defaultPath: `${defaultName || textureId}.png`,
        filters: [{ name: 'PNG', extensions: ['png'] }],
      });
      if (result.canceled || !result.filePath) {
        return { ok: false, cancelled: true, textureCount: 0 };
      }
      const buf = await fs.readFile(pngPath);
      await fs.writeFile(result.filePath, buf);
      return { ok: true, path: result.filePath, textureCount: 1 };
    },
  );

  ipcMain.handle(IPC.io.importZipOpen, async (_e, projectId: string): Promise<ImportZipOpenResult> => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Import resource pack',
      properties: ['openFile'],
      filters: [{ name: 'Resource pack', extensions: ['zip'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true };
    }
    const session = await readImportZip(projectId, result.filePaths[0]);
    const sessionId = Math.random().toString(36).slice(2);
    importSessions.set(sessionId, session);
    return { sessionId, previews: session.previews };
  });

  ipcMain.handle(
    IPC.io.importZipApply,
    async (_e, projectId: string, sessionId: string, selections: ImportSelection[]): Promise<ImportResult> => {
      const session = importSessions.get(sessionId);
      if (!session) {
        return { imported: 0, skipped: 0, ids: [] };
      }
      const res = await applyImport(projectId, session, selections);
      importSessions.delete(sessionId);
      return res;
    },
  );

  ipcMain.handle(IPC.io.importPng, async (_e, projectId: string): Promise<AddTextureResult> => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Import PNG as new texture',
      properties: ['openFile'],
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true };
    }
    const buf = await fs.readFile(result.filePaths[0]);
    const name = basename(result.filePaths[0]).replace(/\.png$/i, '');
    return importPngFile(projectId, buf, name);
  });

  ipcMain.handle(IPC.collab.start, async (_e, projectId: string, relayUrl?: string): Promise<CollabHostInfo> => {
    // Relay mode: the session lives on an external server (cross-network). We don't
    // start a local server; the invite link carries the relay URL instead.
    if (relayUrl) {
      const link = `texture-editor://collab?relay=${encodeURIComponent(relayUrl)}&room=${encodeURIComponent(projectId)}`;
      return { port: 0, host: '', room: projectId, url: relayUrl, link, relay: relayUrl };
    }
    const { port } = await startCollabServer();
    const host = getLanAddress();
    const url = `ws://${host}:${port}`;
    const link = `texture-editor://collab?host=${encodeURIComponent(host)}&port=${port}&room=${encodeURIComponent(projectId)}`;
    return { port, host, room: projectId, url, link };
  });

  ipcMain.handle(IPC.collab.stop, () => {
    stopCollabServer();
    return { ok: true };
  });

  ipcMain.handle(IPC.update.check, async (): Promise<UpdateInfo> => {
    if (!app.isPackaged) {
      setUpdateState({ status: 'not-available' });
      return updateState;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      setUpdateState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
    return updateState;
  });

  ipcMain.handle(IPC.update.install, (): UpdateInfo => {
    if (updateState.status === 'downloaded') {
      autoUpdater.quitAndInstall();
    }
    return updateState;
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  setupAutoUpdater();

  app.setAsDefaultProtocolClient('texture-editor');
  const forwardLink = (url: string) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send('collab:deeplink', url);
  };
  app.on('open-url', (_e, url) => forwardLink(url));
  app.on('second-instance', (_e, argv) => {
    const url = argv.find((a) => a.startsWith('texture-editor://'));
    if (url) forwardLink(url);
  });

  // On macOS/Linux a link that launched the app arrives in argv (handled via
  // open-url on macOS instead). Delay so the renderer's deeplink listener is
  // registered before we forward.
  if (process.platform !== 'darwin') {
    const launchLink = process.argv.find((a) => a.startsWith('texture-editor://'));
    if (launchLink) setTimeout(() => forwardLink(launchLink), 800);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopCollabServer();
  if (process.platform !== 'darwin') app.quit();
});
