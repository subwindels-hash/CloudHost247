import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Control Panels & Application Platforms page carries a photographic hero plus the silver
 * band. Two failure modes there are invisible in a unit test but very visible to a customer:
 *
 *   1. The hero photograph being upscaled from a 1280px asset on a large display, where the rack
 *      cabling and status LEDs visibly soften.
 *   2. The specular sheen being sized against the *document* rather than the viewport, so a long
 *      catalogue changes how often (and how brightly) the sweep is seen depending on page length.
 *
 * These assertions pin the arrangement that avoids both. They are structural, not pixel tests:
 * there is no headless browser in this environment, so they read the stylesheet that ships.
 */

const cssPath = resolve(__dirname, '../../frontend/src/pages/control-panels-page.css');
const assets = resolve(__dirname, '../../frontend/public/media/cloudhost247/hero-backgrounds');
const css = readFileSync(cssPath, 'utf8');

describe('control panels page — background quality does not depend on viewport or page length', () => {
  it('ships a large-screen tier that stops upscaling the 1280px photograph', () => {
    // Up to 1600px the 1280 asset is at most 1.25x. Past that a higher-resolution master must
    // take over, or every big display shows an enlarged copy.
    expect(css).toMatch(/@media \(min-width: 1600px\)/);
    const wide = css.slice(css.indexOf('@media (min-width: 1600px)'));
    const block = wide.slice(0, wide.indexOf('}'));
    expect(block).toContain('servers.jpg');
    // The highest-resolution master must actually be on disk for that tier to mean anything.
    expect(existsSync(join(assets, 'servers.jpg'))).toBe(true);
  });

  it('keeps the ink scrim and vignette above the photograph at every size', () => {
    // Changing only `background-image` at the large breakpoint is what keeps contrast under the
    // heading identical; a `background` shorthand would silently drop the scrim.
    const wide = css.slice(css.indexOf('@media (min-width: 1600px)'));
    const block = wide.slice(0, wide.indexOf('}'));
    expect(block).toContain('linear-gradient(90deg, rgba(9, 15, 23, .92)');
    expect(block).toContain('radial-gradient');
    expect(block).not.toMatch(/^\s*background:\s*$/m);
  });

  it('anchors the hero photograph so cropping only ever eats the empty left third', () => {
    // The master's left side is deliberately empty (it carries the heading); the racks sit right.
    const heroRule = css.slice(css.indexOf('.ch247-control-panels-hero {'));
    expect(heroRule.slice(0, 600)).toContain('right center / cover');
  });

  it('bounds the specular sheen by the viewport, not by the document height', () => {
    const afterRule = css.slice(css.indexOf('.ch247-control-panels-page::after'));
    const block = afterRule.slice(0, afterRule.indexOf('}'));
    expect(block).toContain('height: 100vh');
    // The old arrangement stretched one gradient across the whole page instead.
    expect(block).not.toContain('inset: -20% -60%');
  });

  it('keeps the metallic band itself vector, so page height cannot soften it', () => {
    // Tiling / stretched rasters are the other way a background loses quality as a page grows.
    // Every layer of the silver band must be a gradient (or flat colour), never a url().
    const rootRule = css.slice(css.indexOf('.ch247-control-panels-page {'));
    const block = rootRule.slice(0, rootRule.indexOf('--cp-hero-image'));
    expect(block).toContain('repeating-linear-gradient');
    expect(block).toContain('linear-gradient(160deg');
    expect(block).not.toContain('url(');
  });
});
