import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface Clip {
  pixels: Uint8ClampedArray; // length = w*h*4
  width: number;
  height: number;
}

interface ClipboardState {
  slots: Clip[];
  activeIndex: number;
  setSlots: (slots: Clip[]) => void;
  add: (clip: Clip) => void;
  removeAt: (index: number) => void;
  setActive: (index: number) => void;
  clear: () => void;
}

const MAX_SLOTS = 10;
const STORAGE_KEY = 'texture-editor:clipboard-v1';

export const useClipboard = create<ClipboardState>()(
  persist(
    immer((set) => ({
      slots: [],
      activeIndex: -1,
      setSlots: (slots) =>
        set((s) => {
          s.slots = slots;
          if (s.activeIndex >= slots.length) s.activeIndex = slots.length - 1;
        }),
      add: (clip) =>
        set((s) => {
          s.slots.unshift(clip);
          if (s.slots.length > MAX_SLOTS) s.slots.length = MAX_SLOTS;
          s.activeIndex = 0;
        }),
      removeAt: (index) =>
        set((s) => {
          s.slots.splice(index, 1);
          if (s.activeIndex >= s.slots.length) s.activeIndex = s.slots.length - 1;
        }),
      setActive: (index) =>
        set((s) => {
          s.activeIndex = index;
        }),
      clear: () =>
        set((s) => {
          s.slots = [];
          s.activeIndex = -1;
        }),
    })),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => {
        // Uint8ClampedArray doesn't survive JSON.stringify/roundtrip unchanged,
        // so we marshal to a plain Array before persisting.
        return {
          getItem: (name: string) => {
            const raw = localStorage.getItem(name);
            if (!raw) return null;
            try {
              const parsed = JSON.parse(raw) as { state?: { slots?: unknown[]; activeIndex?: number } };
              const slots = (parsed.state?.slots ?? []).map((slot: unknown) => {
                const s = slot as { pixels?: unknown; width: number; height: number };
                return {
                  pixels: new Uint8ClampedArray(s.pixels as number[] | Uint8Array),
                  width: s.width,
                  height: s.height,
                };
              });
              return JSON.stringify({ state: { slots, activeIndex: parsed.state?.activeIndex ?? -1 }, version: 0 });
            } catch {
              return null;
            }
          },
          setItem: (name: string, value: string) => {
            const parsed = JSON.parse(value) as { state: { slots: Clip[]; activeIndex: number }; version: number };
            const out = {
              state: {
                slots: parsed.state.slots.map((s) => ({
                  pixels: Array.from(s.pixels),
                  width: s.width,
                  height: s.height,
                })),
                activeIndex: parsed.state.activeIndex,
              },
              version: parsed.version,
            };
            localStorage.setItem(name, JSON.stringify(out));
          },
          removeItem: (name: string) => {
            localStorage.removeItem(name);
          },
        };
      }),
      partialize: (s) => ({ slots: s.slots, activeIndex: s.activeIndex }),
    },
  ),
);

