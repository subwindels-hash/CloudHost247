/** Reproducible source inventory, not a claim of runtime verification.
 * Run: node scripts/audit-interactions.cjs > ../docs/functionality-audit/interactive-elements.jsonl
 * Dynamic expressions, CMS/vendor content, generated instances and runtime-created controls need
 * separate runtime/staging review. One line represents a source declaration, not one rendered item.
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const rows = [];
function walk(dir, match, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, match, visit);
    else if (match(file)) visit(file);
  }
}
function rel(file) { return path.relative(root, file).split(path.sep).join('/'); }
function emit(row) { rows.push({ ...row, verification: 'not established by source inventory' }); }

walk(path.join(root, 'cloudhost247-node/frontend/src'), (file) => file.endsWith('.tsx'), (file) => {
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function inspect(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const attrs = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map((a) => [a.name.getText(source), a.initializer?.getText(source) ?? 'true']));
      const interactive = ['a', 'button', 'Link', 'NavLink', 'ReturnToLogin', 'summary', 'select', 'form'].includes(tag)
        || (tag === 'input' && /(?:button|submit|reset|checkbox|radio|image)/i.test(attrs.type ?? ''))
        || Boolean(attrs.onClick || attrs.onSubmit || attrs.role && /button|link|tab|menuitem/.test(attrs.role));
      if (interactive) {
        const parent = ts.isJsxElement(node.parent) ? node.parent : null;
        const label = attrs['aria-label'] ?? attrs.title ?? (parent ? parent.children.filter(ts.isJsxText).map((child) => child.text.trim()).filter(Boolean).join(' ') : '');
        emit({ surface: 'react-source', file: rel(file), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          tag, label: label.slice(0, 200), destination: attrs.to ?? attrs.href ?? attrs.action ?? '',
          action: attrs.onClick ?? attrs.onSubmit ?? '', type: attrs.type ?? '', disabled: attrs.disabled ?? '' });
      }
    }
    ts.forEachChild(node, inspect);
  }
  inspect(source);
});

function htmlSource(file) {
  const text = fs.readFileSync(file, 'utf8');
  const re = /<(a|button|summary|select|form|input)\b([^>]*?)>/gi;
  for (const m of text.matchAll(re)) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    if (tag === 'input' && !/\btype\s*=\s*["']?(button|submit|reset|checkbox|radio|image)/i.test(attrs)) continue;
    const attr = (key) => (attrs.match(new RegExp(`\\b${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')) ?? []).slice(1).find((v) => v !== undefined) ?? '';
    const next = text.slice(m.index + m[0].length).match(/^\s*([^<{]{1,120})/);
    emit({ surface: 'php-theme-source', file: rel(file), line: text.slice(0, m.index).split('\n').length,
      tag, label: attr('aria-label') || attr('title') || next?.[1]?.trim() || '', destination: attr('href') || attr('action'),
      action: attr('onclick') || attr('onsubmit'), type: attr('type'), disabled: /\bdisabled\b/i.test(attrs) ? 'present' : '' });
  }
}
walk(path.join(root, 'templates/cloudhost247'), (file) => file.endsWith('.tpl'), htmlSource);
walk(path.join(root, 'tools'), (file) => file.endsWith('.php') && !file.includes(`${path.sep}admin${path.sep}`), htmlSource);
for (const entry of fs.readdirSync(root)) if (entry.endsWith('.php')) htmlSource(path.join(root, entry));

function jsonSource(file) {
  const source = JSON.parse(fs.readFileSync(file, 'utf8'));
  function visit(value, pointer) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, `${pointer}/${index}`));
    for (const key of ['to', 'href', 'spa', 'php']) {
      if (typeof value[key] === 'string' && value[key]) emit({ surface: 'registry-content', file: rel(file), pointer: `${pointer}/${key}`,
        tag: 'data-link', label: String(value.label ?? value.title ?? value.name ?? '').slice(0, 200), destination: value[key], action: '', type: '', disabled: '' });
    }
    for (const [key, child] of Object.entries(value)) visit(child, `${pointer}/${key}`);
  }
  visit(source, '');
}
jsonSource(path.join(root, 'shared/site/registry.json'));
walk(path.join(root, 'shared/site/content'), (file) => file.endsWith('.json') && !file.includes('.generated.'), jsonSource);
for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
console.error(`Inventoried ${rows.length} static declarations; all require runtime verification.`);
