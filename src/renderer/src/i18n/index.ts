import { useSettings } from '../store/settings';
import {
  TRANSLATIONS,
  LABELS,
  type LabelKind,
  TRANSLATION_LANGS,
  type TranslationLang,
} from './translations';

/** Every translation key defined in the English (canonical) table. Missing
 * keys in any language fall back to English at runtime. */
export type TranslationKey = keyof typeof TRANSLATIONS.en;

export interface LanguageOption {
  code: TranslationLang;
  label: string; // shown in the picker; intentionally NOT translated (native name)
}

/** Languages offered in the Settings → Language picker. Add new entries here
 * AND a matching block in TRANSLATIONS in translations.ts. */
export const LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
];

const FALLBACK = 'en';

/**
 * Substitute `{key}` occurrences in a translation string with values from `params`.
 * Unknown keys are left as the literal token.
 */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_m, name) => {
    const v = params[name];
    return v === undefined ? `{${name}}` : String(v);
  });
}

/**
 * Resolve a translation key for the active language. Falls back to English
 * when the key is missing in the current language, so a partial translation
 * never breaks the UI. Supports `{key}` placeholders via the optional
 * `params` argument.
 */
export function translate(lang: string | undefined, key: TranslationKey, params?: Record<string, string | number>): string {
  const cur = (lang && TRANSLATIONS[lang]?.[key]) ?? TRANSLATIONS[FALLBACK]?.[key] ?? key;
  return interpolate(cur, params);
}

/**
 * Hook returning a `t(key, params?)` function bound to the current language
 * setting. Components re-render when the user changes the language because
 * the hook subscribes to `settings.language`.
 */
export function useTranslate(): (key: TranslationKey, params?: Record<string, string | number>) => string {
  const lang = useSettings((s) => s.language ?? FALLBACK);
  return (key, params) => translate(lang, key, params);
}

/**
 * Resolve a per-id label for data-driven items (themes, enchantments,
 * biomes, etc.). Uses the current language, falls back to English, then to
 * the provided `fallback` string. Keeps the English label as the data
 * default in source files — `LABELS` overrides at render time.
 *
 *   translateLabel('biome', 'plains', 'Plains')
 */
export function translateLabel(
  kind: LabelKind,
  id: string,
  fallback: string,
  langOverride?: string,
): string {
  const lang = langOverride ?? useSettings.getState().language ?? FALLBACK;
  const table = LABELS[kind];
  if (!table) return fallback;
  const entry = table[lang]?.[id] ?? table[FALLBACK]?.[id] ?? fallback;
  return entry;
}

/**
 * Like `translateLabel` but takes a `lang` explicitly (for use in non-React
 * contexts like data files). Returns the id→label lookup or the fallback.
 */
export function translateLabelWith(lang: string | undefined, kind: LabelKind, id: string, fallback: string): string {
  const table = LABELS[kind];
  if (!table) return fallback;
  return table[lang ?? FALLBACK]?.[id] ?? table[FALLBACK]?.[id] ?? fallback;
}

// Re-export for convenience.
export { TRANSLATIONS, LABELS, TRANSLATION_LANGS };
export type { LabelKind, TranslationLang };
