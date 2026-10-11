/**
 * Schema-driven input validation for the Business Tools workspace.
 *
 * One validator serves all 21 tools: a tool declares its fields, and this module turns raw form
 * values into either a fully-typed `BusinessToolInput` or a list of field errors the workspace can
 * point at. Keeping validation here rather than inside each compute function means an engine can
 * assume its inputs are finite numbers and non-empty strings — which is what makes the arithmetic
 * in `calculators.ts` short enough to read and verify against the published statutory formulae.
 */

import {
  toBoolean,
  toNumber,
  toText,
} from './format';
import type {
  BusinessField,
  BusinessToolFailure,
  BusinessToolInput,
} from './types';

export interface ValidationResult {
  ok: boolean;
  values: BusinessToolInput;
  fieldErrors: Array<{ key: string; message: string }>;
}

const LABEL_REQUIRED = 'is required';

/** Validate and coerce one submission against a tool's declared fields. */
export function validateBusinessInput(
  fields: readonly BusinessField[],
  raw: Record<string, unknown>
): ValidationResult {
  const values: BusinessToolInput = {};
  const fieldErrors: Array<{ key: string; message: string }> = [];

  for (const field of fields) {
    const submitted = raw[field.key];

    switch (field.type) {
      case 'boolean': {
        values[field.key] = toBoolean(submitted ?? field.default ?? false);
        break;
      }

      case 'select': {
        const text = toText(submitted ?? field.default ?? '').trim();
        const options = field.options ?? [];
        if (text === '') {
          if (field.required) fieldErrors.push({ key: field.key, message: `${field.label} ${LABEL_REQUIRED}.` });
          const fallback = options.length > 0 ? options[0] : undefined;
          values[field.key] = fallback ? fallback.value : '';
          break;
        }
        const allowed = options.some((option) => option.value === text);
        if (!allowed) {
          fieldErrors.push({
            key: field.key,
            message: `${field.label} must be one of: ${options.map((option) => option.label).join(', ') || 'the listed options'}.`,
          });
          values[field.key] = text;
          break;
        }
        values[field.key] = text;
        break;
      }

      case 'date':
      case 'month': {
        const text = toText(submitted ?? field.default ?? '').trim();
        if (text === '') {
          if (field.required) fieldErrors.push({ key: field.key, message: `${field.label} ${LABEL_REQUIRED}.` });
          values[field.key] = '';
          break;
        }
        const pattern = field.type === 'date' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}$/;
        if (!pattern.test(text)) {
          fieldErrors.push({
            key: field.key,
            message: `${field.label} must use the ${field.type === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM'} format.`,
          });
          values[field.key] = text;
          break;
        }
        if (field.type === 'date') {
          const probe = new Date(text + 'T00:00:00Z');
          if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== text) {
            fieldErrors.push({ key: field.key, message: `${field.label} is not a real calendar date.` });
          }
        } else {
          const month = Number(text.slice(5, 7));
          if (month < 1 || month > 12) {
            fieldErrors.push({ key: field.key, message: `${field.label} has a month outside 01–12.` });
          }
        }
        values[field.key] = text;
        break;
      }

      case 'text':
      case 'textarea':
      case 'lines': {
        const text = toText(submitted ?? field.default ?? '');
        const trimmed = field.type === 'text' ? text.trim() : text;
        if (trimmed.trim() === '') {
          if (field.required) fieldErrors.push({ key: field.key, message: `${field.label} ${LABEL_REQUIRED}.` });
          values[field.key] = '';
          break;
        }
        if (field.maxLength && trimmed.length > field.maxLength) {
          fieldErrors.push({
            key: field.key,
            message: `${field.label} must be ${field.maxLength} characters or fewer (received ${trimmed.length}).`,
          });
        }
        values[field.key] = trimmed;
        break;
      }

      default: {
        // number | integer | percent | money
        const submittedText = toText(submitted).trim();
        if (submittedText === '') {
          if (field.required) {
            fieldErrors.push({ key: field.key, message: `${field.label} ${LABEL_REQUIRED}.` });
            values[field.key] = 0;
            break;
          }
          const fallback = toNumber(field.default);
          values[field.key] = fallback === null ? 0 : fallback;
          break;
        }
        const parsed = toNumber(submittedText);
        if (parsed === null) {
          fieldErrors.push({ key: field.key, message: `${field.label} must be a number.` });
          values[field.key] = 0;
          break;
        }
        if (field.min !== undefined && parsed < field.min) {
          fieldErrors.push({ key: field.key, message: `${field.label} must be at least ${field.min}.` });
        }
        if (field.max !== undefined && parsed > field.max) {
          fieldErrors.push({ key: field.key, message: `${field.label} must not exceed ${field.max}.` });
        }
        if (field.type === 'integer' && !Number.isInteger(parsed)) {
          fieldErrors.push({ key: field.key, message: `${field.label} must be a whole number.` });
        }
        values[field.key] = parsed;
        break;
      }
    }
  }

  return { ok: fieldErrors.length === 0, values, fieldErrors };
}

/** Wrap a compute function so schema validation always runs first. */
export function guard(
  fields: readonly BusinessField[],
  compute: (values: BusinessToolInput) => BusinessToolFailure | null | { result: import('./types').BusinessToolResult }
): (raw: Record<string, unknown>) => import('./types').BusinessToolOutcome {
  return (raw) => {
    const validation = validateBusinessInput(fields, raw);
    if (!validation.ok) {
      const first = validation.fieldErrors[0];
      return {
        ok: false,
        error: {
          message: first ? first.message : 'Some inputs need attention before this tool can run.',
          fieldErrors: validation.fieldErrors,
        },
      };
    }
    const outcome = compute(validation.values);
    if (outcome && 'result' in outcome) return { ok: true, result: outcome.result };
    if (outcome) return { ok: false, error: outcome };
    return {
      ok: false,
      error: { message: 'This tool could not produce a result from the values supplied.' },
    };
  };
}

/** Fail with one message plus optional per-field errors. */
export function failure(
  message: string,
  fieldErrors?: Array<{ key: string; message: string }>
): BusinessToolFailure {
  return fieldErrors && fieldErrors.length > 0 ? { message, fieldErrors } : { message };
}

/**
 * Fail with the *specific* problem as the headline, and the full list for per-field highlighting.
 *
 * A form that says "fix the highlighted fields" while the real reason — "the due date is before the
 * issue date" — sits in a list nobody reads is how a visitor gives up. The first field error is the
 * headline; the rest stay available to the workspace.
 */
export function fieldFailure(
  fieldErrors: Array<{ key: string; message: string }>,
  fallback: string
): BusinessToolFailure {
  const first = fieldErrors[0];
  return { message: first ? first.message : fallback, fieldErrors };
}
