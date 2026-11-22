import { z } from 'zod';

type Rec = Record<string, unknown>;
const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).refine((key) => !['constructor', 'prototype'].includes(key));
const stepSchema = z.object({
  agent_slug: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/),
  task_type: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9_.-]*$/),
  subject_from: identifier.optional(),
  subject_type: z.string().min(1).max(48).regex(/^[a-z][a-z0-9_-]*$/).optional(),
  customer_from: identifier.optional(),
  input: z.record(identifier, z.unknown()).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
}).strict().refine((step) => !step.subject_type || !!step.subject_from);
const definitionSchema = z.array(stepSchema).min(1).max(20).refine((steps) => new Set(steps.map((step) => step.agent_slug)).size === steps.length);
const uuid = z.string().uuid();
const placeholder = /^\{\{([A-Za-z][A-Za-z0-9_]{0,63})\}\}$/;
const maxBytes = 32_768;

export interface PreparedWorkflowStep {
  agent_slug: string;
  task_type: string;
  subject_type: string | null;
  subjectId: string | null;
  customerId: string | null;
  input: Rec;
  priority: 'low' | 'normal' | 'high' | 'urgent';
}

/**
 * Preflight the entire definition and its event-derived values before dispatching any step.
 * This validates structure and presence, not the truth, authorization or ownership of event data.
 */
export function prepareWorkflowSteps(definition: unknown, eventPayload: unknown): PreparedWorkflowStep[] {
  // Inspect raw keys before Zod's record parser can drop special properties such as __proto__.
  if (Array.isArray(definition)) {
    for (const raw of definition) {
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const input = (raw as Rec).input;
        if (input && typeof input === 'object' && !Array.isArray(input) &&
          Object.keys(input).some((key) => !identifier.safeParse(key).success)) throw new Error('Invalid workflow input');
      }
    }
  }
  const parsed = definitionSchema.safeParse(definition);
  if (!parsed.success || !eventPayload || typeof eventPayload !== 'object' || Array.isArray(eventPayload)) throw new Error('Invalid workflow input');
  const payload = eventPayload as Rec;
  const read = (key: string): unknown => {
    if (!identifier.safeParse(key).success || !Object.prototype.hasOwnProperty.call(payload, key) || payload[key] == null) throw new Error('Invalid workflow input');
    return payload[key];
  };
  const readUuid = (key: string | undefined): string | null => {
    if (!key) return null;
    const value = uuid.safeParse(read(key));
    if (!value.success) throw new Error('Invalid workflow input');
    return value.data;
  };
  return parsed.data.map((step) => {
    const entries = Object.entries(step.input ?? {});
    if (entries.length > 32) throw new Error('Invalid workflow input');
    const input: Rec = Object.create(null);
    for (const [key, value] of entries) {
      if (typeof value === 'string' && (value.includes('{{') || value.includes('}}'))) {
        const match = placeholder.exec(value);
        if (!match) throw new Error('Invalid workflow input');
        input[key] = read(match[1]!);
      } else {
        input[key] = value;
      }
    }
    // Nested templates are not supported. Reject them instead of forwarding an unresolved marker.
    // Inspect only literal template values; substituted event content is data, not a template.
    const stack = entries.map(([, value]) => ({ value, depth: 0 }));
    while (stack.length) {
      const item = stack.pop()!;
      if (item.depth > 8) throw new Error('Invalid workflow input');
      if (item.depth > 0 && typeof item.value === 'string' && (item.value.includes('{{') || item.value.includes('}}'))) throw new Error('Invalid workflow input');
      if (item.value && typeof item.value === 'object') {
        for (const child of Object.values(item.value)) stack.push({ value: child, depth: item.depth + 1 });
      }
    }
    const serialized = JSON.stringify(input);
    if (!serialized || Buffer.byteLength(serialized, 'utf8') > maxBytes) throw new Error('Invalid workflow input');
    return { agent_slug: step.agent_slug, task_type: step.task_type, subject_type: step.subject_type ?? null,
      subjectId: readUuid(step.subject_from), customerId: readUuid(step.customer_from), input, priority: step.priority ?? 'normal' };
  });
}
