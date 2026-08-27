import { useState } from 'react';
import { useEditorUi, setReplaceFrom, setReplaceTo, setReplaceTolerance, recordColor } from '../store/editor';
import { ColorPicker } from './ColorPicker';
import './AdvancedPanels.css';

interface Props {
  onApply: () => void;
}

export function ReplacePanel({ onApply }: Props): JSX.Element {
  const from = useEditorUi((s) => s.replaceFrom);
  const to = useEditorUi((s) => s.replaceTo);
  const tolerance = useEditorUi((s) => s.replaceTolerance);
  const [editing, setEditing] = useState<'from' | 'to'>('from');

  const value = editing === 'from' ? from : to;
  const set = editing === 'from' ? setReplaceFrom : setReplaceTo;

  return (
    <div className="shade-panel">
      <div className="replace-colors">
        <button
          type="button"
          className={'replace-swatch' + (editing === 'from' ? ' active' : '')}
          style={{ background: from }}
          onClick={() => setEditing('from')}
        >
          <span>From</span>
        </button>
        <button
          type="button"
          className={'replace-swatch' + (editing === 'to' ? ' active' : '')}
          style={{ background: to }}
          onClick={() => setEditing('to')}
        >
          <span>To</span>
        </button>
      </div>
      <ColorPicker
        value={value}
        onChange={set}
        onCommit={(hex) => {
          set(hex);
          recordColor(hex);
        }}
      />
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
        Replaces every pixel matching <b>From</b> (within tolerance, on all RGBA channels) with <b>To</b>. Click the canvas or press
        Apply to replace across the texture (or current selection).
      </p>
      <button className="btn" style={{ marginTop: 4 }} onClick={onApply}>
        Apply replace
      </button>
    </div>
  );
}
