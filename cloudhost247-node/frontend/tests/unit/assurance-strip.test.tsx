// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import AssuranceStrip from '../../src/components/marketing/AssuranceStrip';

afterEach(cleanup);

/**
 * The strip is five operator-authored claims in a list. The test pins the copy (so a reword is a
 * deliberate edit, not a drive-by) and pins the shape (a plain list, no links or buttons, one
 * accessible name for the section) because the badges must not look — or behave — like buttons.
 */
it('lists the five service assurances as plain text in one labelled section', () => {
  render(<AssuranceStrip />);

  const section = screen.getByRole('region', { name: 'Included with every plan' });
  const items = screen.getAllByRole('listitem');
  expect(items).toHaveLength(5);
  expect(items.map((item) => item.textContent)).toEqual([
    'Free SSL Certificate',
    'Ultra Fast Performance',
    '99.9% Uptime Guarantee',
    '30-Day Money Back Guarantee',
    '24/7 Expert Support',
  ]);

  // Nothing in the strip is interactive: it is a statement, not a menu.
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  // Decorative glyphs must stay out of the accessibility tree, so the list reads as labels only.
  expect(section.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(5);
});
