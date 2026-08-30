import { useState } from 'react';
import { useEditorUi, recordColor, setPrimaryColor, setSecondaryColor, setReplaceFrom, setReplaceTo } from '../store/editor';
import { useTranslate } from '../i18n';
import './AdvancedPanels.css';

export function RecentPalette(): JSX.Element {
  const t = useTranslate();
  const recent = useEditorUi((s) => s.recentColors);
  const activeTool = useEditorUi((s) => s.activeTool);
  const [expanded, setExpanded] = useState(false);

  // Collapsed: show the 10 most recent. Expanded: show the full history.
  const shown = expanded ? recent : recent.slice(0, 10);

  const applyColor = (hex: string, secondary: boolean): void => {
    // The Replace tool uses its own From/To colors instead of primary/secondary.
    if (activeTool === 'replace') {
      if (secondary) setReplaceTo(hex);
      else setReplaceFrom(hex);
    } else if (secondary) {
      setSecondaryColor(hex);
    } else {
      setPrimaryColor(hex);
    }
    recordColor(hex);
  };

  const body =
    shown.length === 0 ? (
      <div className="recent-empty">{t('recent.empty')}</div>
    ) : (
      <div className="recent-palette">
        {shown.map((c, i) => (
          <button
            key={i}
            type="button"
            className="recent-swatch"
            style={{ background: c }}
            title={t('recent.swatchTitle', {
              color: c,
              primary: activeTool === 'replace' ? t('recent.fromLabel') : t('recent.primaryLabel'),
              secondary: activeTool === 'replace' ? t('recent.toLabel') : t('recent.secondaryLabel'),
            })}
            onClick={() => applyColor(c, false)}
            onContextMenu={(e) => {
              e.preventDefault();
              applyColor(c, true);
            }}
          />
        ))}
      </div>
    );

  return (
    <div className="panel">
      <div className="panel-title-row">
        <h4 className="panel-title">{t('recent.title')}</h4>
        <button
          type="button"
          className="panel-toggle"
          onClick={() => setExpanded((v) => !v)}
          title={t('recent.collapseToggle')}
          aria-label={t('recent.collapseToggle')}
        >
          {expanded ? '▾' : '▸'}
        </button>
      </div>
      {body}
    </div>
  );
}
