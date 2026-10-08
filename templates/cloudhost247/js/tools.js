import { runLocal, isSecretCell } from './tools-local.js';

/**
 * Tools front-end.
 *
 * Two rules shape this file. First, nothing a visitor types is sent anywhere it does not have to
 * go: `local` tools never make a request, secrets are never written to storage, and downloads are
 * built from a Blob rather than from a URL that would carry the value. Second, the page works
 * without JavaScript — every card and every link is server-rendered, and this file only adds
 * filtering, the result panel and the clipboard.
 */

const root = document.getElementById('ch-tools-content');
const RECENT_KEY = 'ch247.tools.recent';

// --- Hub and collection search -------------------------------------------------------------------

const search = document.getElementById('ch-tool-q');
if (search && root) {
  const cards = Array.from(document.querySelectorAll('.ch-tool-card'));
  const status = root.querySelector('.ch-tool-state');
  const empty = root.querySelector('[data-collection-empty]');
  const filter = (query) => {
    let visible = 0;
    cards.forEach((card) => {
      const haystack = card.dataset.search || card.textContent.toLowerCase();
      const show = query === '' || haystack.includes(query);
      card.hidden = !show;
      if (show) visible += 1;
    });
    // Hide a group heading whose tools have all been filtered out, so the page does not show an
    // empty section under a title.
    document.querySelectorAll('[data-group]').forEach((section) => {
      const anyVisible = Array.from(section.querySelectorAll('.ch-tool-card')).some((card) => !card.hidden);
      section.hidden = query !== '' && !anyVisible;
    });
    if (status) status.textContent = query === ''
      ? cards.length + ' tools listed.'
      : visible + ' of ' + cards.length + ' tools match “' + query + '”';
    if (empty) empty.hidden = visible !== 0;
  };
  search.addEventListener('input', () => filter(search.value.trim().toLowerCase()));
  // The form submits to the same URL so a bookmarkable ?q= works without JavaScript; with it on,
  // filter in place instead of reloading.
  const form = search.closest('form');
  if (form) {
    form.addEventListener('submit', (event) => { event.preventDefault(); filter(search.value.trim().toLowerCase()); });
  }
  const initial = new URLSearchParams(location.search).get('q');
  if (initial) { search.value = initial; filter(initial.toLowerCase()); }
  renderRecent(cards);
}

/**
 * Recently used tools, from this browser only.
 *
 * The section ships hidden and stays hidden when there is no history, so the page never shows an
 * invented list. Only slugs are stored — never a value a visitor typed into a tool.
 */
function renderRecent(cards) {
  const section = document.querySelector('[data-recent-tools]');
  const list = document.querySelector('[data-recent-list]');
  if (!section || !list) return;
  let slugs = [];
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    if (Array.isArray(stored)) slugs = stored.filter((slug) => typeof slug === 'string').slice(0, 6);
  } catch {
    slugs = [];
  }
  const bySlug = new Map(cards.map((card) => [card.dataset.toolSlug, card]));
  const known = slugs.map((slug) => bySlug.get(slug)).filter(Boolean);
  if (!known.length) return;
  known.forEach((card) => list.append(card.cloneNode(true)));
  section.hidden = false;
}

function rememberTool(slug) {
  if (!slug) return;
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    const next = [slug].concat((Array.isArray(stored) ? stored : []).filter((item) => item !== slug)).slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private browsing or a blocked storage API: the tool still works, it is just not remembered.
  }
}

// --- Tool forms ----------------------------------------------------------------------------------

document.querySelectorAll('.ch-tool-form').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    if (form.dataset.handler === 'speed') return;
    event.preventDefault();
    const state = form.querySelector('.ch-tool-state');
    const result = form.querySelector('.ch-tool-result');
    const data = {};
    new FormData(form).forEach((value, key) => { data[key] = value; });
    const file = form.querySelector('input[type="file"]');
    if (file && file.files[0]) data.file = file.files[0];
    if (!validate(form, data, state)) return;
    state.dataset.state = 'loading';
    state.textContent = 'Working…';
    result.replaceChildren();
    try {
      const payload = form.dataset.mode === 'local'
        ? await runLocal(form.dataset.handler, data)
        : await postTool(form, data);
      render(result, payload, state);
      if (payload && payload.ok !== false) rememberTool(form.dataset.slug);
    } catch (error) {
      state.dataset.state = 'error';
      state.textContent = 'The request could not be completed.';
      render(result, { ok: false, error: error.message || 'Network error' }, state);
    }
  });
  form.addEventListener('reset', () => {
    const state = form.querySelector('.ch-tool-state');
    const result = form.querySelector('.ch-tool-result');
    state.dataset.state = 'empty';
    state.textContent = 'Nothing has been run yet.';
    result.replaceChildren();
  });
});

function validate(form, data, state) {
  for (const field of form.querySelectorAll('[required]')) {
    if (field.type === 'file' ? !field.files.length : !String(field.value || '').trim()) {
      state.dataset.state = 'error';
      state.textContent = 'Enter the required ' + (field.labels[0] ? field.labels[0].textContent.replace('required', '').trim() : 'value') + '.';
      field.focus();
      return false;
    }
  }
  if (data.domain && !/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(data.domain)) {
    state.dataset.state = 'error';
    state.textContent = 'Enter a domain such as example.com.';
    return false;
  }
  return true;
}

async function postTool(form, data) {
  const slug = form.dataset.slug;
  const input = { ...data };
  delete input.slug; delete input.format; delete input.options; delete input.file;
  const response = await fetch(new URL('api.php', new URL(form.action, location.origin)), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ slug, input }),
  });
  const payload = await response.json();
  if (!response.ok && payload && !payload.error) payload.error = 'The service returned ' + response.status + '.';
  return payload;
}


function render(container, payload, state) {
  container.replaceChildren();
  if (!payload || payload.ok === false) {
    state.dataset.state = 'error';
    state.textContent = payload && payload.error ? payload.error : 'The request failed.';
    const box = el('div', 'ch-tool-error');
    box.setAttribute('role', 'alert');
    box.append(el('h2', '', 'Could not produce a result'), el('p', '', state.textContent));
    container.append(box);
    return;
  }
  state.dataset.state = 'result';
  state.textContent = payload.summary || 'Done.';
  const box = el('div', 'ch-tool-ok');
  box.append(el('h2', '', payload.summary || 'Result'));
  if (payload.checkedAt) box.append(el('p', 'ch-muted', 'Run at ' + payload.checkedAt + (payload.elapsedMs ? ' · ' + payload.elapsedMs + ' ms' : '')));
  const rows = payload.rows || [];
  if (!rows.length) box.append(el('p', '', 'Finished with nothing to report.'));

  // Long single-value rows (a JSON document, a zone file, a policy) read better as a code block
  // than as a table cell, and they are what the Copy and Download buttons act on.
  const blocks = rows.filter((row) => isBlock(row));
  const table = rows.filter((row) => !isBlock(row));
  blocks.forEach((row) => {
    const label = row.Measure || row.Field;
    box.append(el('h3', 'ch-block-label', label));
    const pre = el('pre', 'ch-block');
    pre.textContent = String(row.Value);
    pre.tabIndex = 0;
    box.append(pre);
  });

  if (table.length) {
    const keys = Object.keys(table[0]);
    const grid = document.createElement('table');
    const head = document.createElement('tr');
    keys.forEach((key) => head.append(el('th', '', key)));
    const thead = document.createElement('thead'); thead.append(head); grid.append(thead);
    const body = document.createElement('tbody');
    table.forEach((row) => {
      const tr = document.createElement('tr');
      keys.forEach((key) => {
        const td = document.createElement('td');
        const value = row[key] == null ? '' : String(row[key]);
        if (isSecretCell(row, key)) {
          td.textContent = 'Hidden — reveal to copy';
          const reveal = document.createElement('button');
          reveal.type = 'button'; reveal.className = 'ch-btn ch-btn-small'; reveal.textContent = 'Reveal';
          reveal.addEventListener('click', () => { td.textContent = value; reveal.remove(); });
          td.append(document.createTextNode(' '), reveal);
        } else {
          td.textContent = value;
        }
        tr.append(td);
      });
      body.append(tr);
    });
    grid.append(body);
    const scroll = el('div', 'ch-table-scroll');
    scroll.append(grid);
    box.append(scroll);
  }

  // Legacy row shapes used by the older tools.
  rows.forEach((row) => {
    if (row.Preview && String(row.Preview).startsWith('data:image')) {
      const img = document.createElement('img');
      img.alt = 'Generated QR code';
      img.width = 320; img.height = 320;
      img.className = 'ch-qr';
      img.src = row.Preview;
      const link = document.createElement('a');
      link.href = row.Preview; link.download = 'cloudhost247-qr.png'; link.className = 'ch-btn ch-btn-small';
      link.textContent = 'Download PNG';
      box.append(img, link);
    }
    if (row.Preview && /^#[0-9a-f]{6}$/i.test(row.Preview)) {
      const swatch = el('div', 'ch-swatch');
      swatch.style.background = row.Preview;
      swatch.append(el('span', '', row.Preview));
      const copy = document.createElement('button');
      copy.type = 'button'; copy.className = 'ch-btn ch-btn-small'; copy.textContent = 'Copy HEX';
      copy.addEventListener('click', () => navigator.clipboard.writeText(row.Preview));
      box.append(swatch, copy);
    }
  });

  // Copy and Download. The clipboard is written only on a click, and the download comes from a
  // Blob — never from a URL, which would put the value in the browser history and in server logs.
  if (payload.copyText) {
    const actions = el('div', 'ch-actions');
    const filename = payload.downloadName || 'cloudhost247-result.txt';
    const copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'ch-btn ch-btn-small'; copy.textContent = 'Copy result';
    copy.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('unavailable');
        await navigator.clipboard.writeText(payload.copyText);
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Copy unavailable — select the value above';
      }
    });
    const download = document.createElement('button');
    download.type = 'button'; download.className = 'ch-btn ch-btn-dark ch-btn-small';
    download.textContent = 'Download ' + filename;
    download.addEventListener('click', () => {
      const blob = new Blob([endsWithNewline(payload.copyText) ? payload.copyText : payload.copyText + '\n'], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = filename;
      document.body.append(link); link.click(); link.remove();
      URL.revokeObjectURL(url);
      download.textContent = 'Downloaded';
    });
    actions.append(copy, download);
    box.append(actions);
  }
  (payload.notes || []).forEach((note) => box.append(el('p', 'ch-muted', note)));
  container.append(box);
}

function endsWithNewline(value) {
  return /\n$/.test(String(value));
}

/** A row whose value is a document rather than a field: multi-line, or long enough to need wrapping. */
function isBlock(row) {
  const keys = Object.keys(row);
  const value = row.Value;
  if (value === undefined || value === null) return false;
  if (!(keys.length === 2 && ('Measure' in row || 'Field' in row))) return false;
  const text = String(value);
  return text.includes('\n') || text.length > 120;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const speed = document.querySelector('[data-handler="speed"]');
if (speed) {
  speed.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const state = speed.querySelector('.ch-tool-state');
    const result = speed.querySelector('.ch-tool-result');
    state.textContent = 'Measuring the path to this CloudHost247 service…';
    const api = new URL(speed.action, location.origin);
    const latencyStart = performance.now();
    await fetch(api.pathname + '?op=catalog', { cache: 'no-store' });
    const latency = Math.round(performance.now() - latencyStart);
    const bytes = 500000;
    const downloadStart = performance.now();
    const payload = await fetch(api.pathname + '?op=speed&bytes=' + bytes, { cache: 'no-store' });
    const blob = await payload.blob();
    const downloadSeconds = (performance.now() - downloadStart) / 1000;
    const downloadMbps = ((blob.size * 8) / downloadSeconds / 1e6).toFixed(2);
    const body = crypto.getRandomValues(new Uint8Array(200000));
    const uploadStart = performance.now();
    const uploaded = await fetch(api.pathname + '?op=upload', { method: 'POST', body });
    const uploadJson = await uploaded.json();
    const uploadMbps = (uploadJson.bytes * 8 / ((performance.now() - uploadStart) / 1000) / 1e6).toFixed(2);
    render(result, { ok: true, summary: 'Path measurement complete', checkedAt: new Date().toISOString(), rows: [{ Latency: latency + ' ms', Download: downloadMbps + ' Mbps', Upload: uploadMbps + ' Mbps', Bytes: blob.size }], notes: ['This measures only the browser path to this CloudHost247 service. It is not an ISP-wide speed claim.'] }, state);
  }, true);
}
