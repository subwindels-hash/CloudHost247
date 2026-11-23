import type { ControlPanelSummary } from '../lib/control-panels-api';
import catalogue from '../../../shared/platform-catalog.json';

/** Single shared catalogue for the browser fallback and the paged server API. */
// JSON inference gives absent capability keys type `undefined`; each record's
// actual capabilities is a plain boolean map (as in the original typed literal).
export const PLATFORM_CATALOG: ControlPanelSummary[] = catalogue as unknown as ControlPanelSummary[];
