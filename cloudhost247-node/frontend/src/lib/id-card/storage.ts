/**
 * Local-only persistence for the badge maker.
 *
 * The published promise on this page is that employee details and uploaded images stay in the
 * browser. This module is what makes that promise concrete and checkable:
 *
 *   - only `localStorage` is used; no request is made, so there is nothing to intercept;
 *   - the key is namespaced and versioned, so a future schema change cannot half-read old data;
 *   - photographs, signatures and the emergency-contact line are *not* written by default. They are
 *     the fields that turn a convenience feature into a store of biometric and next-of-kin data
 *     sitting in a shared-browser profile. They are kept in memory for the session unless the user
 *     explicitly opts in, and the opt-in is per-browser, not per-card.
 *   - "Clear stored data" removes the key outright.
 */

import type { CardFormState } from '../../../../src/tools/business/id-card';

const STORAGE_KEY = 'ch247.id-card.v1';
const IMAGE_CONSENT_KEY = 'ch247.id-card.images-consent.v1';

/** Fields that are never written to storage unless the user opts in. */
const SENSITIVE_FIELDS: Array<keyof CardFormState> = ['photo', 'signature', 'emergencyContact', 'phone', 'email'];

export interface StoredCard {
  version: 1;
  savedAt: string;
  state: Partial<CardFormState>;
}

export function storageAvailable(): boolean {
  try {
    const probe = 'ch247.probe';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function imagesConsented(): boolean {
  try {
    return window.localStorage.getItem(IMAGE_CONSENT_KEY) === 'yes';
  } catch {
    return false;
  }
}

export function setImagesConsent(consent: boolean): void {
  try {
    if (consent) window.localStorage.setItem(IMAGE_CONSENT_KEY, 'yes');
    else window.localStorage.removeItem(IMAGE_CONSENT_KEY);
  } catch {
    /* A blocked storage API is reported by `storageAvailable()`; there is nothing to recover here. */
  }
}

export interface SaveResult {
  saved: boolean;
  /** Fields deliberately left out of the saved copy. */
  omitted: string[];
  message: string;
}

/** Save the form. Text fields are always saved; sensitive fields only with consent. */
export function saveCard(state: CardFormState): SaveResult {
  if (!storageAvailable()) {
    return { saved: false, omitted: [], message: 'This browser has storage disabled, so your details cannot be kept between visits. Everything still works for this session.' };
  }
  const withImages = imagesConsented();
  const omitted: string[] = [];
  const copy: Partial<CardFormState> = {};
  for (const [key, value] of Object.entries(state) as Array<[keyof CardFormState, CardFormState[keyof CardFormState]]>) {
    if (!withImages && SENSITIVE_FIELDS.includes(key)) {
      if (typeof value === 'string' && value !== '') omitted.push(key);
      continue;
    }
    (copy as Record<string, CardFormState[keyof CardFormState]>)[key as string] = value;
  }
  const payload: StoredCard = { version: 1, savedAt: new Date().toISOString(), state: copy };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return {
      saved: true,
      omitted,
      message:
        omitted.length > 0
          ? `Saved locally, without ${omitted.join(', ')} — those fields are kept in memory only unless you allow storing uploaded images and contact details.`
          : 'Saved locally in this browser.',
    };
  } catch {
    return { saved: false, omitted, message: 'The saved card could not be written — this browser profile may be out of space.' };
  }
}

/** Read the saved form. Returns null when there is nothing valid to restore. */
export function loadCard(): { state: Partial<CardFormState>; savedAt: string } | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCard;
    if (!parsed || parsed.version !== 1 || typeof parsed.state !== 'object' || parsed.state === null) return null;
    return { state: parsed.state, savedAt: parsed.savedAt ?? '' };
  } catch {
    // A corrupt entry is removed rather than left to fail on every visit.
    clearCard();
    return null;
  }
}

/** Remove everything this tool has stored. Also removes images even if they were consented. */
export function clearCard(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(IMAGE_CONSENT_KEY);
  } catch {
    /* Nothing to do: if storage is blocked there is nothing stored. */
  }
}

/** Whether anything is stored, for the "clear" affordance to be honest about doing something. */
export function hasStoredCard(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}
