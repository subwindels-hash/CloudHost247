/**
 * Tools Center — handler for the Barcode Scanner's API: an uploaded PNG in, the barcode read from
 * it out. The scanner page itself decodes in the browser and does not call this.
 */
import { scanImage } from '../scanner/scan-image';
import type { ToolHandler } from './kit';
import { str } from './kit';

export const scannerHandlers: Record<string, ToolHandler> = {
  'barcode-scanner': async (input) => scanImage({ image: str(input, 'image', { required: true, max: 12 * 1024 * 1024, trim: false }) }),
};

/** A scan has no target worth recording: what a barcode holds is the caller's business. */
export const scannerTargets: Record<string, (input: Record<string, unknown>) => string | null> = {
  'barcode-scanner': () => null,
};
