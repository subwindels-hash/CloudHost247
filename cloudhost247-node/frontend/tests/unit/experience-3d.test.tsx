// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import Experience3D from '../../src/components/marketing/Experience3D';

/**
 * The homepage "3D Experience" is interactive, but its information must not depend on a mouse or
 * on WebGL. These tests pin the keyboard/AT contract: four real buttons with aria-pressed, a live
 * detail panel, and an ordinary link to a real internal route for whichever layer is selected.
 */
afterEach(cleanup);

function renderExperience() {
  return render(<MemoryRouter><Experience3D /></MemoryRouter>);
}

describe('Homepage 3D Experience', () => {
  it('renders the four 3D layers as the only accessible controls', () => {
    const { container } = renderExperience();

    const section = container.querySelector('section.hg-exp3d');
    expect(section).toBeTruthy();
    expect(section?.getAttribute('id')).toBe('experience-3d');
    expect(screen.getByRole('heading', { level: 2, name: /Explore the platform in three dimensions/ })).toBeTruthy();
    expect(container.querySelectorAll('.hg-exp3d__plane')).toHaveLength(4);
    expect(container.querySelectorAll('.hg-exp3d__control')).toHaveLength(0);

    const group = screen.getByRole('group', { name: /Choose a platform layer/ });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
    buttons.forEach((button) => {
      expect(button.classList.contains('hg-exp3d__plane')).toBe(true);
      expect(button.getAttribute('aria-controls')).toBe('hg-exp3d-detail');
    });
    ['Edge & DNS', 'Compute & Hosting', 'Cloud & Storage', 'Operations'].forEach((name) => {
      expect(screen.getAllByText(name)).toHaveLength(1);
    });
  });

  it('switches the live detail and destination when a layer is chosen', () => {
    const { container } = renderExperience();

    const detail = container.querySelector('#hg-exp3d-detail')!;
    expect(detail.getAttribute('aria-live')).toBe('polite');
    expect(within(detail as HTMLElement).getByText('Layer 01 · Details')).toBeTruthy();
    expect(within(detail as HTMLElement).getByRole('link').getAttribute('href')).toBe('/domains');

    fireEvent.click(screen.getByRole('button', { name: /Cloud & Storage/ }));

    expect(within(detail as HTMLElement).getByText('Layer 03 · Details')).toBeTruthy();
    expect(within(detail as HTMLElement).getByRole('link').getAttribute('href')).toBe('/cloud');
    expect(screen.getByRole('button', { name: /Cloud & Storage/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Edge & DNS/ }).getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelectorAll('.hg-exp3d__plane.is-active')).toHaveLength(1);
  });

  it('uses only internal destinations and never hides the detail from assistive tech', () => {
    const { container } = renderExperience();
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links.length).toBeGreaterThan(0);
    links.forEach((href) => expect(href?.startsWith('/')).toBe(true));
    expect(container.querySelector('.hg-exp3d__detail')?.hasAttribute('aria-hidden')).toBe(false);
  });
});
