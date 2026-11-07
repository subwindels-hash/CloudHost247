import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../frontend/src');
const assets = resolve(__dirname, '../../frontend/public/media/cloudhost247/hero-backgrounds');
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : path.endsWith('.tsx') ? [path] : [];
  });
}

describe('wide hero backgrounds', () => {
  it('assigns a supported image to every compact public application hero', () => {
    const css = readFileSync(join(root, 'styles.css'), 'utf8');
    const files = walk(join(root, 'pages'));
    const heroes = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/className="ch247-hero ch247-hero--compact([^\"]*)"/g)].map((match) => ({ file, classes: match[1] })));
    expect(heroes.length).toBeGreaterThan(20);
    for (const hero of heroes) {
      if (hero.classes.includes('ch247-contact-hero')) continue;
      const group = hero.classes.match(/ch247-hero--(hosting|domains|cloud|servers|developers|security|tools|support|legal|company)/)?.[1];
      expect(group, hero.file).toBeTruthy();
      for (const width of [640, 1280]) {
        expect(existsSync(join(assets, `${group}-${width}.webp`)), hero.file).toBe(true);
        expect(css).toContain(`/hero-backgrounds/${group}-${width}.webp`);
      }
    }
  });
});
