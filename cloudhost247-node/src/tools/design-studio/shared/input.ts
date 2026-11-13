/**
 * Input parsing for the Design Studio tools.
 *
 * The Tools Center's generic parsers name the JSON key in their messages (`"toName" is required`).
 * These tools are filled in by people printing labels, so the messages here name the field as the
 * form labels it, and they never repeat the value that was entered: an error message ends up in the
 * execution log, and an address or a phone number must not.
 */

import { invalidInput } from '../../core/errors';
import type { ToolInput } from '../../handlers/kit';
import { BarcodeError } from '../barcode/encoder';
import { ImpositionError } from './impose';

// Everything below U+0020 except tab and line feed, plus DEL. Carriage returns are folded first.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

export interface FieldRule {
  name: string;
  label: string;
  maxLength: number;
  required?: boolean;
  /** Keep line breaks. Blank lines are dropped and each line is trimmed. */
  multiline?: boolean;
  maxLines?: number;
}

export function fieldText(input: ToolInput, rule: FieldRule): string {
  const raw = input[rule.name];
  if (raw === undefined || raw === null) {
    if (rule.required) throw invalidInput(`${rule.label} is required.`);
    return '';
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') throw invalidInput(`${rule.label} must be text.`);
  const cleaned = String(raw).replace(/\r\n?/g, '\n').replace(CONTROL_CHARACTERS, '');
  const text = rule.multiline
    ? cleaned
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .filter((line) => line !== '')
        .join('\n')
    : cleaned.replace(/\s+/g, ' ').trim();
  if (text === '') {
    if (rule.required) throw invalidInput(`${rule.label} is required.`);
    return '';
  }
  if (text.length > rule.maxLength) throw invalidInput(`${rule.label} is limited to ${rule.maxLength} characters.`);
  if (rule.multiline && rule.maxLines !== undefined && text.split('\n').length > rule.maxLines) {
    throw invalidInput(`${rule.label} is limited to ${rule.maxLines} lines.`);
  }
  return text;
}

export function choiceOf<const T extends readonly string[]>(input: ToolInput, name: string, label: string, allowed: T, fallback: T[number]): T[number] {
  const raw = input[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const text = String(raw).trim();
  const found = allowed.find((option) => option.toLowerCase() === text.toLowerCase());
  if (found === undefined) throw invalidInput(`${label} must be one of: ${allowed.join(', ')}.`);
  return found as T[number];
}

export function wholeNumber(input: ToolInput, name: string, label: string, options: { min: number; max: number; fallback: number }): number {
  const raw = input[name];
  if (raw === undefined || raw === null || raw === '') return options.fallback;
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(value)) throw invalidInput(`${label} must be a whole number.`);
  if (value < options.min || value > options.max) throw invalidInput(`${label} must be between ${options.min} and ${options.max}.`);
  return value;
}

export function decimalNumber(input: ToolInput, name: string, label: string, options: { min: number; max: number }): number | undefined {
  const raw = input[name];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(',', '.'));
  if (!Number.isFinite(value)) throw invalidInput(`${label} must be a number.`);
  if (value < options.min || value > options.max) throw invalidInput(`${label} must be between ${options.min} and ${options.max}.`);
  return value;
}

export function flag(input: ToolInput, name: string, fallback = false): boolean {
  const raw = input[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'boolean') return raw;
  const text = String(raw).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  return fallback;
}

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

export function hexColour(input: ToolInput, name: string, label: string, fallback: string): string {
  const raw = input[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const text = String(raw).trim();
  if (!HEX_COLOUR.test(text)) throw invalidInput(`${label} must be a colour such as #1a2b3c.`);
  return text.toLowerCase();
}

/**
 * Add `by` to the last run of digits in a value, keeping its zero padding: `SN-0099` → `SN-0100`.
 * Returns null when the value contains no digits to count with.
 */
export function incrementTrailingNumber(value: string, by: number): string | null {
  const match = /^(.*?)(\d+)(\D*)$/s.exec(value);
  if (!match) return null;
  const [, head, digits, tail] = match as unknown as [string, string, string, string];
  const next = (BigInt(digits) + BigInt(by)).toString();
  return `${head}${next.padStart(digits.length, '0')}${tail}`;
}

/** Run a drawing step and turn the studio's own refusals into a 400 the form can show. */
export function refusable<T>(step: () => T): T {
  try {
    return step();
  } catch (error) {
    if (error instanceof BarcodeError) throw invalidInput(error.message, { reason: error.reason });
    if (error instanceof ImpositionError) throw invalidInput(error.message, { reason: error.reason });
    throw error;
  }
}
