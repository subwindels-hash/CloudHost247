// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';
import AssistantShowcase from '../../src/components/marketing/AssistantShowcase';

afterEach(cleanup);

it('has one active feature and switches every feature without navigation', () => {
  render(<MemoryRouter><AssistantShowcase /></MemoryRouter>);
  const labels = ['Speed it up', 'Migrate', 'Fix', 'Manage', 'Edit'];
  const buttons = labels.map(name => screen.getByRole('button', { name }));
  expect(buttons.map(button => button.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false']);
  for (const button of buttons) {
    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(buttons.filter(b => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    expect(button.getAttribute('aria-describedby')).toBeTruthy();
  }
  const section = screen.getByRole('region', { name: /More confidence at every step/ });
  expect(within(section).getByRole('link', { name: /Learn more/ }).getAttribute('href')).toBe('/account/assistant');
  expect(within(section).getByText(/Illustrative examples/)).toBeTruthy();
});
