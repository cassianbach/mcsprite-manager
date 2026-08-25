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
  | 'smush';

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
  gradientMode: 'curve' | 'rectangle';

  // Shade tool
  shadeMode: 'lighten' | 'darken' | 'tint' | 'fade';
  shadeStrength: number; // 1..100

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
    shadeMode: 'lighten',
    shadeStrength: 25,
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

export const setGradientMode = (mode: 'curve' | 'rectangle') =>
  useEditorUi.setState((s) => {
    s.gradientMode = mode;
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
