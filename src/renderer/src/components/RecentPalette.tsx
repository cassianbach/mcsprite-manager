import { useState } from 'react';
import { useEditorUi, recordColor, setPrimaryColor, setSecondaryColor, setReplaceFrom, setReplaceTo } from '../store/editor';
import './AdvancedPanels.css';

export function RecentPalette(): JSX.Element {
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
      <div className="recent-empty">No colors yet — pick, eyedrop, or paint a color to start.</div>
    ) : (
      <div className="recent-palette">
        {shown.map((c, i) => (
          <button
            key={i}
            type="button"
            className="recent-swatch"
            style={{ background: c }}
            title={`${c} — click: ${activeTool === 'replace' ? 'From' : 'primary'}, right-click: ${
              activeTool === 'replace' ? 'To' : 'secondary'
            }`}
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
        <h4 className="panel-title">Recent colors</h4>
        <button
          type="button"
          className="panel-toggle"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Show only 10' : 'Show all colors'}
          aria-label={expanded ? 'Show only 10' : 'Show all colors'}
        >
          {expanded ? '▾' : '▸'}
        </button>
      </div>
      {body}
    </div>
  );
}
