// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CreationScene from '../../src/components/marketing/CreationScene';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('keeps decorative 3D content out of the accessibility tree and pauses it off-screen', () => {
  let notify!: IntersectionObserverCallback;
  const observe = vi.fn();
  const disconnect = vi.fn();
  class Observer {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe = observe;
    disconnect = disconnect;
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  const { container, unmount } = render(<CreationScene />);
  const scene = container.querySelector('.creation-scene')!;
  expect(scene.getAttribute('aria-hidden')).toBe('true');
  expect(scene.querySelector('[data-tilt]')).toBeTruthy();
  expect(scene.querySelector('[data-parallax]')).toBeTruthy();
  expect(scene.querySelector('.creation-scene__browser')).toBeTruthy();
  expect(scene.querySelector('.creation-scene__phone')).toBeTruthy();
  expect(scene.classList.contains('is-visible')).toBe(false);
  expect(observe).toHaveBeenCalledWith(scene);
  notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  expect(scene.classList.contains('is-visible')).toBe(true);
  notify([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
  expect(scene.classList.contains('is-visible')).toBe(false);
  unmount();
  expect(disconnect).toHaveBeenCalled();
});

it('renders the static scene when IntersectionObserver is unavailable', () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  const { container } = render(<CreationScene />);
  expect(container.querySelector('.creation-scene__browser')).toBeTruthy();
  expect(container.querySelector('.creation-scene')?.classList.contains('is-visible')).toBe(false);
});
