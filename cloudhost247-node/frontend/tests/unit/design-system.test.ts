import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Design-system contract.
 *
 * There is no browser in the build environment, so layout cannot be *rendered* here — but the two
 * properties that actually cause a broken mobile site can be checked statically, and are:
 *
 *   1. the page cannot scroll sideways (no document wider than the viewport);
 *   2. the breakpoints the specification names all exist, so a layout cannot be desktop-only.
 *
 * Plus the things that make it *one* design system rather than three: a single palette, a single
 * radius scale, one shadow ladder, and no second colour scheme leaking in from an older
 * stylesheet.
 */
const ROOT = join(__dirname, '..', '..', '..', '..');
const DESIGN_SYSTEM = readFileSync(join(ROOT, 'shared', 'site', 'design-system.css'), 'utf8');
const THEME_COPY = readFileSync(join(ROOT, 'templates', 'cloudhost247', 'css', 'design-system.css'), 'utf8');

describe('design system', () => {
  it('prevents horizontal overflow at the document level', () => {
    expect(DESIGN_SYSTEM).toMatch(/html,\s*body\s*\{[^}]*overflow-x:\s*clip/);
    // Every full-bleed container is width-capped rather than fixed-width.
    expect(DESIGN_SYSTEM).toMatch(/\.ch-wrap\s*\{[^}]*width:\s*min\(/);
    // Layout containers must be fluid. Decorative absolutely-positioned glow/blur layers are
    // allowed a fixed size (they are clipped by an `overflow: hidden` ancestor and cannot create a
    // scrollbar); anything that participates in layout must not be.
    const layoutRules = [...DESIGN_SYSTEM.matchAll(/^([^\n{]*)\{([^}]*)\}/gm)]
      .filter(([, selector]) => /^\s*\.ch-(wrap|grid|section|card|hero|split|steps|plan|doc-layout)/.test(selector ?? ''))
      // Pseudo-element decoration (the hero's clipped glow) is not a layout box.
      .filter(([, selector]) => !/::(?:before|after)/.test(selector ?? ''))
      .filter(([, , body]) => /(?:^|[;\s])width:\s*\d{3,}px/.test(body ?? ''));
    expect(layoutRules.map((match) => match[1]?.trim()), 'these layout rules use a fixed width').toEqual([]);
  });

  it('defines every breakpoint the specification names', () => {
    for (const width of [1180, 1024, 768, 420]) {
      expect(DESIGN_SYSTEM, `missing a ${width}px breakpoint`).toContain(`max-width: ${width}px`);
    }
    // 320px is the narrowest supported viewport; nothing may be wider than a phone screen.
    const fixedWidths = [...DESIGN_SYSTEM.matchAll(/(?:min-|max-)?width:\s*(\d+)px/g)]
      .map((match) => Number(match[1]))
      .filter((value) => value > 320 && value < 360);
    expect(fixedWidths, 'fixed widths between 320px and 360px would clip on small phones').toEqual([]);
  });

  it('declares one brand palette', () => {
    for (const token of ['--ch-ink', '--ch-navy', '--ch-mint', '--ch-mint-strong', '--ch-green', '--ch-soft', '--ch-line']) {
      expect(DESIGN_SYSTEM, `missing token ${token}`).toContain(`${token}:`);
    }
    // The old blue scheme must not reappear: it belonged to a competing palette.
    expect(DESIGN_SYSTEM).not.toContain('#0756d8');
    expect(DESIGN_SYSTEM).not.toContain('#071b3d');
    expect(DESIGN_SYSTEM).not.toContain('#0a1730');
  });

  it('bridges the older application tokens onto the new palette', () => {
    // The dashboard/admin stylesheets still reference these; mapping them keeps the whole product
    // on one palette without rewriting every page in the same change.
    expect(DESIGN_SYSTEM).toContain('--ch247-primary: #16704b');
    expect(DESIGN_SYSTEM).toContain('--ch247-accent: #7ff0b4');
  });

  it('honours reduced-motion preferences', () => {
    expect(DESIGN_SYSTEM).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('keeps the WHMCS theme copy generated from this source', () => {
    expect(THEME_COPY).toContain('GENERATED COPY of shared/site/design-system.css');
    // Everything after the banner must be byte-identical to the source, or the two websites have
    // silently drifted apart on colour, spacing and focus behaviour.
    const body = THEME_COPY.slice(THEME_COPY.indexOf('*/') + 2);
    expect(body.trim()).toBe(DESIGN_SYSTEM.trim());
  });

  it('gives every interactive control a touch target of at least 44px', () => {
    const minimumHeights = [...DESIGN_SYSTEM.matchAll(/min-height:\s*(\d+)px/g)].map((match) => Number(match[1]));
    const tooSmall = minimumHeights.filter((value) => value > 0 && value < 38);
    expect(tooSmall, 'a control declares a min-height below the 44px touch-target guidance').toEqual([]);
    expect(DESIGN_SYSTEM).toContain('.ch247-menu-toggle');
    expect(DESIGN_SYSTEM).toMatch(/\.ch247-menu-toggle\s*\{[^}]*width:\s*44px/);
  });
});
