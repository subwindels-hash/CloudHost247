import { describe, expect, it } from 'vitest';
import { assertRuntimeMemoryAllowed } from '../../src/ai-os/runtime/memory-policy';
import type { MemoryScope, TaskRow } from '../../src/ai-os/types';

const scopes: MemoryScope[] = ['short', 'customer', 'operational', 'organizational', 'executive'];
const task = (requested_by_type: TaskRow['requested_by_type'], customer_id: string | null) => ({ requested_by_type, customer_id });

describe('runtime memory safety boundary', () => {
  it('denies every scope to customer and customer-attributed tasks', () => {
    for (const scope of scopes) {
      expect(() => assertRuntimeMemoryAllowed(task('customer', 'customer-id'), scope)).toThrow();
      expect(() => assertRuntimeMemoryAllowed(task('customer', null), scope)).toThrow();
      expect(() => assertRuntimeMemoryAllowed(task('staff', 'customer-id'), scope)).toThrow();
    }
  });
  it('denies customer memory for internal tasks but retains internal non-customer scopes', () => {
    const internal = task('staff', null);
    expect(() => assertRuntimeMemoryAllowed(internal, 'customer')).toThrow();
    for (const scope of scopes.filter((value) => value !== 'customer')) {
      expect(() => assertRuntimeMemoryAllowed(internal, scope)).not.toThrow();
    }
  });
});
