import { useEditorUi, setFadeStrength, setFadeSoftness } from '../store/editor';
import './AdvancedPanels.css';

export function FadePanel(): JSX.Element {
  const strength = useEditorUi((s) => s.fadeStrength);
  const softness = useEditorUi((s) => s.fadeSoftness);

  return (
    <div className="shade-panel">
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
          onChange={(e) => setFadeStrength(parseInt(e.target.value, 10))}
        />
      </div>
      <div className="slider-row">
        <label>
          <span>Softness</span>
          <span>{softness}%</span>
        </label>
        <input
          type="range"
          min={0}
          max={100}
          value={softness}
          onChange={(e) => setFadeSoftness(parseInt(e.target.value, 10))}
        />
      </div>
      <p style={{ fontSize: 10, color: 'var(--fg-3)', margin: 0, lineHeight: 1.4 }}>
        Soft eraser: click and drag to make pixels progressively more transparent. Higher strength erases faster; higher
        softness feathers the brush edge. Works as one undo stroke.
      </p>
    </div>
  );
}
