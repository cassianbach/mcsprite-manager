import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppSettings, ThemeName, ThemeTokens } from '@shared/types';
import { PRESET_THEMES } from '../themes';

const STORAGE_KEY = 'mcsprite-manager:settings';

export const useSettings = create<AppSettings>()(
  persist(
    (set) => ({
      theme: 'dark',
      customTokens: {
        'bg-0': '#0b0d10',
        'bg-1': '#14181d',
        'bg-2': '#1d242c',
        'bg-3': '#262f38',
        'fg-0': '#f5f7fa',
        'fg-1': '#c9d1d9',
        'fg-2': '#7d8590',
        'fg-3': '#4a525c',
        line: '#232a32',
        'line-strong': '#313a44',
        accent: '#6cf0d6',
        'accent-fg': '#0b0d10',
        'accent-soft': 'rgba(108, 240, 214, 0.14)',
        danger: '#ff6b6b',
        warning: '#ffc857',
        info: '#6cb8f0',
      },
      backgroundImage: null,
      backgroundCrop: null,
      activeMode: 'texture',
      activeProjectId: null,
      shortcuts: {},
      language: 'en',
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

export const setCustomToken = (key: keyof ThemeTokens, value: string) => {
  useSettings.setState((s) => ({ customTokens: { ...s.customTokens, [key]: value }, theme: 'custom' }));
};

export const setBackgroundImage = (img: string | null) => {
  useSettings.setState({ backgroundImage: img });
};

export const setBackgroundCrop = (crop: AppSettings['backgroundCrop']) => {
  useSettings.setState({ backgroundCrop: crop });
};

/** Copy a preset's tokens into customTokens and switch to the custom theme for editing. */
export const customizeCurrentTheme = (name: ThemeName) => {
  if (name === 'custom') return;
  useSettings.setState({ customTokens: { ...PRESET_THEMES[name] }, theme: 'custom' });
};

export const setActiveMode = (mode: AppSettings['activeMode']) =>
  useSettings.setState({ activeMode: mode });

export const setActiveProject = (id: string | null) =>
  useSettings.setState({ activeProjectId: id });

export const setLanguage = (language: AppSettings['language']) =>
  useSettings.setState({ language });
