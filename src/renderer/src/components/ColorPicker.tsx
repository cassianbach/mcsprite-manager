import { useEffect, useRef, useState } from 'react';
import { hexToRgba, rgbaToHex } from '../lib/color';
import './ColorPicker.css';

interface Props {
  value: string; // hex
  onChange: (hex: string) => void;
  onCommit?: (hex: string) => void;
}

const RECENT_KEY = 'mcsprite-manager:recent-colors';
const MAX_RECENT = 16;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]): void {
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hh = (h % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh >= 0 && hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// Color-wheel radial mapping. Inner disc: hue × saturation (center → edge at
// the current brightness). The whole disc maps radius to saturation; there is
// no outer rim fade.
function wheelParams(d: number, val: number): { sat: number; v: number } {
  const dd = Math.min(1, Math.max(0, d));
  return { sat: dd, v: val };
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

export function ColorPicker({ value, onChange, onCommit }: Props): JSX.Element {
  const rgba = hexToRgba(value);
  const [h, s, v] = rgbToHsv(rgba.r, rgba.g, rgba.b);
  const [alpha, setAlpha] = useState(rgba.a);
  const [hue, setHue] = useState(h);
  const [sat, setSat] = useState(s);
  const [val, setVal] = useState(v);
  const [rad, setRad] = useState(Math.min(1, s));
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const [hexInput, setHexInput] = useState(value.replace(/^#/, '').toUpperCase());

  const wheelRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);

  // Sync incoming value → HSV when value changes from outside
  useEffect(() => {
    const r = hexToRgba(value);
    const [hh, ss, vv] = rgbToHsv(r.r, r.g, r.b);
    setHue(hh);
    setSat(ss);
    setVal(vv);
    setRad(Math.min(1, ss));
    setAlpha(r.a);
    setHexInput(value.replace(/^#/, '').toUpperCase());
  }, [value]);

  // Draw color wheel
  useEffect(() => {
    const cvs = wheelRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const size = cvs.width;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 1;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - cx) / radius;
        const dy = (y - cy) / radius;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const i = (y * size + x) * 4;
        if (dist > 1) {
          img.data[i + 3] = 0;
          continue;
        }
        const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
        const hh = (ang + 360) % 360;
        const { sat: ss, v } = wheelParams(dist, val);
        const [r, g, b] = hsvToRgb(hh, ss, v);
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [hue, val]);

  // Draw hue strip
  useEffect(() => {
    const cvs = stripRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const w = cvs.width;
    const h2 = cvs.height;
    const img = ctx.createImageData(w, h2);
    for (let x = 0; x < w; x++) {
      const [r, g, b] = hsvToRgb((x / w) * 360, 1, 1);
      for (let y = 0; y < h2; y++) {
        const i = (y * w + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, []);

  function applyColor(hh: number, ss: number, vv: number, aa: number): void {
    const [r, g, b] = hsvToRgb(hh, ss, vv);
    const hex = rgbaToHex({ r, g, b, a: aa });
    onChange(hex);
    onCommit?.(hex);
  }

  function handleWheel(e: React.MouseEvent<HTMLDivElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.min(1, Math.sqrt(dx * dx + dy * dy) / (rect.width / 2 - 1));
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const newHue = (ang + 360) % 360;
    const { sat: newSat, v: newVal } = wheelParams(dist, val);
    setRad(dist);
    setHue(newHue);
    setSat(newSat);
    setVal(newVal);
    applyColor(newHue, newSat, newVal, alpha);
  }

  function handleStrip(e: React.MouseEvent<HTMLDivElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const newHue = Math.max(0, Math.min(360, (x / rect.width) * 360));
    setHue(newHue);
    applyColor(newHue, sat, val, alpha);
  }

  function handleAlpha(e: React.MouseEvent<HTMLDivElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const newAlpha = Math.max(0, Math.min(255, Math.round((x / rect.width) * 255)));
    setAlpha(newAlpha);
    applyColor(hue, sat, val, newAlpha);
  }

  function handleBrightness(e: React.MouseEvent<HTMLDivElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const newVal = Math.max(0, Math.min(1, (x / rect.width)));
    setVal(newVal);
    applyColor(hue, sat, newVal, alpha);
  }

  function commitHex(input: string): void {
    let s = input.replace(/^#/, '');
    if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return;
    onCommit?.('#' + s);
  }

  function pushRecent(hex: string): void {
    setRecent((prev) => {
      const filtered = prev.filter((c) => c.toLowerCase() !== hex.toLowerCase());
      const next = [hex, ...filtered].slice(0, MAX_RECENT);
      saveRecent(next);
      return next;
    });
  }

  return (
    <div className="color-picker">
      <div
        className="color-wheel-wrap"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          handleWheel(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) handleWheel(e);
        }}
      >
        <canvas ref={wheelRef} className="color-wheel" width={220} height={220} />
        <div
          className="color-wheel-marker"
          style={{
            left: `${50 + Math.cos((hue * Math.PI) / 180) * rad * 50}%`,
            top: `${50 + Math.sin((hue * Math.PI) / 180) * rad * 50}%`,
          }}
          aria-hidden
        />
      </div>

      <div
        className="color-strip"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          handleStrip(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) handleStrip(e);
        }}
      >
        <canvas ref={stripRef} width={220} height={18} />
        <div
          className="color-strip-marker"
          style={{ left: `${(hue / 360) * 100}%` }}
          aria-hidden
        />
      </div>
      <div className="color-strip-label">
        <span>Hue</span>
        <span>{Math.round(hue)}°</span>
      </div>

      <div
        className="color-strip"
        style={{
          background: `linear-gradient(to right, #000000, rgb(${Math.round(hsvToRgb(hue, sat, 1)[0])}, ${Math.round(
            hsvToRgb(hue, sat, 1)[1],
          )}, ${Math.round(hsvToRgb(hue, sat, 1)[2])}))`,
        }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          handleBrightness(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) handleBrightness(e);
        }}
      >
        <div
          className="color-strip-marker"
          style={{ left: `${val * 100}%` }}
          aria-hidden
        />
      </div>
      <div className="color-strip-label">
        <span>Brightness</span>
        <span>{Math.round(val * 100)}%</span>
      </div>

      <div
        className="color-strip"
        style={{
          background: `linear-gradient(to right, rgba(${Math.round(hsvToRgb(hue, sat, val)[0])},${Math.round(
            hsvToRgb(hue, sat, val)[1],
          )},${Math.round(hsvToRgb(hue, sat, val)[2])},0), rgba(${Math.round(hsvToRgb(hue, sat, val)[0])},${Math.round(
            hsvToRgb(hue, sat, val)[1],
          )},${Math.round(hsvToRgb(hue, sat, val)[2])},1))`,
        }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          handleAlpha(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) handleAlpha(e);
        }}
      >
        <div
          className="color-strip-marker"
          style={{ left: `${(alpha / 255) * 100}%` }}
          aria-hidden
        />
      </div>
      <div className="color-strip-label">
        <span>Alpha</span>
        <span>{Math.round((alpha / 255) * 100)}%</span>
      </div>

      <div className="color-input-row">
        <input
          className="color-input"
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value.toUpperCase())}
          onBlur={(e) => commitHex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitHex((e.target as HTMLInputElement).value);
          }}
        />
        <button
          className="recent-swatch"
          style={{ background: value, width: 32, height: 32, borderRadius: 4 }}
          onClick={() => pushRecent(value)}
          title="Add to recent"
          aria-label="Add to recent"
        />
      </div>

      {recent.length > 0 && (
        <div className="recent-swatches">
          {recent.slice(0, 8).map((c, i) => (
            <button
              key={i}
              className="recent-swatch"
              style={{ background: c }}
              onClick={() => onCommit?.(c)}
              title={c}
            />
          ))}
        </div>
      )}
    </div>
  );
}
