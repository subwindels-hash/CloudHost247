declare module 'gifenc' {
  export type GifColor = readonly [number, number, number] | readonly [number, number, number, number];
  export type GifPalette = readonly GifColor[];
  export type GifPixelFormat = 'rgb565' | 'rgb444' | 'rgba4444';

  export interface GifEncoder {
    writeFrame(indexedPixels: Uint8Array, width: number, height: number, options?: {
      palette?: GifPalette;
      delay?: number;
      repeat?: number;
      transparent?: boolean;
      transparentIndex?: number;
      dispose?: number;
    }): void;
    finish(): void;
    bytes(): Uint8Array;
  }

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GifEncoder;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: {
    format?: GifPixelFormat;
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }): GifPalette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: GifPalette, format?: GifPixelFormat): Uint8Array;
}
