#!/usr/bin/env node
/**
 * Repository-wide hygiene check for published text.
 *
 * Fails when any text file contains:
 *   - U+F0B7 — the Private Use Area glyph that PDF symbol fonts emit for a bullet. It renders as a
 *     box or as a stray character in web pages, so list bullets must be real list markup instead.
 *   - U+FFFD — the Unicode replacement character, the sign that text was decoded with the wrong
 *     encoding at some point.
 *   - Any other Private Use Area character (U+E000–U+F8FF, except U+F0B7 which has its own rule). Symbol-font glyphs from Word and PDF
 *     exports land here, so a visible symbol can be copied into text that should only contain letters.
 *   - Common UTF-8-read-as-Windows-1252 mojibake sequences (for example the two code points U+00C3
 *     U+00A9, which is how "é" looks after being decoded the wrong way).
 *
 * The scan covers the whole repository, not just published pages. Only files that are text (no NUL
 * bytes, and not a known binary extension) are inspected.
 *
 * Exclusions are deliberate and listed below, each with its reason. Add to them only with a reason.
 *
 * Usage:
 *   node scripts/check-malformed-bullets.mjs          # exit 1 and list findings
 *   node scripts/check-malformed-bullets.mjs --json   # machine-readable output
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories never scanned. Generated or installed output is not authored content. */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.cache', '.next', '.turbo']);

/**
 * Third-party code we do not own, and the rules relaxed for it. The U+F0B7 bullet rule is never
 * relaxed: nothing in vendored code uses that glyph (verified by a repository-wide byte search).
 *   - Smtphosting/…/layers-ui.js (JS and CSS): a vendored UI library. Its JS contains a U+FFFD and a
 *     mojibake literal; its CSS uses Private Use Area code points for its own icon font.
 *   - Smtphosting/templates/assets/tpl/ProxmoxVPS/xterm: the vendored xterm.js terminal library.
 *   - blockonomics/assets/js/vendors: vendored minified browser libraries.
 */
const VENDOR_RELAXED_PREFIXES = [
  'modules/servers/Smtphosting/templates/admin/assets/js/layers-ui.js',
  'modules/servers/Smtphosting/templates/client/default/assets/js/layers-ui.js',
  'modules/servers/Smtphosting/templates/admin/assets/css/layers-ui.css',
  'modules/servers/Smtphosting/templates/client/default/assets/css/layers-ui.css',
  'modules/servers/Smtphosting/templates/assets/tpl/ProxmoxVPS/xterm/',
  'modules/gateways/blockonomics/assets/js/vendors/',
];
/** Vendored files additionally exempt from the Private Use Area rule only (icon-font code points). */

/**
 * Extensions that are binary, and therefore never inspected as text. Known exception: the legacy
 * theme's www-img.png contains the byte sequence EF 82 B7 by chance inside compressed image data.
 * Binary assets must not be edited to "fix" a byte pattern; this check ignores them by design.
 */
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'pdf', 'zip', 'gz', 'tgz', 'tar', 'rar', '7z',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'mp4', 'webm', 'ogg', 'wav', 'avif', 'psd', 'sqlite',
]);

const RULES = [
  { id: 'malformed-bullet', description: 'U+F0B7 (PDF symbol-font bullet)', pattern: /\uF0B7/u, relaxedForVendor: false },
  { id: 'private-use-glyph', description: 'Private Use Area character (symbol-font glyph)', pattern: /[\uE000-\uF0B6\uF0B8-\uF8FF]/u, relaxedForVendor: true },
  { id: 'replacement-character', description: 'U+FFFD replacement character', pattern: /\uFFFD/u, relaxedForVendor: true },
  {
    id: 'mojibake',
    description: 'UTF-8 text decoded as Windows-1252',
    pattern: /(?:Ã[\u0080-\u00BF©®°±¨¤¶º¼½¾ªµ»¿]|Â[\u00A0-\u00BF]|â€[\u0080-\u009F™œ¦“”‘’˜–—])/u,
    relaxedForVendor: true,
  },
];

function toPosix(path) {
  return path.split(sep).join('/');
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function isBinary(buffer, path) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (BINARY_EXTENSIONS.has(ext)) return true;
  return buffer.subarray(0, Math.min(buffer.length, 8000)).includes(0);
}

/** Returns findings for a single file's text: [{ rule, line, column, sample }]. */
export function scanText(text, { vendorRelaxed = false } = {}) {
  const findings = [];
  const lines = text.split(/\r?\n/u);
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      if (vendorRelaxed && rule.relaxedForVendor) continue;
      const match = rule.pattern.exec(line);
      if (match) {
        findings.push({ rule: rule.id, line: index + 1, column: match.index + 1, sample: line.trim().slice(0, 120) });
      }
    }
  });
  return findings;
}

export function scanRepository(root = ROOT) {
  const results = [];
  let filesScanned = 0;
  for (const full of walk(root)) {
    const rel = toPosix(relative(root, full));
    const buffer = readFileSync(full);
    if (isBinary(buffer, rel)) continue;
    filesScanned += 1;
    const vendorRelaxed = VENDOR_RELAXED_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(prefix));
    const findings = scanText(buffer.toString('utf8'), { vendorRelaxed });
    for (const finding of findings) results.push({ file: rel, ...finding });
  }
  return { filesScanned, findings: results };
}

/* istanbul ignore next */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { filesScanned, findings } = scanRepository();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ filesScanned, findings }, null, 2)}\n`);
  } else {
    for (const f of findings) {
      process.stdout.write(`${f.file}:${f.line}:${f.column}  [${f.rule}]  ${f.sample}\n`);
    }
    process.stdout.write(`\nScanned ${filesScanned} text files; ${findings.length} finding(s).\n`);
  }
  process.exit(findings.length > 0 ? 1 : 0);
}
