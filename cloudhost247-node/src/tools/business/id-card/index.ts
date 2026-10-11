/**
 * Employee ID Card Generator — public surface.
 *
 * Everything here is isomorphic: the same modules run in the browser (preview, canvas exports, bulk
 * import) and in the API process (SVG export, validation, tests). Import from this file rather than
 * from the individual modules so the internal split stays free to change.
 */

export * from './types';
export * from './colors';
export * from './text';
export * from './code128';
export * from './qr';
export * from './templates';
export * from './expand';
export * from './svg';
export * from './raster';
export * from './pdf';
export * from './zip';
export * from './images';
export * from './model';
export * from './batch';
export { computeIdCardTool, formStateFromInput, defaultQrFor } from './tool';
