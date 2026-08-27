import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type ToolId =
  | 'pencil'
  | 'eraser'
  | 'fill'
  | 'eyedropper'
  | 'hand'
  | 'select'
  | 'shade'
  | 'stamp'
  | 'recolor'
  | 'gradient'
  | 'smush'
  | 'spray'
  | 'fade'
  | 'replace';

export type MirrorMode = 'none' | 'horizontal' | 'vertical' | 'quad';

export interface EditorUiState {
  activeTool: ToolId;
  brushSize: number;
  showGrid: boolean;
  zoom: number;
  primaryColor: string;
  secondaryColor: string;
  historyLimit: number;
  mirror: MirrorMode;
  gradientMode: 'curve' | 'rectangle' | 'point' | 'dots';
  gradientAngle: number; // 0..359 degrees
  gradientUseAngle: boolean; // fill by angle instead of start→finish
  gradientThickness: number; // stroke diameter for 'curve' mode (odd, 1..63)

  // Shade tool
  shadeMode: 'lighten' | 'darken' | 'tint' | 'fade';
  shadeStrength: number; // 1..100

  // Spray tool
  sprayDensity: number; // 1..100 (fraction of the brush area painted per pass)
  sprayFalloff: number; // 1..100 (edge softness; higher = more see-through toward the rim)
  sprayOpacity: number; // 1..100 (overall alpha of the spray)

  // Fade tool (soft eraser: reduces alpha progressively)
  fadeStrength: number; // 1..100 (alpha removed per pass, 0..255)
  fadeSoftness: number; // 0..100 (edge feather; higher = softer rim)

  // Replace tool (one color -> another, with tolerance)
  replaceFrom: string; // hex (with alpha)
  replaceTo: string; // hex (with alpha)
  replaceTolerance: number; // 0..255

  // Recolor (preview/apply)
  recolor: {
    hue: number;        // -180..180
    saturation: number; // -100..100
    brightness: number; // -100..100
    contrast: number;   // -100..100
    invert: boolean;
    grayscale: boolean;
  };
}

export const useEditorUi = create<EditorUiState>()(
  immer((set) => ({
    activeTool: 'pencil',
    brushSize: 1,
    showGrid: false,
    zoom: 8,
    primaryColor: '#ffffff',
    secondaryColor: '#000000',
    historyLimit: 50,
    mirror: 'none',
    gradientMode: 'curve',
    gradientAngle: 0,
    gradientUseAngle: false,
    gradientThickness: 5,
    shadeMode: 'lighten',
    shadeStrength: 25,
    sprayDensity: 30,
    sprayFalloff: 60,
    sprayOpacity: 100,
    fadeStrength: 35,
    fadeSoftness: 50,
    replaceFrom: '#ffffff',
    replaceTo: '#000000',
    replaceTolerance: 32,
    recolor: {
      hue: 0,
      saturation: 0,
      brightness: 0,
      contrast: 0,
      invert: false,
      grayscale: false,
    },
  })),
);

export const setTool = (tool: ToolId) =>
  useEditorUi.setState((s) => {
    s.activeTool = tool;
  });

export const setBrushSize = (n: number) =>
  useEditorUi.setState((s) => {
    s.brushSize = Math.max(1, Math.min(64, Math.round(n)));
  });

export const setShowGrid = (v: boolean) =>
  useEditorUi.setState((s) => {
    s.showGrid = v;
  });

export const setZoom = (z: number) =>
  useEditorUi.setState((s) => {
    s.zoom = Math.max(1, Math.min(64, z));
  });

export const zoomTo = (z: number) =>
  useEditorUi.setState((s) => {
    s.zoom = Math.max(1, Math.min(64, Math.round(z)));
  });

export const setPrimaryColor = (hex: string) =>
  useEditorUi.setState((s) => {
    s.primaryColor = hex;
  });

export const setSecondaryColor = (hex: string) =>
  useEditorUi.setState((s) => {
    s.secondaryColor = hex;
  });

export const setGradientMode = (mode: 'curve' | 'rectangle' | 'point' | 'dots') =>
  useEditorUi.setState((s) => {
    s.gradientMode = mode;
  });

export const setGradientUseAngle = (use: boolean) =>
  useEditorUi.setState((s) => {
    s.gradientUseAngle = use;
  });

export const setGradientAngle = (deg: number) =>
  useEditorUi.setState((s) => {
    s.gradientAngle = ((Math.round(deg) % 360) + 360) % 360;
  });

// Odd-only diameter (1,3,5,...) so a curve stroke has an exact center pixel and
// the value maps 1:1 to the visible stroke width (no silent rounding).
export const setGradientThickness = (n: number) =>
  useEditorUi.setState((s) => {
    let v = Math.round(n);
    if (v < 1) v = 1;
    if (v > 63) v = 63;
    if (v % 2 === 0) v += 1; // snap up to nearest odd
    s.gradientThickness = v;
  });

export const setMirror = (m: MirrorMode) =>
  useEditorUi.setState((s) => {
    s.mirror = m;
  });

export const cycleMirror = () =>
  useEditorUi.setState((s) => {
    s.mirror =
      s.mirror === 'none'
        ? 'horizontal'
        : s.mirror === 'horizontal'
          ? 'vertical'
          : s.mirror === 'vertical'
            ? 'quad'
            : 'none';
  });

export const setShadeMode = (mode: 'lighten' | 'darken' | 'tint' | 'fade') =>
  useEditorUi.setState((s) => {
    s.shadeMode = mode;
  });

export const setShadeStrength = (n: number) =>
  useEditorUi.setState((s) => {
    s.shadeStrength = Math.max(1, Math.min(100, Math.round(n)));
  });

export const setSprayDensity = (n: number) =>
  useEditorUi.setState((s) => {
    s.sprayDensity = Math.max(1, Math.min(100, Math.round(n)));
  });

export const setSprayFalloff = (n: number) =>
  useEditorUi.setState((s) => {
    s.sprayFalloff = Math.max(0, Math.min(100, Math.round(n)));
  });

export const setSprayOpacity = (n: number) =>
  useEditorUi.setState((s) => {
    s.sprayOpacity = Math.max(1, Math.min(100, Math.round(n)));
  });

export const setFadeStrength = (n: number) =>
  useEditorUi.setState((s) => {
    s.fadeStrength = Math.max(1, Math.min(100, Math.round(n)));
  });

export const setFadeSoftness = (n: number) =>
  useEditorUi.setState((s) => {
    s.fadeSoftness = Math.max(0, Math.min(100, Math.round(n)));
  });

export const setReplaceFrom = (hex: string) =>
  useEditorUi.setState((s) => {
    s.replaceFrom = hex;
  });

export const setReplaceTo = (hex: string) =>
  useEditorUi.setState((s) => {
    s.replaceTo = hex;
  });

export const setReplaceTolerance = (n: number) =>
  useEditorUi.setState((s) => {
    s.replaceTolerance = Math.max(0, Math.min(255, Math.round(n)));
  });

export const setRecolor = (next: Partial<EditorUiState['recolor']>) =>
  useEditorUi.setState((s) => {
    Object.assign(s.recolor, next);
  });

export const resetRecolor = () =>
  useEditorUi.setState((s) => {
    s.recolor = {
      hue: 0,
      saturation: 0,
      brightness: 0,
      contrast: 0,
      invert: false,
      grayscale: false,
    };
  });
