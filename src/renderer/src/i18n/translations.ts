// Minimal UI translation tables. English (en) is the base / fallback language.
// Add new languages by adding an entry below and a matching label in
// src/renderer/src/i18n/index.ts (LANGUAGES).
// Missing keys fall back to the English string at runtime, so adding a new
// language never breaks the UI — it just shows English where untranslated.

export type TranslationKey =
  | 'settings.title'
  | 'settings.close'
  | 'settings.section.theme'
  | 'settings.section.customColors'
  | 'settings.section.background'
  | 'settings.section.language'
  | 'settings.theme.customize'
  | 'settings.theme.hint'
  | 'settings.colors.hint'
  | 'settings.background.hint'
  | 'settings.background.choose'
  | 'settings.background.remove'
  | 'settings.background.wholeImage'
  | 'settings.background.empty'
  | 'settings.language.hint';

export const TRANSLATIONS: Record<string, Partial<Record<TranslationKey, string>>> = {
  en: {
    'settings.title': 'Settings',
    'settings.close': 'Close',
    'settings.section.theme': 'Theme',
    'settings.section.customColors': 'Custom colors',
    'settings.section.background': 'Background image',
    'settings.section.language': 'Language',
    'settings.theme.customize': 'Customize this theme',
    'settings.theme.hint':
      'Editing a color switches to the Custom theme. Changing the preset above resets these.',
    'settings.colors.hint':
      'Pick a color for each token. Changes are saved automatically.',
    'settings.background.hint':
      'Drag on the preview to select the part of the picture to use. Shown behind everything except the sidebars.',
    'settings.background.choose': 'Choose image…',
    'settings.background.remove': 'Remove',
    'settings.background.wholeImage': 'Whole image',
    'settings.background.empty': 'No background image set.',
    'settings.language.hint':
      'Switches the UI language. Currently only a few strings are translated; untranslated text falls back to English.',
  },
  de: {
    'settings.title': 'Einstellungen',
    'settings.close': 'Schließen',
    'settings.section.theme': 'Design',
    'settings.section.customColors': 'Eigene Farben',
    'settings.section.background': 'Hintergrundbild',
    'settings.section.language': 'Sprache',
    'settings.theme.customize': 'Dieses Design anpassen',
    'settings.theme.hint':
      'Eine Farbe zu ändern schaltet auf das Eigene Design um. Das Design oben zu wechseln setzt diese zurück.',
    'settings.colors.hint':
      'Wähle eine Farbe für jeden Token. Änderungen werden automatisch gespeichert.',
    'settings.background.hint':
      'Ziehe auf der Vorschau, um den Bildausschnitt zu wählen. Wird hinter allem außer den Seitenleisten angezeigt.',
    'settings.background.choose': 'Bild wählen…',
    'settings.background.remove': 'Entfernen',
    'settings.background.wholeImage': 'Ganzes Bild',
    'settings.background.empty': 'Kein Hintergrundbild gesetzt.',
    'settings.language.hint':
      'Wechselt die Oberflächensprache. Derzeit sind nur wenige Texte übersetzt; nicht übersetzte Texte fallen auf Englisch zurück.',
  },
};
