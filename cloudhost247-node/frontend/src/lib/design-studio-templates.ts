/**
 * Design Studio saved templates — SPA client.
 *
 * Saving is the only operation in Design Studio that keeps anything, and it needs an account: the row
 * has to live somewhere. This module therefore answers one question before it does anything else —
 * "is anyone signed in?" — and exposes that answer as `signedIn`, because a "Save template" button
 * that only ever produces a 401 is worse than a button that says "Sign in to save".
 *
 * What a saved template holds is decided by the studio that saves it, never silently here: the Label
 * Designer stores the template it was set up from plus the values currently typed, so reopening it
 * restores the working label rather than an empty form. The panel says so out loud, because a stored
 * address is the operator's decision to make, not a side effect.
 */
import { apiFetch, ApiRequestError } from './api';
import { getToken } from './auth';

export type TemplateKind = 'label' | 'shipping' | 'vda' | 'card';

/** A saved template without its document — what the picker lists. */
export interface TemplateSummary {
  id: string;
  kind: TemplateKind;
  name: string;
  summary: string;
  sourceTemplate: string | null;
  /** Increments on every overwrite; sent back so a stale save is refused instead of winning. */
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** A saved template with its document. */
export interface SavedTemplate extends TemplateSummary {
  document: Record<string, unknown>;
}

const BASE = '/api/tools/design-studio/templates';

/** True when a session token exists; the pages use it to decide what the save panel offers. */
export function signedIn(): boolean {
  return getToken() !== null;
}

function describe(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return 'The request failed.';
}

export interface TemplateResult<T> {
  ok: boolean;
  data?: T;
  /** The server's own message, shown verbatim: "You already have a label template called …" is advice. */
  error?: string;
  /** Set when the caller needs to sign in rather than fix anything. */
  needsAuth?: boolean;
  /** The HTTP status, so a caller can distinguish a 409 (recoverable) from a 400 (fix the input). */
  status?: number;
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<TemplateResult<T>> {
  if (!signedIn()) return { ok: false, needsAuth: true, error: 'Sign in to save templates — a template belongs to your account.' };
  try {
    const data = await apiFetch<T>(path, {
      method: init?.method ?? 'GET',
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      needsAuth: error instanceof ApiRequestError && error.status === 401,
      status: error instanceof ApiRequestError ? error.status : undefined,
      error: describe(error),
    };
  }
}

export const savedTemplates = {
  /** List the caller's templates, optionally for one studio. */
  list: (kind?: TemplateKind) => call<{ templates: TemplateSummary[]; count: number }>(kind ? `${BASE}?kind=${kind}` : BASE),

  /** Read one template, document included. */
  get: (id: string) => call<{ template: SavedTemplate }>(`${BASE}/${encodeURIComponent(id)}`),

  /** Save a new template. `document` is a layout, never a layout plus data. */
  create: (input: { kind: TemplateKind; name: string; summary?: string; document: Record<string, unknown>; sourceTemplate?: string }) =>
    call<{ template: SavedTemplate }>(BASE, { method: 'POST', body: input }),

  /**
   * Replace a template's contents, keeping its id.
   *
   * `expectedRevision` is required — by this type and by the API. The type exists so no call site can
   * forget it; the API requiring it means a caller that *did* forget gets a 400 rather than a write
   * that silently replaces whatever was there. There is no unconditional variant here on purpose: the
   * compatibility path in the API (`force: true`) exists for integrations we cannot change, and a
   * first-party client using it would be choosing the bug.
   */
  overwrite: (id: string, input: { document: Record<string, unknown>; summary?: string; expectedRevision: number }) =>
    call<{ template: SavedTemplate; warning?: string }>(`${BASE}/${encodeURIComponent(id)}`, { method: 'PUT', body: input }),

  /** Change the name (and/or description) of a template. Cannot touch its document. */
  rename: (id: string, input: { name?: string; summary?: string }) =>
    call<{ template: SavedTemplate }>(`${BASE}/${encodeURIComponent(id)}`, { method: 'PATCH', body: input }),

  duplicate: (id: string, name?: string) =>
    call<{ template: SavedTemplate }>(`${BASE}/${encodeURIComponent(id)}/duplicate`, { method: 'POST', body: name ? { name } : {} }),

  remove: (id: string) => call<{ deleted: boolean }>(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
