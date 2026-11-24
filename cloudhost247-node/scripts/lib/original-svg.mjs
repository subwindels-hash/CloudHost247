/** Fail-closed checks for the small, pinned set of original SVG logo files.
 * These files are served as images, never inserted with innerHTML. */
export function assertSafeOriginalSvg(svg, allowEmbeddedPng = false) {
  if (!/<svg\b/i.test(svg) || /<!DOCTYPE|<!ENTITY|&#|<\s*(?:script|style|foreignObject|iframe|object|embed|audio|video|animate\w*|set)\b|\bon\w+\s*=|@import/i.test(svg)) {
    throw new Error('Active or unsupported original SVG content');
  }
  for (const [, ref] of svg.matchAll(/(?:href|src)\s*=\s*["']([^"']*)["']/gi)) {
    if (/^#[\w.-]+$/.test(ref)) continue;
    if (allowEmbeddedPng && /^data:image\/png;base64,[A-Za-z0-9+/=\s]+$/.test(ref)) continue;
    throw new Error('External or unsupported SVG reference');
  }
  for (const [, ref] of svg.matchAll(/url\(\s*([^)]*)\)/gi)) {
    if (!/^#[\w.-]+$/.test(ref)) throw new Error('External SVG paint reference');
  }
  if (/<image\b/i.test(svg) && !allowEmbeddedPng) throw new Error('Unreviewed embedded raster in SVG');
}
