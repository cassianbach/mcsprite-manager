import {
  useEditorUi,
  setShapeType,
  setShapeFill,
  setShapeStroke,
  setShapeRotation,
} from '../store/editor';
import type { ShapeType } from '../store/editor';
import './AdvancedPanels.css';

const SHAPES: { id: ShapeType; label: string }[] = [
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'line', label: 'Line' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'polygon', label: 'Polygon' },
  { id: 'star', label: 'Star' },
];

export function ShapePanel(): JSX.Element {
  const shapeType = useEditorUi((s) => s.shapeType);
  const fill = useEditorUi((s) => s.shapeFill);
  const stroke = useEditorUi((s) => s.shapeStroke);
  const rotation = useEditorUi((s) => s.shapeRotation);

  return (
    <div className="shade-panel">
      <div className="field">
        <label>Shape</label>
        <div className="seg">
          {SHAPES.map((s) => (
            <button
              key={s.id}
              className={'seg-btn' + (shapeType === s.id ? ' active' : '')}
              onClick={() => setShapeType(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="seg" style={{ marginBottom: 8 }}>
        <button className={'seg-btn' + (fill ? ' active' : '')} onClick={() => setShapeFill(true)}>
          Filled
        </button>
        <button className={'seg-btn' + (!fill ? ' active' : '')} onClick={() => setShapeFill(false)}>
          Outline
        </button>
      </div>

      {shapeType !== 'line' && (
        <div className="slider-row">
          <label>
            <span>{fill ? 'Edge thickness' : 'Thickness'}</span>
            <span>{stroke}px</span>
          </label>
          <input
            type="range"
            min={1}
            max={32}
            value={stroke}
            onChange={(e) => setShapeStroke(parseInt(e.target.value, 10))}
          />
        </div>
      )}

      {shapeType !== 'line' && (
        <div className="slider-row">
          <label>
            <span>Rotation</span>
            <span>{rotation}°</span>
          </label>
          <input
            type="range"
            min={0}
            max={359}
            value={rotation}
            onChange={(e) => setShapeRotation(parseInt(e.target.value, 10))}
          />
        </div>
      )}

      <p style={{ fontSize: 10, color: 'var(--fg-3)', margin: 0, lineHeight: 1.4 }}>
        Drag on the canvas to draw the shape with the current primary color. Shift+click or use a colored secondary for mirrored corners is not applied to shapes.
      </p>
    </div>
  );
}
