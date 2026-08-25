import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { HistoryEntry, AnimationStrip, Frame } from '@shared/types';
import { copyRect, clearRect, pasteRect, transformPixels, type TransformOp } from '../lib/canvas';
import { useClipboard } from './clipboard';

const HISTORY_LIMIT = 50;

interface ActiveTexture {
  id: string;
  source: 'vanilla' | 'user' | 'imported';
  name: string;
  path: string;
  width: number;
  height: number;
  /** Original single-frame pixels (vanilla or first import). Used by Reset. */
  base: Uint8ClampedArray;
  /** Current frame's pixels (mirrors frames[currentFrameIndex].pixels for fast paint). */
  current: Uint8ClampedArray;
  /** Original frames for animation reset (parallel array to frames, taken at first paint). */
  baseFrames: Frame[];
  animation?: AnimationStrip;
  currentFrameIndex: number;
  modified: boolean;
  history: HistoryEntry[];
  redoStack: HistoryEntry[];
  /** Current rectangle selection (in pixel coords). null when no selection. */
  selection: { x: number; y: number; w: number; h: number } | null;
  /** Pixels saved at selection creation time so we can move the selection without losing the original. */
  selectionBackup: Uint8ClampedArray | null;
  /** Snapshot of the texture taken at the last successful Save (for "reset to last saved"). */
  savedSnapshot: {
    width: number;
    height: number;
    current: Uint8ClampedArray;
    frames: Frame[] | null;
  } | null;
}

interface SaveState {
  status: 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
}

interface ProjectStore {
  projectId: string | null;
  texture: ActiveTexture | null;
  save: SaveState;

  load: (projectId: string, tex: {
    textureId: string;
    source: 'vanilla' | 'user' | 'imported';
    name: string;
    path: string;
    width: number;
    height: number;
    pixels: Uint8ClampedArray;
    base: Uint8ClampedArray;
    modified: boolean;
    animation?: AnimationStrip;
  }) => void;
  close: () => void;

  /** Apply a single-edit op: snapshots the previous pixels + new pixels + dirty rect into history. */
  applyEdit: (next: Uint8ClampedArray, rect: { x: number; y: number; w: number; h: number }) => void;

  undo: () => void;
  redo: () => void;
  reset: () => void;

  setActivePixels: (pixels: Uint8ClampedArray) => void;
  /** Resize the active texture in place. Records history. */
  resize: (newPixels: Uint8ClampedArray, newWidth: number, newHeight: number) => void;
  /** Rename the active texture's display name + path. */
  rename: (newName: string) => void;

  /** Convert a static texture into a 1-frame animation. */
  animateStatic: () => void;

  // Animation actions
  addFrame: () => void;
  duplicateFrame: (index: number) => void;
  deleteFrame: (index: number) => void;
  setActiveFrame: (index: number) => void;
  setFrameTickDuration: (index: number, ticks: number) => void;
  setInterpolate: (interp: boolean) => void;
  setDefaultFrameTicks: (ticks: number) => void;

  // Selection actions
  setSelection: (rect: { x: number; y: number; w: number; h: number } | null) => void;
  moveSelection: (dx: number, dy: number) => void;
  selectAll: () => void;
  clearSelection: () => void;
  /** Delete the selected region (transparent) and store the deleted pixels in `selectionBackup` for paste. */
  cutSelection: () => void;
  /** Fill the selected region with transparent. */
  deleteSelectionRegion: () => void;
  /** Paste the active clipboard slot at the selection origin. If selection is null, paste at (0,0). */
  pasteAtSelection: () => void;

  saveNow: () => Promise<void>;

  /** Revert the texture to the snapshot taken at the last successful Save. */
  resetToSaved: () => void;
  /** Rotate / flip the whole texture (and every animation frame). Records history. */
  transform: (op: import('../lib/canvas').TransformOp) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useProject = create<ProjectStore>()(
  immer((set, get) => ({
    projectId: null,
    texture: null,
    save: { status: 'idle', lastSavedAt: null },

    load: (projectId, tex) => {
      const animation: AnimationStrip | undefined = tex.animation;
      const defaultTicks = animation?.defaultFrameTicks ?? 2;
      const startFrame = animation && animation.frames.length > 0 ? animation.frames[0] : null;
      const current = startFrame ? new Uint8ClampedArray(startFrame.pixels) : new Uint8ClampedArray(tex.pixels);
      const t: ActiveTexture = {
        id: tex.textureId,
        source: tex.source,
        name: tex.name,
        path: tex.path,
        width: tex.width,
        height: tex.height,
        base: new Uint8ClampedArray(tex.base),
        current,
        baseFrames: animation
          ? animation.frames.map((f) => ({ pixels: new Uint8ClampedArray(f.pixels), tickDuration: f.tickDuration }))
          : [{ pixels: new Uint8ClampedArray(tex.base), tickDuration: defaultTicks }],
        animation: animation
          ? {
              ...animation,
              ...(tex.animation?.frameList ? { frameList: tex.animation.frameList } : {}),
              ...(typeof tex.animation?.frameWidth === 'number' && tex.animation?.frameWidth > 0
                ? { frameWidth: tex.animation.frameWidth }
                : {}),
              ...(typeof tex.animation?.frameHeight === 'number' && tex.animation?.frameHeight > 0
                ? { frameHeight: tex.animation.frameHeight }
                : {}),
            }
          : undefined,
        currentFrameIndex: 0,
        modified: tex.modified,
        history: [],
        redoStack: [],
        selection: null,
        selectionBackup: null,
        savedSnapshot: null,
      };
      set((s) => {
        s.projectId = projectId;
        s.texture = t;
        s.save = { status: 'idle', lastSavedAt: null };
      });
    },

    close: () => {
      if (saveTimer) clearTimeout(saveTimer);
      set((s) => {
        s.projectId = null;
        s.texture = null;
        s.save = { status: 'idle', lastSavedAt: null };
      });
    },

    applyEdit: (next, rect) => {
      const t = get().texture;
      if (!t) return;
      const before = new Uint8ClampedArray(t.current);
      const entry: HistoryEntry = {
        before,
        after: new Uint8ClampedArray(next),
        rect,
        frameIndex: t.currentFrameIndex,
      };
      set((s) => {
        if (!s.texture) return;
        s.texture.history.push(entry);
        if (s.texture.history.length > HISTORY_LIMIT) s.texture.history.shift();
        s.texture.redoStack.length = 0;
        s.texture.current = new Uint8ClampedArray(next);
        // Write into the active frame too (if animated)
        if (s.texture.animation) {
          s.texture.animation.frames[s.texture.currentFrameIndex].pixels = new Uint8ClampedArray(next);
        }
        s.texture.modified = true;
        s.save = { status: 'dirty', lastSavedAt: s.save.lastSavedAt };
      });
      scheduleSave(get);
    },

    undo: () => {
      const t = get().texture;
      if (!t || t.history.length === 0) return;
      set((s) => {
        if (!s.texture) return;
        const last = s.texture.history.pop()!;
        s.texture.redoStack.push(last);
        // Switch to the frame the entry was on, in case user edited another frame mid-undo
        if (s.texture.animation && last.frameIndex !== s.texture.currentFrameIndex) {
          s.texture.currentFrameIndex = last.frameIndex;
          s.texture.current = new Uint8ClampedArray(
            s.texture.animation.frames[last.frameIndex].pixels,
          );
        } else {
          s.texture.current = new Uint8ClampedArray(last.before);
          if (s.texture.animation) {
            s.texture.animation.frames[s.texture.currentFrameIndex].pixels = new Uint8ClampedArray(last.before);
          }
        }
        s.texture.modified = s.texture.history.length > 0 || !framesMatchBase(s.texture);
        s.save = { status: 'dirty', lastSavedAt: s.save.lastSavedAt };
      });
      scheduleSave(get);
    },

    redo: () => {
      const t = get().texture;
      if (!t || t.redoStack.length === 0) return;
      set((s) => {
        if (!s.texture) return;
        const next = s.texture.redoStack.pop()!;
        s.texture.history.push(next);
        if (s.texture.animation && next.frameIndex !== s.texture.currentFrameIndex) {
          s.texture.currentFrameIndex = next.frameIndex;
          s.texture.current = new Uint8ClampedArray(
            s.texture.animation.frames[next.frameIndex].pixels,
          );
        } else {
          s.texture.current = new Uint8ClampedArray(next.after);
          if (s.texture.animation) {
            s.texture.animation.frames[s.texture.currentFrameIndex].pixels = new Uint8ClampedArray(next.after);
          }
        }
        s.texture.modified = !framesMatchBase(s.texture);
        s.save = { status: 'dirty', lastSavedAt: s.save.lastSavedAt };
      });
      scheduleSave(get);
    },

    reset: () => {
      const t = get().texture;
      if (!t) return;
      const fresh = new Uint8ClampedArray(t.base);
      const before = new Uint8ClampedArray(t.current);
      const entry: HistoryEntry = {
        before,
        after: new Uint8ClampedArray(fresh),
        rect: { x: 0, y: 0, w: t.width, h: t.height },
        frameIndex: t.currentFrameIndex,
      };
      set((s) => {
        if (!s.texture) return;
        s.texture.history.push(entry);
        if (s.texture.history.length > HISTORY_LIMIT) s.texture.history.shift();
        s.texture.redoStack.length = 0;
        s.texture.current = fresh;
        // Reset all frames back to their original
        if (s.texture.animation && s.texture.baseFrames.length > 0) {
          for (let i = 0; i < s.texture.animation.frames.length; i++) {
            const bf = s.texture.baseFrames[i];
            s.texture.animation.frames[i].pixels = new Uint8ClampedArray(
              bf ? bf.pixels : s.texture.base,
            );
          }
        }
        s.texture.modified = false;
        s.save = { status: 'dirty', lastSavedAt: s.save.lastSavedAt };
      });
      scheduleSave(get);
    },

    setActivePixels: (pixels) => {
      set((s) => {
        if (!s.texture) return;
        s.texture.current = new Uint8ClampedArray(pixels);
        if (s.texture.animation) {
          s.texture.animation.frames[s.texture.currentFrameIndex].pixels = new Uint8ClampedArray(pixels);
        }
      });
    },

    resize: (newPixels, newWidth, newHeight) => {
      const t = get().texture;
      if (!t) return;
      const before = new Uint8ClampedArray(t.current);
      const entry: HistoryEntry = {
        before,
        after: new Uint8ClampedArray(newPixels),
        rect: { x: 0, y: 0, w: t.width, h: t.height },
        frameIndex: t.currentFrameIndex,
      };
      set((s) => {
        if (!s.texture) return;
        s.texture.history.push(entry);
        if (s.texture.history.length > HISTORY_LIMIT) s.texture.history.shift();
        s.texture.redoStack.length = 0;
        s.texture.current = new Uint8ClampedArray(newPixels);
        s.texture.width = newWidth;
        s.texture.height = newHeight;
        if (s.texture.animation) {
          // Resize every frame using nearest-neighbor
          for (const f of s.texture.animation.frames) {
            const out = new Uint8ClampedArray(newWidth * newHeight * 4);
            for (let y = 0; y < newHeight; y++) {
              const sy = Math.min(f.pixels.length / (t.width * 4) - 1, Math.floor((y * t.height) / newHeight));
              for (let x = 0; x < newWidth; x++) {
                const sx = Math.min(t.width - 1, Math.floor((x * t.width) / newWidth));
                const si = (sy * t.width + sx) * 4;
                const di = (y * newWidth + x) * 4;
                out[di] = f.pixels[si];
                out[di + 1] = f.pixels[si + 1];
                out[di + 2] = f.pixels[si + 2];
                out[di + 3] = f.pixels[si + 3];
              }
            }
            f.pixels = out;
          }
        }
        s.texture.modified = true;
        s.save = { status: 'dirty', lastSavedAt: s.save.lastSavedAt };
      });
      scheduleSave(get);
    },

    rename: (newName) => {
      const trimmed = newName.trim();
      if (!trimmed) return;
      set((s) => {
        if (!s.texture) return;
        s.texture.name = trimmed;
        if (s.texture.path.startsWith('untitled_')) {
          s.texture.path = trimmed;
        }
      });
    },

    animateStatic: () => {
      const t = get().texture;
      if (!t) return;
      const defaultTicks = t.animation?.defaultFrameTicks ?? 2;
      set((s) => {
        if (!s.texture) return;
        // Snapshot current pixels as the first frame (or sole frame if not animated yet)
        const firstFramePixels = new Uint8ClampedArray(s.texture.current);
        s.texture.animation = {
          frames: [{ pixels: firstFramePixels, tickDuration: defaultTicks }],
          interpolate: false,
          defaultFrameTicks: defaultTicks,
        };
        s.texture.baseFrames = [{ pixels: new Uint8ClampedArray(s.texture.base), tickDuration: defaultTicks }];
        s.texture.currentFrameIndex = 0;
        s.texture.modified = true;
        s.save = { status: 'dirty', lastSavedAt: s.save.lastSavedAt };
      });
      scheduleSave(get);
    },

    addFrame: () => {
      const t = get().texture;
      if (!t) return;
      const defaultTicks = t.animation?.defaultFrameTicks ?? 2;
      set((s) => {
        if (!s.texture) return;
        // Frame pixels default to transparent (revealing what's behind in MC)
        const newFrame: Frame = {
          pixels: new Uint8ClampedArray(s.texture.width * s.texture.height * 4),
          tickDuration: defaultTicks,
        };
        if (!s.texture.animation) {
          // Wrap current into a single-frame animation
          const firstFrame: Frame = {
            pixels: new Uint8ClampedArray(s.texture.current),
            tickDuration: defaultTicks,
          };
          s.texture.animation = {
            frames: [firstFrame, newFrame],
            interpolate: false,
            defaultFrameTicks: defaultTicks,
          };
          s.texture.baseFrames = [firstFrame, newFrame].map((f) => ({
            pixels: new Uint8ClampedArray(f.pixels),
            tickDuration: f.tickDuration,
          }));
        } else {
          s.texture.animation.frames.push(newFrame);
          s.texture.baseFrames.push({
            pixels: new Uint8ClampedArray(newFrame.pixels),
            tickDuration: defaultTicks,
          });
        }
        s.texture.currentFrameIndex = s.texture.animation.frames.length - 1;
        s.texture.current = new Uint8ClampedArray(s.texture.animation.frames[s.texture.currentFrameIndex].pixels);
        s.texture.modified = true;
        s.save = { status: 'dirty', lastSavedAt: s.save.lastSavedAt };
      });
      scheduleSave(get);
    },

    duplicateFrame: (index) => {
      const t = get().texture;
      if (!t || !t.animation) return;
      set((s) => {
        if (!s.texture || !s.texture.animation) return;
        const src = s.texture.animation.frames[index];
        if (!src) return;
        const copy: Frame = {
          pixels: new Uint8ClampedArray(src.pixels),
          tickDuration: src.tickDuration,
        };
        s.texture.animation.frames.splice(index + 1, 0, copy);
        s.texture.baseFrames.splice(index + 1, 0, {
          pixels: new Uint8ClampedArray(copy.pixels),
          tickDuration: copy.tickDuration,
        });
        s.texture.currentFrameIndex = index + 1;
        s.texture.current = new Uint8ClampedArray(copy.pixels);
        s.texture.modified = true;
        s.save = { status: 'dirty', lastSavedAt: s.save.lastSavedAt };
      });
      scheduleSave(get);
    },

    deleteFrame: (index) => {
      const t = get().texture;
      if (!t || !t.animation) return;
      set((s) => {
        if (!s.texture || !s.texture.animation) return;
        if (s.texture.animation.frames.length <= 1) return; // keep at least one frame
        s.texture.animation.frames.splice(index, 1);
        if (s.texture.baseFrames.length > index) s.texture.baseFrames.splice(index, 1);
        const next = Math.max(0, Math.min(index, s.texture.animation.frames.length - 1));
        s.texture.currentFrameIndex = next;
        s.texture.current = new Uint8ClampedArray(s.texture.animation.frames[next].pixels);
        s.texture.modified = true;
        s.save = { status: 'dirty', lastSavedAt: s.save.lastSavedAt };
      });
      scheduleSave(get);
    },

    setActiveFrame: (index) => {
      const t = get().texture;
      if (!t || !t.animation) return;
      set((s) => {
        if (!s.texture || !s.texture.animation) return;
        const idx = Math.max(0, Math.min(index, s.texture.animation.frames.length - 1));
        s.texture.currentFrameIndex = idx;
        s.texture.current = new Uint8ClampedArray(s.texture.animation.frames[idx].pixels);
      });
    },

    setFrameTickDuration: (index, ticks) => {
      const t = get().texture;
      if (!t || !t.animation) return;
      set((s) => {
        if (!s.texture || !s.texture.animation) return;
        const f = s.texture.animation.frames[index];
        if (!f) return;
        f.tickDuration = Math.max(1, Math.min(1000, Math.round(ticks)));
      });
      scheduleSave(get);
    },

    setInterpolate: (interp) => {
      set((s) => {
        if (!s.texture || !s.texture.animation) return;
        s.texture.animation.interpolate = interp;
      });
      scheduleSave(get);
    },

    setDefaultFrameTicks: (ticks) => {
      set((s) => {
        if (!s.texture || !s.texture.animation) return;
        s.texture.animation.defaultFrameTicks = Math.max(1, Math.min(1000, Math.round(ticks)));
      });
      scheduleSave(get);
    },

    // ===== Selection actions =====

    setSelection: (rect) => {
      set((s) => {
        if (!s.texture) return;
        if (!rect) {
          s.texture.selection = null;
          s.texture.selectionBackup = null;
          return;
        }
        // Clamp to canvas
        const x = Math.max(0, Math.min(rect.x, s.texture.width - 1));
        const y = Math.max(0, Math.min(rect.y, s.texture.height - 1));
        const w = Math.max(1, Math.min(rect.w, s.texture.width - x));
        const h = Math.max(1, Math.min(rect.h, s.texture.height - y));
        s.texture.selection = { x, y, w, h };
        // Capture a fresh backup of the pixels inside the selection so move/transform is non-destructive.
        s.texture.selectionBackup = copyRect(
          s.texture.current,
          s.texture.width,
          x,
          y,
          w,
          h,
        );
      });
    },

    moveSelection: (dx, dy) => {
      const t = get().texture;
      if (!t || !t.selection) return;
      const x = Math.max(0, Math.min(t.selection.x + dx, t.width - t.selection.w));
      const y = Math.max(0, Math.min(t.selection.y + dy, t.height - t.selection.h));
      set((s) => {
        if (!s.texture || !s.texture.selection) return;
        s.texture.selection = { ...s.texture.selection, x, y };
      });
    },

    selectAll: () => {
      set((s) => {
        if (!s.texture) return;
        const w = s.texture.width;
        const h = s.texture.height;
        s.texture.selection = { x: 0, y: 0, w, h };
        s.texture.selectionBackup = new Uint8ClampedArray(s.texture.current);
      });
    },

    clearSelection: () => {
      set((s) => {
        if (!s.texture) return;
        s.texture.selection = null;
        s.texture.selectionBackup = null;
      });
    },

    cutSelection: () => {
      const t = get().texture;
      if (!t || !t.selection) return;
      const sel = t.selection;
      // Save selection pixels to clipboard, then clear the region.
      const pixels = new Uint8ClampedArray(t.current);
      const clip = copyRect(t.current, t.width, sel.x, sel.y, sel.w, sel.h);
      const rect = clearRect(pixels, t.width, sel.x, sel.y, sel.w, sel.h);
      get().applyEdit(pixels, rect);
      // Mirror to the active frame too (applyEdit already handles this, but clip stays around)
      useClipboard.getState().add({ pixels: clip, width: sel.w, height: sel.h });
      set((s) => {
        if (!s.texture || !s.texture.selection) return;
        s.texture.selection = null;
        s.texture.selectionBackup = null;
      });
    },

    deleteSelectionRegion: () => {
      const t = get().texture;
      if (!t || !t.selection) return;
      const pixels = new Uint8ClampedArray(t.current);
      const rect = clearRect(pixels, t.width, t.selection.x, t.selection.y, t.selection.w, t.selection.h);
      get().applyEdit(pixels, rect);
      set((s) => {
        if (!s.texture) return;
        s.texture.selection = null;
        s.texture.selectionBackup = null;
      });
    },

    pasteAtSelection: () => {
      const t = get().texture;
      if (!t) return;
      const active = useClipboard.getState().activeIndex;
      const clip = useClipboard.getState().slots[active];
      if (!clip) return;
      const dx = t.selection ? t.selection.x : 0;
      const dy = t.selection ? t.selection.y : 0;
      const pixels = new Uint8ClampedArray(t.current);
      const rect = pasteRect(pixels, t.width, t.height, clip.pixels, clip.width, clip.height, dx, dy);
      if (rect) get().applyEdit(pixels, rect);
    },

    resetToSaved: () => {
      const t = get().texture;
      if (!t || !t.savedSnapshot) return;
      const snap = t.savedSnapshot;
      const before = new Uint8ClampedArray(t.current);
      const after = new Uint8ClampedArray(snap.current);
      const entry: HistoryEntry = {
        before,
        after,
        rect: { x: 0, y: 0, w: t.width, h: t.height },
        frameIndex: t.currentFrameIndex,
      };
      set((s) => {
        if (!s.texture || !s.texture.savedSnapshot) return;
        const sn = s.texture.savedSnapshot;
        s.texture.history.push(entry);
        if (s.texture.history.length > HISTORY_LIMIT) s.texture.history.shift();
        s.texture.redoStack.length = 0;
        s.texture.width = sn.width;
        s.texture.height = sn.height;
        s.texture.current = new Uint8ClampedArray(sn.current);
        if (sn.frames && s.texture.animation && s.texture.animation.frames.length === sn.frames.length) {
          for (let i = 0; i < sn.frames.length; i++) {
            s.texture.animation.frames[i].pixels = new Uint8ClampedArray(sn.frames[i].pixels);
          }
          if (s.texture.currentFrameIndex >= s.texture.animation.frames.length) {
            s.texture.currentFrameIndex = s.texture.animation.frames.length - 1;
          }
          s.texture.current = new Uint8ClampedArray(
            s.texture.animation.frames[s.texture.currentFrameIndex].pixels,
          );
        }
        s.texture.modified = !framesMatchBase(s.texture);
        s.save = { status: 'dirty', lastSavedAt: s.save.lastSavedAt };
      });
      scheduleSave(get);
    },

    transform: (op) => {
      const t = get().texture;
      if (!t) return;
      const w = t.width;
      const h = t.height;
      const frames = t.animation ? t.animation.frames : [{ pixels: t.current, tickDuration: 0 }];
      const n = frames.length;
      const frameH = n > 1 ? Math.floor(h / n) : h;
      const transformed = frames.map((f) => transformPixels(f.pixels, w, frameH, op));
      let newW: number;
      let newH: number;
      if (op === 'rotate-cw' || op === 'rotate-ccw') {
        newW = frameH;
        newH = w * n;
      } else {
        newW = w;
        newH = h;
      }
      const strip = new Uint8ClampedArray(newW * newH * 4);
      let off = 0;
      for (const tf of transformed) {
        strip.set(tf.pixels, off);
        off += tf.pixels.length;
      }
      const before = new Uint8ClampedArray(t.current);
      const entry: HistoryEntry = {
        before,
        after: new Uint8ClampedArray(strip),
        rect: { x: 0, y: 0, w: t.width, h: t.height },
        frameIndex: t.currentFrameIndex,
      };
      set((s) => {
        if (!s.texture) return;
        s.texture.history.push(entry);
        if (s.texture.history.length > HISTORY_LIMIT) s.texture.history.shift();
        s.texture.redoStack.length = 0;
        s.texture.width = newW;
        s.texture.height = newH;
        s.texture.current = new Uint8ClampedArray(strip);
        if (s.texture.animation) {
          for (let i = 0; i < transformed.length; i++) {
            s.texture.animation.frames[i].pixels = new Uint8ClampedArray(transformed[i].pixels);
          }
          // active frame index unchanged (frames keep order); current points at the active slice
          const active = transformed[s.texture.currentFrameIndex] ?? transformed[0];
          s.texture.current = new Uint8ClampedArray(active.pixels);
        }
        s.texture.modified = true;
        s.save = { status: 'dirty', lastSavedAt: s.save.lastSavedAt };
      });
      scheduleSave(get);
    },

    saveNow: async () => {
      const { projectId, texture, save } = get();
      if (!projectId || !texture) return;
      if (save.status === 'saving') return;
      set((s) => {
        s.save.status = 'saving';
      });
      try {
        const frames = texture.animation
          ? texture.animation.frames.map((f) => f.pixels)
          : [texture.current];
        await window.api.textures.saveFull(projectId, texture.id, {
          width: texture.width,
          height: texture.height,
          frameCount: frames.length,
          frames,
          source: texture.source,
          path: texture.path,
          name: texture.name,
          animation: texture.animation
            ? {
                interpolate: texture.animation.interpolate,
                defaultFrameTicks: texture.animation.defaultFrameTicks,
                frameTime: texture.animation.frames.map((f) => f.tickDuration),
                ...(texture.animation.frameList ? { frameList: texture.animation.frameList } : {}),
                ...(typeof texture.animation.frameWidth === 'number' && texture.animation.frameWidth > 0
                  ? { frameWidth: texture.animation.frameWidth }
                  : {}),
                ...(typeof texture.animation.frameHeight === 'number' && texture.animation.frameHeight > 0
                  ? { frameHeight: texture.animation.frameHeight }
                  : {}),
              }
            : undefined,
        });
        set((s) => {
          s.save = { status: 'saved', lastSavedAt: Date.now() };
          if (s.texture) {
            const snapFrames = s.texture.animation
              ? s.texture.animation.frames.map((f) => ({
                  pixels: new Uint8ClampedArray(f.pixels),
                  tickDuration: f.tickDuration,
                }))
              : null;
            s.texture.savedSnapshot = {
              width: s.texture.width,
              height: s.texture.height,
              current: new Uint8ClampedArray(s.texture.current),
              frames: snapFrames,
            };
          }
        });
      } catch (err) {
        console.error('Save failed', err);
        set((s) => {
          s.save = { status: 'error', lastSavedAt: s.save.lastSavedAt };
        });
      }
    },
  })),
);

function scheduleSave(get: () => ProjectStore): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void get().saveNow();
  }, 800);
}

function pixelsEqual(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function framesMatchBase(t: ActiveTexture): boolean {
  if (t.animation) {
    if (t.animation.frames.length !== t.baseFrames.length) return false;
    for (let i = 0; i < t.animation.frames.length; i++) {
      if (!pixelsEqual(t.animation.frames[i].pixels, t.baseFrames[i].pixels)) return false;
    }
    return true;
  }
  return pixelsEqual(t.current, t.base);
}

export const canUndo = (): boolean => (useProject.getState().texture?.history.length ?? 0) > 0;
export const canRedo = (): boolean => (useProject.getState().texture?.redoStack.length ?? 0) > 0;
