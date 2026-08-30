import { useRef, useState } from 'react';
import {
  useSettings,
  setTheme,
  setCustomToken,
  setBackgroundImage,
  setBackgroundCrop,
  setLanguage,
  customizeCurrentTheme,
} from '../store/settings';
import { THEME_LIST, TOKEN_FIELDS } from '../themes';
import { LANGUAGES, useTranslate } from '../i18n';
import './SettingsDialog.css';

type Rect = { x: number; y: number; w: number; h: number };

export function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const t = useTranslate();
  const theme = useSettings((s) => s.theme);
  const customTokens = useSettings((s) => s.customTokens);
  const backgroundImage = useSettings((s) => s.backgroundImage);
  const backgroundCrop = useSettings((s) => s.backgroundCrop);
  const language = useSettings((s) => s.language ?? 'en');
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [sel, setSel] = useState<Rect>(backgroundCrop ?? { x: 0, y: 0, w: 1, h: 1 });

  function onPickBg(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setBackgroundImage(reader.result as string);
      setBackgroundCrop(null);
      setSel({ x: 0, y: 0, w: 1, h: 1 });
    };
    reader.readAsDataURL(file);
  }

  function fracFromEvent(e: React.PointerEvent): { x: number; y: number } {
    const rect = imgRef.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return { x, y };
  }

  function onDown(e: React.PointerEvent): void {
    if (!backgroundImage) return;
    const f = fracFromEvent(e);
    dragStart.current = f;
    setSel({ x: f.x, y: f.y, w: 0, h: 0 });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onMove(e: React.PointerEvent): void {
    if (!dragStart.current) return;
    const f = fracFromEvent(e);
    const s = dragStart.current;
    const x = Math.min(s.x, f.x);
    const y = Math.min(s.y, f.y);
    const w = Math.abs(f.x - s.x);
    const h = Math.abs(f.y - s.y);
    setSel({ x, y, w, h });
  }

  function onUp(): void {
    if (!dragStart.current) return;
    dragStart.current = null;
    if (sel.w < 0.02 || sel.h < 0.02) {
      setSel({ x: 0, y: 0, w: 1, h: 1 });
      setBackgroundCrop(null);
    } else {
      setBackgroundCrop(sel);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>{t('settings.title')}</h3>
          <button className="btn" onClick={onClose}>
            {t('settings.close')}
          </button>
        </div>

        <section className="settings-section">
          <h4>{t('settings.section.theme')}</h4>
          <div className="settings-row">
            <select
              className="ie-select"
              value={theme}
              onChange={(e) => setTheme(e.target.value as typeof theme)}
            >
              {THEME_LIST.map((opt) => (
                <option key={opt.name} value={opt.name}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button className="btn" onClick={() => customizeCurrentTheme(theme)} disabled={theme === 'custom'}>
              {t('settings.theme.customize')}
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h4>{t('settings.section.language')}</h4>
          <div className="settings-row">
            <select
              className="ie-select"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <p className="settings-hint">{t('settings.language.hint')}</p>
        </section>

        <section className="settings-section">
          <h4>{t('settings.section.customColors')}</h4>
          <p className="settings-hint">{t('settings.colors.hint')}</p>
          <div className="settings-tokens">
            {TOKEN_FIELDS.map((f) => (
              <label key={f.key} className="settings-token">
                <input
                  type="color"
                  value={customTokens[f.key]}
                  onChange={(e) => setCustomToken(f.key, e.target.value)}
                />
                <span>{f.label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h4>{t('settings.section.background')}</h4>
          <p className="settings-hint">{t('settings.background.hint')}</p>
          <div className="settings-row">
            <button className="btn" onClick={() => fileRef.current?.click()}>
              {t('settings.background.choose')}
            </button>
            {backgroundImage && (
              <button className="btn" onClick={() => setBackgroundImage(null)}>
                {t('settings.background.remove')}
              </button>
            )}
            {backgroundImage && (
              <button
                className="btn"
                onClick={() => {
                  setBackgroundCrop(null);
                  setSel({ x: 0, y: 0, w: 1, h: 1 });
                }}
              >
                {t('settings.background.wholeImage')}
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickBg} />
          </div>
          {backgroundImage && (
            <div className="bg-crop">
              <img ref={imgRef} className="bg-crop-img" src={backgroundImage} alt="background to crop" />
              <div
                className="bg-crop-overlay"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
              >
                <div
                  className="bg-crop-sel"
                  style={{
                    left: `${sel.x * 100}%`,
                    top: `${sel.y * 100}%`,
                    width: `${sel.w * 100}%`,
                    height: `${sel.h * 100}%`,
                  }}
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
