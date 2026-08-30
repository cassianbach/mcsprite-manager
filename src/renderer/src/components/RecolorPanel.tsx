import { useEffect, useRef, useMemo } from 'react';
import { useEditorUi, setRecolor, resetRecolor } from '../store/editor';
import { useProject } from '../store/project';
import { recolorPixels } from '../lib/canvas';
import { Button } from './Button';
import { useTranslate } from '../i18n';
import './AdvancedPanels.css';

interface Props {
  onApply: () => void;
}

export function RecolorPanel({ onApply }: Props): JSX.Element {
  const t = useTranslate();
  const recolor = useEditorUi((s) => s.recolor);
  const texture = useProject((s) => s.texture);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const previewDataUrl = useMemo(() => {
    if (!texture) return null;
    const out = recolorPixels(texture.current, texture.width, texture.height, recolor);
    // Render to an offscreen canvas, encode as data URL
    const c = document.createElement('canvas');
    c.width = texture.width;
    c.height = texture.height;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(out), texture.width, texture.height), 0, 0);
    return c.toDataURL();
  }, [texture, recolor]);

  useEffect(() => {
    void previewRef;
  }, [previewDataUrl]);

  if (!texture) return <p style={{ fontSize: 11, color: 'var(--fg-3)', margin: 0 }}>{t('recolor.noTexture')}</p>;

  const isDirty =
    recolor.hue !== 0 ||
    recolor.saturation !== 0 ||
    recolor.brightness !== 0 ||
    recolor.contrast !== 0 ||
    recolor.invert ||
    recolor.grayscale;

  return (
    <div className="recolor-panel">
      <div className="slider-row">
        <label>
          <span>{t('recolor.hue')}</span>
          <span>{t('recolor.hueValue', { n: recolor.hue })}</span>
        </label>
        <input
          type="range"
          min={-180}
          max={180}
          value={recolor.hue}
          onChange={(e) => setRecolor({ hue: parseInt(e.target.value, 10) })}
        />
        <input
          type="number"
          min={-180}
          max={180}
          value={recolor.hue}
          onChange={(e) => setRecolor({ hue: parseInt(e.target.value, 10) || 0 })}
        />
      </div>
      <div className="slider-row">
        <label>
          <span>{t('recolor.saturation')}</span>
          <span>{t('recolor.saturationValue', { n: recolor.saturation })}</span>
        </label>
        <input
          type="range"
          min={-100}
          max={100}
          value={recolor.saturation}
          onChange={(e) => setRecolor({ saturation: parseInt(e.target.value, 10) })}
        />
        <input
          type="number"
          min={-100}
          max={100}
          value={recolor.saturation}
          onChange={(e) => setRecolor({ saturation: parseInt(e.target.value, 10) || 0 })}
        />
      </div>
      <div className="slider-row">
        <label>
          <span>{t('recolor.brightness')}</span>
          <span>{t('recolor.brightnessValue', { n: recolor.brightness })}</span>
        </label>
        <input
          type="range"
          min={-100}
          max={100}
          value={recolor.brightness}
          onChange={(e) => setRecolor({ brightness: parseInt(e.target.value, 10) })}
        />
        <input
          type="number"
          min={-100}
          max={100}
          value={recolor.brightness}
          onChange={(e) => setRecolor({ brightness: parseInt(e.target.value, 10) || 0 })}
        />
      </div>
      <div className="slider-row">
        <label>
          <span>{t('recolor.contrast')}</span>
          <span>{t('recolor.contrastValue', { n: recolor.contrast })}</span>
        </label>
        <input
          type="range"
          min={-100}
          max={100}
          value={recolor.contrast}
          onChange={(e) => setRecolor({ contrast: parseInt(e.target.value, 10) })}
        />
        <input
          type="number"
          min={-100}
          max={100}
          value={recolor.contrast}
          onChange={(e) => setRecolor({ contrast: parseInt(e.target.value, 10) || 0 })}
        />
      </div>

      <div className="recolor-toggles">
        <button
          className={'recolor-toggle' + (recolor.invert ? ' active' : '')}
          onClick={() => setRecolor({ invert: !recolor.invert })}
        >
          {t('recolor.invert')}
        </button>
        <button
          className={'recolor-toggle' + (recolor.grayscale ? ' active' : '')}
          onClick={() => setRecolor({ grayscale: !recolor.grayscale })}
        >
          {t('recolor.grayscale')}
        </button>
      </div>

      {previewDataUrl && (
        <img
          src={previewDataUrl}
          alt="recolor preview"
          className="recolor-preview"
          style={{ width: Math.min(96, texture.width * 4), height: Math.min(96, texture.height * 4) }}
        />
      )}

      <div className="apply-row">
        <Button variant="ghost" onClick={resetRecolor} disabled={!isDirty}>
          {t('recolor.reset')}
        </Button>
        <Button variant="primary" onClick={onApply} disabled={!isDirty}>
          {t('recolor.apply')}
        </Button>
      </div>
    </div>
  );
}
