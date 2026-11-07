/* Heuristic inventory of untranslated JSX literals; not proof that the remaining content is translated.
   Run `node scripts/audit-localization.cjs` for a summary or add --details for locations.
   --check exits nonzero when potential gaps exist, for use as a coverage gate. */
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../frontend/src');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.tsx')) files.push(full);
  }
}
walk(root);
const findings = [];
const readableAttrs = new Set(['placeholder', 'title', 'aria-label', 'alt']);
for (const file of files) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    let text;
    if (ts.isJsxText(node)) text = node.text.trim();
    if (ts.isJsxAttribute(node) && readableAttrs.has(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) text = node.initializer.text.trim();
    if (text && /[A-Za-z]{3}/.test(text)) {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      findings.push({ file: path.relative(root, file), line: position.line + 1, text: text.replace(/\s+/g, ' ').slice(0, 120) });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
console.log(`Potential untranslated JSX literals: ${findings.length} across ${new Set(findings.map(x => x.file)).size} files (heuristic; dynamic data, messages, emails and server templates are not scanned).`);
if (process.argv.includes('--details')) findings.forEach(x => console.log(`${x.file}:${x.line} ${x.text}`));
if (process.argv.includes('--check') && findings.length) process.exitCode = 1;
