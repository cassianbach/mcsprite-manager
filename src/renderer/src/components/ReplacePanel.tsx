import { useEditorUi, setReplaceFrom, setReplaceTo, setReplaceTolerance } from '../store/editor';
import { ColorPicker } from './ColorPicker';
import './AdvancedPanels.css';

interface Props {
  onApply: () => void;
}

export function ReplacePanel({ onApply }: Props): JSX.Element {
  const from = useEditorUi((s) => s.replaceFrom);
  const to = useEditorUi((s) => s.replaceTo);
  const tolerance = useEditorUi((s) => s.replaceTolerance);

  return (
    <div className="shade-panel">
      <div className="replace-colors">
        <div className="replace-color">
          <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>From</span>
          <ColorPicker value={from} onChange={setReplaceFrom} onCommit={setReplaceFrom} />
        </div>
        <div className="replace-color">
          <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>To</span>
          <ColorPicker value={to} onChange={setReplaceTo} onCommit={setReplaceTo} />
        </div>
      </div>
      <div className="slider-row">
        <label>
          <span>Tolerance</span>
          <span>{tolerance}</span>
        </label>
        <input
          type="range"
          min={0}
          max={255}
          value={tolerance}
          onChange={(e) => setReplaceTolerance(parseInt(e.target.value, 10))}
        />
      </div>
      <p style={{ fontSize: 10, color: 'var(--fg-3)', margin: 0, lineHeight: 1.4 }}>
        Replaces every pixel matching <b>From</b> (within tolerance, on all RGBA channels) with <b>To</b>. Click the canvas or
        press Apply to replace across the texture (or current selection).
      </p>
      <button className="btn" style={{ marginTop: 4 }} onClick={onApply}>
        Apply replace
      </button>
    </div>
  );
}
