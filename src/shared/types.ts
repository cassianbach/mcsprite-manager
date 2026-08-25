export type ProjectKind = 'mc' | 'sprite' | 'mixed';

export interface Project {
  id: string;
  name: string;
  description: string;
  kind: ProjectKind;
  mcVersion?: string;
  packFormat?: number;
  /** Storage root, set by main when the project is created. */
  dir: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectListEntry {
  id: string;
  name: string;
  kind: ProjectKind;
  mcVersion?: string;
  textureCount: number;
  modifiedCount: number;
  updatedAt: number;
  thumbnailDataUrl?: string;
}

export type TextureSource = 'vanilla' | 'user' | 'imported';

export interface HistoryEntry {
  /** ImageData snapshot before the change (cloned). */
  before: Uint8ClampedArray;
  /** ImageData snapshot after the change (cloned). */
  after: Uint8ClampedArray;
  /** Dirty rect in texture pixel coords. */
  rect: { x: number; y: number; w: number; h: number };
  /** Frame index affected. */
  frameIndex: number;
}

export interface Frame {
  pixels: Uint8ClampedArray; // length = width*height*4
  tickDuration: number;       // 1 = 50ms in MC
}

export interface AnimationStrip {
  frames: Frame[];
  interpolate: boolean;
  defaultFrameTicks: number;
  /** Optional display sequence (indices into `frames`); mirrors a Minecraft mcmeta `frames` array. */
  frameList?: number[];
  /** Non-square frame dimensions from the source mcmeta (MC animation `width`/`height`). */
  frameWidth?: number;
  frameHeight?: number;
}

export interface Texture {
  id: string;
  source: TextureSource;
  name: string;
  path: string;          // MC-style path, e.g. "block/grass_block_top" or relative sprite path
  width: number;
  height: number;
  base: Uint8ClampedArray;   // vanilla/original snapshot (length = w*h*4)
  current: Uint8ClampedArray;
  animation?: AnimationStrip;
  modified: boolean;
  history: HistoryEntry[];
  redoStack: HistoryEntry[];
  collaborators?: string[];
}

export interface AppSettings {
  theme: 'dark' | 'light';
  activeMode: 'texture' | 'sprite';
  activeProjectId: string | null;
  shortcuts: Record<string, string>;
}

/** Persisted animation metadata (mirrors a Minecraft *.mcmeta animation block). */
export interface McAnimationMeta {
  interpolate: boolean;
  /** Ticks per frame when no per-frame list is given. 1 tick = 50ms in MC. */
  defaultFrameTicks: number;
  /** Per-frame tick durations, length = frameCount (the actual strip frame count). */
  frameTime: number[];
  /** Optional display sequence (repeats allowed); mirrors a Minecraft mcmeta `frames` array. */
  frameList?: number[];
  /** Non-square frame dimensions (MC animation `width`/`height`). */
  frameWidth?: number;
  frameHeight?: number;
}

/** Lightweight texture descriptor (no pixel data). */
export interface TextureMetaInfo {
  source: 'vanilla' | 'user' | 'imported';
  path: string;
  name: string;
  width: number;
  height: number;
  frameCount: number;
  frameHeight: number;
  animation?: McAnimationMeta;
}

export interface TextureDetailed extends TextureMetaInfo {
  id: string;
}

/** A texture discovered inside an imported resource-pack zip. */
export interface ImportTexturePreview {
  /** MC-style path, e.g. "block/grass_block_top". */
  path: string;
  name: string;
  width: number;
  frameHeight: number;
  frameCount: number;
  hasAnimation: boolean;
  sizeBytes: number;
  /** True when a texture with the same path already exists in the target project. */
  exists: boolean;
  existingSource?: 'vanilla' | 'user' | 'imported';
}

export type ImportAction = 'import' | 'skip' | 'overwrite' | 'rename';

export interface ImportSelection {
  /** Original path inside the zip. */
  path: string;
  action: ImportAction;
  /** Target path when action === 'rename'. */
  targetPath?: string;
  /** Manual frame height (px) for vertical animation strips. Overrides auto-detect. */
  frameHeight?: number;
  /** Gap (px) between frames in the strip. Used with frameHeight to crop a clean strip. */
  gapHeight?: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  /** Ids of newly added/overwritten textures. */
  ids: string[];
}

export interface ExportResult {
  ok: boolean;
  cancelled?: boolean;
  path?: string;
  textureCount: number;
}

export interface ImportZipOpenResult {
  cancelled?: boolean;
  sessionId?: string;
  previews?: ImportTexturePreview[];
}

export interface AddTextureResult {
  cancelled?: boolean;
  id?: string;
  name?: string;
  path?: string;
}

export interface CollabHostInfo {
  port: number;
  host: string;
  room: string;
  url: string;
  link: string;
  /** When set, the session uses an external relay server (cross-network) instead
   *  of a locally-hosted one (LAN). The invite link carries this URL. */
  relay?: string;
}

export interface Peer {
  clientId: number;
  name: string;
  color: string;
  cursor: { x: number; y: number; textureId: string } | null;
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateInfo {
  status: UpdateStatus;
  version?: string;
  percent?: number;
  error?: string;
}

/** Minimal texture payload shared over the collab Y.Doc so peers can create/switch. */
export interface CollabTextureSync {
  id: string;
  source: TextureSource;
  name: string;
  path: string;
  width: number;
  height: number;
  /** Original (reset) pixels of the current frame. */
  base: Uint8Array;
  /** Current pixels of the active frame. */
  current: Uint8Array;
  modified: boolean;
  animated: boolean;
  defaultFrameTicks: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  activeMode: 'texture',
  activeProjectId: null,
  shortcuts: {},
};

export const IPC = {
  settings: {
    get: 'settings:get',
    set: 'settings:set',
  },
  projects: {
    list: 'projects:list',
    create: 'projects:create',
    delete: 'projects:delete',
    open: 'projects:open',
    rename: 'projects:rename',
  },
  textures: {
    list: 'textures:list',
    load: 'textures:load',
    save: 'textures:save',
    savePixels: 'textures:savePixels',
    saveFull: 'textures:saveFull',
    readVanillaIndex: 'textures:readVanillaIndex',
    readVanillaPng: 'textures:readVanillaPng',
    addVanilla: 'textures:addVanilla',
    delete: 'textures:delete',
  },
  window: {
    minimize: 'window:minimize',
    maximize: 'window:maximize',
    close: 'window:close',
    isMaximized: 'window:isMaximized',
  },
  theme: {
    set: 'theme:set',
    onSystemThemeChange: 'theme:onSystemThemeChange',
  },
  io: {
    exportZip: 'io:exportZip',
    exportPng: 'io:exportPng',
    exportList: 'io:exportList',
    importZipOpen: 'io:importZipOpen',
    importZipApply: 'io:importZipApply',
    importPng: 'io:importPng',
  },
  collab: {
    start: 'collab:start',
    stop: 'collab:stop',
  },
  update: {
    check: 'update:check',
    install: 'update:install',
    onStatus: 'update:onStatus',
  },
} as const;
