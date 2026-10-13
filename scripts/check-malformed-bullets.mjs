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
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories never scanned. Generated or installed output is not authored content. */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.cache', '.next', '.turbo']);

/**
 * Paths git ignores, as POSIX paths relative to the repository root — the authoritative version of
 * the rule above, because `.gitignore` is where this repository already records what is generated.
 *
 * Deriving it from git instead of from directory *names* is the whole point. The built SPA lands in
 * `cloudhost247-node/public/` (vite's `outDir`, ignored by `cloudhost247-node/.gitignore`), while
 * `cloudhost247-node/frontend/public/` is **tracked source** — 641 files, including the media library
 * this project ships. A name-based `SKIP_DIRS.add('public')` would have dropped that source from the
 * hygiene scan and still printed a success line, which is a check that scans less while looking
 * green. Skipping by name also made the reported count depend on whether a build had been run: the
 * same commit reported 6 673 files after `npm run build:frontend` and 5 983 on the clean checkout CI
 * actually scans, so the figure quoted in the documentation reproduced on nobody's machine but mine.
 *
 * Without git (a tarball, a sandbox with no repository) this returns an empty set and `SKIP_DIRS`
 * alone still applies, so the scan degrades to its previous behaviour rather than failing.
 */
function gitIgnoredPaths(root) {
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
    // The trailing-slash strip is load-bearing, not cosmetic. `.gitignore` says `public/*` — it
    // matches the *contents* — so `git check-ignore cloudhost247-node/public` reports not-ignored
    // while `.../public/index.html` reports ignored. `--directory` still collapses the whole tree to
    // `cloudhost247-node/public/`, and only after stripping that slash does the walk's `rel` compare
    // equal and prune it. Drop the strip and generated output is scanned again.
    return new Set(out.split('\n').filter(Boolean).map((entry) => toPosix(entry).replace(/\/+$/, '')));
  } catch {
    return new Set();
  }
}

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
/**
 * Vendored files whose ORIGINAL bytes (as pinned in docs/independent-rebuild/original-file-manifest.sha256)
 * contain a single Private Use Area glyph. The release gate hashes these files byte-for-byte, so they
 * cannot be edited to remove it. Exempt from the Private Use Area rule only; every other rule still applies.
 *   - soyoustart/lang/french.php: "L'Europe" followed by a symbol-font glyph (U+F0D7).
 */
const VENDOR_PUA_EXEMPT_FILES = new Set(['modules/addons/soyoustart/lang/french.php']);

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

function* walk(dir, root, ignored) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    const rel = toPosix(relative(root, full));
    if (ignored.has(rel)) continue;
    if (entry.isDirectory()) {
      yield* walk(full, root, ignored);
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
  const ignored = gitIgnoredPaths(root);
  for (const full of walk(root, root, ignored)) {
    const rel = toPosix(relative(root, full));
    const buffer = readFileSync(full);
    if (isBinary(buffer, rel)) continue;
    filesScanned += 1;
    const vendorRelaxed = VENDOR_RELAXED_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(prefix));
    const findings = scanText(buffer.toString('utf8'), { vendorRelaxed });
    for (const finding of findings) {
      if (finding.rule === 'private-use-glyph' && VENDOR_PUA_EXEMPT_FILES.has(rel)) continue;
      results.push({ file: rel, ...finding });
    }
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
