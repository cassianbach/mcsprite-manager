declare module 'gifenc' {
  export interface GIFEncoderOptions {
    auto?: boolean;
    initialCapacity?: number;
    palette?: number[][];
  }

  export interface WriteFrameOptions {
    palette?: number[][];
    delay?: number;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    dispose?: number;
    first?: boolean;
  }

  export type GIFEncoderInstance = {
    writeFrame: (indices: Uint8Array, width: number, height: number, options?: WriteFrameOptions) => void;
    finish: () => void;
    reset: () => void;
    bytesView: () => Uint8Array;
    bytes: () => Uint8Array;
    writeHeader?: () => void;
    stream?: () => unknown;
    buffer?: Uint8Array;
  };

  export function GIFEncoder(opts?: GIFEncoderOptions): GIFEncoderInstance;

  export function quantize(
    rgba: Uint8ClampedArray | Uint8Array,
    maxColors: number,
    options?: {
      clearAlphaThreshold?: number;
      clearAlphaColor?: number;
      clearAlpha?: boolean;
      format?: 'rgb444' | 'rgb565' | 'rgba4444' | string;
      oneBitAlpha?: number | boolean;
    },
  ): number[][];

  export function applyPalette(
    rgba: Uint8ClampedArray | Uint8Array,
    palette: number[][],
    format?: 'rgb444' | 'rgb565' | 'rgba4444' | string,
  ): Uint8Array;

  export function nearestColorIndex(rgba: Uint8Array, palette: number[][]): number;

  export function nearestColor(palette: number[][], rgba: number[]): number;

  export function nearestColorIndexWithDistance(palette: number[][], rgba: number[]): [number, number];

  export function prequantize(
    rgba: Uint8ClampedArray | Uint8Array,
    palette: number[][],
    format?: string,
  ): Uint8Array;

  export function snapColorsToPalette(
    rgba: Uint8ClampedArray | Uint8Array,
    palette: number[][],
    format?: string,
  ): Uint8Array;
}
