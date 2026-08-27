import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { IPC } from '../shared/types';
import type { AppSettings, Project, ProjectListEntry, CollabHostInfo, AddTextureResult, UpdateInfo } from '../shared/types';

interface LoadedTexture {
  textureId: string;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  base: Uint8ClampedArray;
  modified: boolean;
  source: 'vanilla' | 'user' | 'imported';
  path: string;
  name: string;
  frameCount: number;
  frameHeight: number;
  animation?: { interpolate: boolean; defaultFrameTicks: number; frames: { pixels: Uint8ClampedArray; tickDuration: number }[] };
}

interface VanillaIndex {
  version: string;
  textures: { id: string; path: string; category: string }[];
}

interface TextureDetailed {
  id: string;
  source: 'vanilla' | 'user' | 'imported';
  path: string;
  name: string;
  width: number;
  height: number;
  frameCount: number;
  frameHeight: number;
}

interface ImportTexturePreview {
  path: string;
  name: string;
  width: number;
  frameHeight: number;
  frameCount: number;
  hasAnimation: boolean;
  sizeBytes: number;
  exists: boolean;
  existingSource?: 'vanilla' | 'user' | 'imported';
}

interface ImportSelection {
  path: string;
  action: 'import' | 'skip' | 'overwrite' | 'rename';
  targetPath?: string;
}

const api = {
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settings.get),
    set: (next: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC.settings.set, next),
  },
  theme: {
    set: (theme: 'dark' | 'light' | 'system'): Promise<'dark' | 'light' | 'system'> =>
      ipcRenderer.invoke(IPC.theme.set, theme),
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.window.minimize),
    maximize: () => ipcRenderer.send(IPC.window.maximize),
    close: () => ipcRenderer.send(IPC.window.close),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.window.isMaximized),
  },
  projects: {
    list: (): Promise<ProjectListEntry[]> => ipcRenderer.invoke(IPC.projects.list),
    create: (partial: Partial<Project>): Promise<Project> =>
      ipcRenderer.invoke(IPC.projects.create, partial),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.projects.delete, id),
    rename: (id: string, name: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.projects.rename, id, name),
    setVersion: (id: string, mcVersion: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.projects.setVersion, id, mcVersion),
    open: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.projects.open, id),
  },
  textures: {
    list: (projectId: string): Promise<string[]> => ipcRenderer.invoke(IPC.textures.list, projectId),
    load: (projectId: string, textureId: string): Promise<LoadedTexture> =>
      ipcRenderer.invoke(IPC.textures.load, projectId, textureId),
    save: (projectId: string, textureId: string, pngBytes: Uint8Array): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.textures.save, projectId, textureId, pngBytes),
    savePixels: (
      projectId: string,
      textureId: string,
      width: number,
      height: number,
      rgba: Uint8Array | Uint8ClampedArray,
    ): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.textures.savePixels, projectId, textureId, width, height, rgba),
    saveFull: (
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
        animation?: { interpolate: boolean; defaultFrameTicks: number; frameTime: number[] };
      },
    ): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.textures.saveFull, projectId, textureId, input),
    readVanillaIndex: (): Promise<VanillaIndex | null> => ipcRenderer.invoke(IPC.textures.readVanillaIndex),
    readVanillaPng: (vanillaId: string): Promise<Uint8Array | null> =>
      ipcRenderer.invoke(IPC.textures.readVanillaPng, vanillaId),
    addVanilla: (projectId: string, vanillaId: string): Promise<AddTextureResult> =>
      ipcRenderer.invoke(IPC.textures.addVanilla, projectId, vanillaId),
    delete: (projectId: string, textureId: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.textures.delete, projectId, textureId),
  },
  io: {
    exportZip: (
      projectId: string,
      opts?: { packFormat?: number; description?: string },
    ): Promise<{ ok: boolean; cancelled?: boolean; path?: string; textureCount: number }> =>
      ipcRenderer.invoke(IPC.io.exportZip, projectId, opts),
    exportPng: (
      projectId: string,
      textureId: string,
      defaultName: string,
    ): Promise<{ ok: boolean; cancelled?: boolean; path?: string; textureCount: number }> =>
      ipcRenderer.invoke(IPC.io.exportPng, projectId, textureId, defaultName),
    exportList: (projectId: string): Promise<TextureDetailed[]> =>
      ipcRenderer.invoke(IPC.io.exportList, projectId),
    importZipOpen: (projectId: string): Promise<{
      cancelled?: boolean;
      sessionId?: string;
      previews?: ImportTexturePreview[];
    }> => ipcRenderer.invoke(IPC.io.importZipOpen, projectId),
    importZipApply: (
      projectId: string,
      sessionId: string,
      selections: ImportSelection[],
    ): Promise<{ imported: number; skipped: number; ids: string[] }> =>
      ipcRenderer.invoke(IPC.io.importZipApply, projectId, sessionId, selections),
    importPng: (projectId: string): Promise<{
      cancelled?: boolean;
      id?: string;
      name?: string;
      path?: string;
    }> => ipcRenderer.invoke(IPC.io.importPng, projectId),
  },
  collab: {
    start: (projectId: string, relayUrl?: string): Promise<CollabHostInfo> =>
      ipcRenderer.invoke(IPC.collab.start, projectId, relayUrl),
    stop: (): Promise<{ ok: true }> => ipcRenderer.invoke(IPC.collab.stop),
    onDeeplink: (cb: (link: string) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, link: string) => cb(link);
      ipcRenderer.on('collab:deeplink', listener);
      return () => ipcRenderer.removeListener('collab:deeplink', listener);
    },
  },
  update: {
    check: (): Promise<UpdateInfo> => ipcRenderer.invoke(IPC.update.check),
    install: (): Promise<UpdateInfo> => ipcRenderer.invoke(IPC.update.install),
    onStatus: (cb: (info: UpdateInfo) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, info: UpdateInfo) => cb(info);
      ipcRenderer.on(IPC.update.onStatus, listener);
      return () => ipcRenderer.removeListener(IPC.update.onStatus, listener);
    },
  },
  library: {
    listTextures: (): Promise<Array<{ id: string; path: string; name: string; width: number; height: number; uploader: string; uploadedAt: number }>> =>
      ipcRenderer.invoke(IPC.library.listTextures),
    listPacks: (): Promise<Array<{ id: string; fileName: string; originalFileName: string; description: string; textureCount: number; sizeBytes: number; uploader: string; uploadedAt: number }>> =>
      ipcRenderer.invoke(IPC.library.listPacks),
    uploadTexture: (): Promise<{ cancelled?: boolean; meta?: unknown }> => ipcRenderer.invoke(IPC.library.uploadTexture),
    uploadPack: (): Promise<{ cancelled?: boolean; meta?: unknown }> => ipcRenderer.invoke(IPC.library.uploadPack),
    deleteTexture: (id: string, reason?: string): Promise<boolean> => ipcRenderer.invoke(IPC.library.deleteTexture, id, reason),
    deletePack: (id: string, reason?: string): Promise<boolean> => ipcRenderer.invoke(IPC.library.deletePack, id, reason),
    getModerationLog: (): Promise<Array<{ id: string; type: string; deletedBy: string | null; reason: string; author: string; originalName: string; deletedAt: number }>> => ipcRenderer.invoke(IPC.library.getModerationLog),
    updateTextureTags: (id: string, tags: string[]): Promise<unknown> => ipcRenderer.invoke(IPC.library.updateTextureTags, id, tags),
    updatePackTags: (id: string, tags: string[]): Promise<unknown> => ipcRenderer.invoke(IPC.library.updatePackTags, id, tags),
    addToProject: (projectId: string, libraryId: string): Promise<{ ok: boolean; newId?: string }> =>
      ipcRenderer.invoke(IPC.library.addToProject, projectId, libraryId),
    getMyHandle: (): Promise<string | null> => ipcRenderer.invoke(IPC.library.getMyHandle),
    setMyHandle: (handle: string): Promise<string | null> => ipcRenderer.invoke(IPC.library.setMyHandle, handle),
    getAdmins: (): Promise<string[]> => ipcRenderer.invoke(IPC.library.getAdmins),
    addAdmin: (handle: string): Promise<string[]> => ipcRenderer.invoke(IPC.library.addAdmin, handle),
    removeAdmin: (handle: string): Promise<string[]> => ipcRenderer.invoke(IPC.library.removeAdmin, handle),
    isAdmin: (handle: string): Promise<boolean> => ipcRenderer.invoke(IPC.library.isAdmin, handle),
    getTextureDataUrl: (id: string): Promise<string | null> => ipcRenderer.invoke(IPC.library.getTextureDataUrl, id),
  },
  auth: {
    login: (): Promise<{ handle: string; token: string }> => ipcRenderer.invoke(IPC.auth.login),
    logout: (): Promise<void> => ipcRenderer.invoke(IPC.auth.logout),
    getHandle: (): Promise<string | null> => ipcRenderer.invoke(IPC.auth.getHandle),
    startDeviceFlow: (): Promise<{ device_code: string; user_code: string; verification_uri: string; verification_uri_complete?: string; expires_in: number; interval: number }> =>
      ipcRenderer.invoke(IPC.auth.startDeviceFlow),
    pollDeviceFlow: (deviceCode: string, interval?: number, expiresIn?: number): Promise<{ handle: string; token: string }> =>
      ipcRenderer.invoke(IPC.auth.pollDeviceFlow, deviceCode, interval, expiresIn),
  },
  community: {
    list: (opts?: { q?: string; tag?: string; type?: string }): Promise<{ textures: unknown[]; packs: unknown[] }> =>
      ipcRenderer.invoke(IPC.community.list, opts),
    uploadTexture: (): Promise<{ cancelled?: boolean; meta?: unknown }> => ipcRenderer.invoke(IPC.community.uploadTexture),
    uploadPack: (): Promise<{ cancelled?: boolean; meta?: unknown }> => ipcRenderer.invoke(IPC.community.uploadPack),
    deleteTexture: (id: string, reason?: string): Promise<boolean> => ipcRenderer.invoke(IPC.community.deleteTexture, id, reason),
    deletePack: (id: string, reason?: string): Promise<boolean> => ipcRenderer.invoke(IPC.community.deletePack, id, reason),
    getModeration: (): Promise<unknown[]> => ipcRenderer.invoke(IPC.community.getModeration),
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
