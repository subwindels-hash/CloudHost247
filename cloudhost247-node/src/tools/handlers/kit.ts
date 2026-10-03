/**
 * Tools Center — shared helpers for the per-tool HTTP handlers.
 *
 * The route layer owns HTTP concerns (methods, prefixes, envelopes); these helpers own the small
 * amount of input parsing every handler needs. Parsing is strict and explicit: an unknown field is
 * ignored, but a wrongly typed or missing required field is a 422 `INVALID_INPUT`, never a silently
 * coerced value, because a diagnostic tool that quietly answers a different question than the one
 * the user asked is worse than an error.
 */
import type { FastifyRequest } from 'fastify';
import type { Env } from '../../config/env';
import type { Queryable } from '../../db/types';
import type { AuthenticatedRequestContext } from '../../lib/require-auth';
import type { EffectiveTool } from '../core/registry';
import type { ToolCaller } from '../core/executor';
import { invalidInput } from '../core/errors';

export type ToolInput = Record<string, unknown>;

export interface HandlerContext {
  db: Queryable;
  env: Env;
  tool: EffectiveTool;
  caller: ToolCaller;
  auth: AuthenticatedRequestContext | null;
  request: FastifyRequest;
}

export type ToolHandler = (input: ToolInput, context: HandlerContext) => Promise<unknown>;

export interface StringOptions {
  required?: boolean;
  min?: number;
  max?: number;
  /** Trim the value before validating (default true). */
  trim?: boolean;
}

function present(input: ToolInput, key: string): unknown {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && value.trim().length === 0) return undefined;
  return value;
}

export function str(input: ToolInput, key: string, options: StringOptions = {}): string {
  const value = present(input, key);
  if (value === undefined) {
    if (options.required) throw invalidInput(`"${key}" is required.`);
    return '';
  }
  if (typeof value !== 'string' && typeof value !== 'number') throw invalidInput(`"${key}" must be text.`);
  const text = options.trim === false ? String(value) : String(value).trim();
  if (options.min !== undefined && text.length < options.min) throw invalidInput(`"${key}" must be at least ${options.min} characters.`);
  if (options.max !== undefined && text.length > options.max) throw invalidInput(`"${key}" must be at most ${options.max} characters.`);
  return text;
}

export function maybeStr(input: ToolInput, key: string, options: StringOptions = {}): string | undefined {
  if (present(input, key) === undefined) return undefined;
  return str(input, key, options);
}

export function num(
  input: ToolInput,
  key: string,
  options: { required?: boolean; min?: number; max?: number; integer?: boolean; default?: number } = {}
): number {
  const value = present(input, key);
  if (value === undefined) {
    if (options.default !== undefined) return options.default;
    if (options.required) throw invalidInput(`"${key}" is required.`);
    throw invalidInput(`"${key}" is required.`);
  }
  const parsed = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(parsed)) throw invalidInput(`"${key}" must be a number.`);
  if (options.integer !== false && !Number.isInteger(parsed)) throw invalidInput(`"${key}" must be a whole number.`);
  if (options.min !== undefined && parsed < options.min) throw invalidInput(`"${key}" must be at least ${options.min}.`);
  if (options.max !== undefined && parsed > options.max) throw invalidInput(`"${key}" must be at most ${options.max}.`);
  return parsed;
}

export function maybeNum(
  input: ToolInput,
  key: string,
  options: { min?: number; max?: number; integer?: boolean } = {}
): number | undefined {
  if (present(input, key) === undefined) return undefined;
  return num(input, key, options);
}

export function bool(input: ToolInput, key: string, fallback = false): boolean {
  const value = present(input, key);
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  throw invalidInput(`"${key}" must be true or false.`);
}

export function maybeBool(input: ToolInput, key: string): boolean | undefined {
  if (present(input, key) === undefined) return undefined;
  return bool(input, key);
}

/**
 * Enum parsing. The generic is deliberately declared over the *array* (with a `const` type
 * parameter) rather than `readonly T[]`: with a contextual return type in play (an object literal
 * being built for a service call) TypeScript otherwise widens the return to `string` and the value
 * silently stops matching the service's union.
 */
export function oneOf<const T extends readonly string[]>(
  input: ToolInput,
  key: string,
  allowed: T,
  options: { required?: boolean; default?: T[number] } = {}
): T[number] {
  const value = present(input, key);
  if (value === undefined) {
    if (options.default !== undefined) return options.default;
    if (options.required) throw invalidInput(`"${key}" is required (one of: ${allowed.join(', ')}).`);
    return allowed[0] as T[number];
  }
  const text = String(value).trim();
  const found = allowed.find((option) => option.toLowerCase() === text.toLowerCase());
  if (!found) throw invalidInput(`"${key}" must be one of: ${allowed.join(', ')}.`);
  return found as T[number];
}

export function strArray(input: ToolInput, key: string, options: { max?: number } = {}): string[] | undefined {
  const value = present(input, key);
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : String(value).split(/[\s,;]+/);
  const cleaned = list.map((entry) => String(entry).trim()).filter(Boolean);
  if (options.max !== undefined && cleaned.length > options.max) throw invalidInput(`"${key}" accepts at most ${options.max} entries.`);
  return cleaned;
}

export function record(input: ToolInput, key: string): Record<string, unknown> | undefined {
  const value = present(input, key);
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw invalidInput(`"${key}" must be an object.`);
  return value as Record<string, unknown>;
}

/** A history/audit label: a hostname, IP or account name — never a URL with a query string. */
export function targetLabel(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > 200 ? `${trimmed.slice(0, 197)}…` : trimmed;
}

/** Normalises the `?refresh=true` style flag shared by every runnable tool. */
export function refreshRequested(input: ToolInput): boolean {
  return bool(input, 'refresh', false);
}
