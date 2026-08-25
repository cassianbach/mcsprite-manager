import { useEditorUi, setShadeMode, setShadeStrength } from '../store/editor';
import type { ShadeMode } from '../lib/canvas';
import './AdvancedPanels.css';

const MODES: { id: ShadeMode; label: string }[] = [
  { id: 'lighten', label: 'Lighten' },
  { id: 'darken', label: 'Darken' },
  { id: 'tint', label: 'Tint' },
  { id: 'fade', label: 'Fade' },
];

export function ShadePanel(): JSX.Element {
  const mode = useEditorUi((s) => s.shadeMode);
  const strength = useEditorUi((s) => s.shadeStrength);

  return (
    <div className="shade-panel">
      <div className="mode-row">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={'shade-mode' + (mode === m.id ? ' active' : '')}
            onClick={() => setShadeMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="slider-row">
        <label>
          <span>Strength</span>
          <span>{strength}%</span>
        </label>
        <input
          type="range"
          min={1}
          max={100}
          value={strength}
          onChange={(e) => setShadeStrength(parseInt(e.target.value, 10))}
        />
      </div>
      <p style={{ fontSize: 10, color: 'var(--fg-3)', margin: 0, lineHeight: 1.4 }}>
        Click and drag to apply. Tint uses the current primary color. Fade reduces alpha per pass
        (great for glass/ghost effects).
      </p>
    </div>
  );
}
