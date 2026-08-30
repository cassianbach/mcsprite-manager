import { useSettings } from '../store/settings';
import { TRANSLATIONS, type TranslationKey } from './translations';

export interface LanguageOption {
  code: string;
  label: string; // shown in the picker; intentionally NOT translated (native name)
}

/** Languages offered in the Settings → Language picker. Add new entries here AND
 * to TRANSLATIONS in translations.ts. */
export const LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
];

const FALLBACK = 'en';

/**
 * Resolve a translation key for the active language. Falls back to English
 * when the key is missing in the current language, so a partial translation
 * never breaks the UI.
 */
export function translate(lang: string | undefined, key: TranslationKey): string {
  const cur = (lang && TRANSLATIONS[lang]?.[key]) ?? TRANSLATIONS[FALLBACK]?.[key] ?? key;
  return cur;
}

/**
 * Hook returning a `t(key)` function bound to the current language setting.
 * Components re-render when the user changes the language because the hook
 * subscribes to `settings.language`.
 */
export function useTranslate(): (key: TranslationKey) => string {
  const lang = useSettings((s) => s.language ?? FALLBACK);
  return (key) => translate(lang, key);
}
