import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppSettings } from '@shared/types';

const STORAGE_KEY = 'mcsprite-manager:settings';

export const useSettings = create<AppSettings>()(
  persist(
    (set) => ({
      theme: 'dark',
      activeMode: 'texture',
      activeProjectId: null,
      shortcuts: {},
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export const setTheme = (theme: AppSettings['theme']) => {
  useSettings.setState({ theme });
  document.documentElement.dataset.theme = theme;
};

export const setActiveMode = (mode: AppSettings['activeMode']) =>
  useSettings.setState({ activeMode: mode });

export const setActiveProject = (id: string | null) =>
  useSettings.setState({ activeProjectId: id });
