import { configure } from '@testing-library/react';
import { vi } from 'vitest';

/**
 * Shared test setup.
 *
 * One thing is configured here, and it is a timing change rather than a behavioural one:
 * Testing Library's default 1 second ceiling for `findBy*` queries is shorter than the *cold*
 * module graph of this application takes to transform and evaluate under Vite in a test worker.
 * The first test in a file that renders `<App />` was failing on that cold start while every
 * subsequent test in the same file passed, which is a measurement of the test runner's first
 * transform pass, not of the component.
 *
 * Four seconds is still short enough that a genuine failure to render shows up as a failure
 * rather than a hang.
 */
configure({ asyncUtilTimeout: 4000, testIdAttribute: 'data-testid' });

// jsdom has no layout engine, so `matchMedia` must be stubbed for the responsive code paths.
// Server-render tests run in the plain Node environment, where there is no window at all.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
