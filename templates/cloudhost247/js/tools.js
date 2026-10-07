import { runLocal } from './tools-local.js';

const root = document.getElementById('ch-tools-content');
const search = document.getElementById('ch-tool-q');
if (search && root) {
  const cards = Array.from(document.querySelectorAll('.ch-tool-card'));
  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    cards.forEach((card) => {
      const show = query === '' || card.textContent.toLowerCase().includes(query);
      card.hidden = !show;
      if (show) visible++;
    });
    const status = root.querySelector('[role="status"]');
    if (status && query) status.textContent = visible + ' tools match “' + query + '”';
  });
}

document.querySelectorAll('.ch-tool-form').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    if (form.dataset.handler === 'speed') return;
    event.preventDefault();
    const state = form.querySelector('.ch-tool-state');
    const result = form.querySelector('.ch-tool-result');
    const data = Object.fromEntries(new FormData(form).entries());
    const file = form.querySelector('input[type="file"]');
    if (file && file.files[0]) data.file = file.files[0];
    if (!validate(form, data, state)) return;
    state.dataset.state = 'loading';
    state.textContent = 'Running check…';
    result.replaceChildren();
    try {
      const payload = form.dataset.mode === 'local'
        ? await runLocal(form.dataset.handler, data)
        : await postTool(form, data);
      render(result, payload, state);
    } catch (error) {
      state.dataset.state = 'error';
      state.textContent = 'The check could not be completed.';
      render(result, { ok: false, error: error.message || 'Network error' }, state);
    }
  });
  form.addEventListener('reset', () => {
    const state = form.querySelector('.ch-tool-state');
    const result = form.querySelector('.ch-tool-result');
    state.dataset.state = 'empty';
    state.textContent = 'Nothing has been checked yet.';
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
  if (data.domain && !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(data.domain)) {
    state.dataset.state = 'error';
    state.textContent = 'Enter a domain such as example.com.';
    return false;
  }
  return true;
}

// Reads a response as JSON, and when it is not JSON says what actually happened.
//
// Without this, a response that is not JSON (an HTML error page, a login redirect, a web-server
// default document) surfaced as `Unexpected token '<', "<!doctype "... is not valid JSON` inside the
// result panel: accurate, and meaningless to the person reading it. The body cannot be re-read
// after a failed parse, so the raw text is parsed first and the Content-Type is only used for detail.
async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    const contentType = response.headers.get('content-type') || '';
    const looksLikeHtml = /^\s*(<!doctype|<html)/i.test(text) || /text\/html/i.test(contentType);
    const reason = looksLikeHtml
      ? 'the tools service is not reachable at this address (an HTML page came back instead of a result)'
      : 'the tools service returned ' + (contentType || 'an unreadable body');
    const failure = new Error('This check could not run: ' + reason + ' (status ' + response.status + ').');
    failure.cause = error;
    throw failure;
  }
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
  const payload = await readJsonResponse(response);
  if (!response.ok && payload && !payload.error) payload.error = 'The service returned ' + response.status + '.';
  return payload;
}

function render(container, payload, state) {
  container.replaceChildren();
  if (!payload || payload.ok === false) {
    state.dataset.state = 'error';
    state.textContent = payload && payload.error ? payload.error : 'The check failed.';
    const box = el('div', 'ch-tool-error');
    box.setAttribute('role', 'alert');
    box.append(el('h2', '', 'Check failed'), el('p', '', state.textContent));
    container.append(box);
    return;
  }
  state.dataset.state = 'result';
  state.textContent = payload.summary || 'Check complete.';
  const box = el('div', 'ch-tool-ok');
  box.append(el('h2', '', payload.summary || 'Result'));
  if (payload.checkedAt) box.append(el('p', 'ch-muted', 'Last checked ' + payload.checkedAt + (payload.elapsedMs ? ' · ' + payload.elapsedMs + ' ms' : '')));
  const rows = payload.rows || [];
  if (!rows.length) box.append(el('p', '', 'The check finished with no rows.'));
  rows.forEach((row) => {
    if (row.Preview && String(row.Preview).startsWith('data:image')) {
      const img = document.createElement('img');
      img.alt = 'Generated QR code';
      img.width = 280; img.height = 280;
      img.src = row.Preview;
      const link = document.createElement('a');
      link.href = row.Preview; link.download = 'cloudhost247-qr.png'; link.className = 'ch-btn ch-btn-small';
      link.textContent = 'Download QR';
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
  if (rows.length && !rows.some((row) => row.Preview && String(row.Preview).startsWith('data:image'))) {
    const table = document.createElement('table');
    const head = document.createElement('tr');
    Object.keys(rows[0]).filter((key) => key !== 'Preview' || !String(rows[0][key]).startsWith('data:')).forEach((key) => head.append(el('th', '', key)));
    const thead = document.createElement('thead'); thead.append(head); table.append(thead);
    const body = document.createElement('tbody');
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      Object.entries(row).forEach(([key, value]) => {
        if (key === 'Preview' && String(value).startsWith('data:image')) return;
        const td = document.createElement('td');
        td.textContent = value == null ? '' : String(value);
        if (key === 'Password' || key === 'Passphrase') {
          const reveal = document.createElement('button');
          reveal.type = 'button'; reveal.textContent = 'Show';
          td.textContent = 'Hidden';
          reveal.addEventListener('click', () => { td.textContent = String(value); reveal.remove(); });
          td.append(reveal);
        }
        tr.append(td);
      });
      body.append(tr);
    });
    table.append(body);
    const scroll = el('div', 'ch-table-scroll');
    scroll.append(table);
    box.append(scroll);
  }
  // Tools that produce a short, copyable value (an MRZ pair, a generated record, a snippet) can
  // return `copyText`. The value stays in this tab: the clipboard is written only when the visitor
  // clicks, and the download is created from a Blob — never from a URL that would carry the data.
  if (payload.copyText) {
    const actions = el('div', 'ch-actions');
    const copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'ch-btn ch-btn-small'; copy.textContent = 'Copy result';
    copy.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('unavailable');
        await navigator.clipboard.writeText(payload.copyText);
        copy.textContent = 'Copied';
      } catch (_) {
        copy.textContent = 'Copy unavailable — select the value above';
      }
    });
    const download = document.createElement('button');
    download.type = 'button'; download.className = 'ch-btn ch-btn-dark ch-btn-small'; download.textContent = 'Download as text';
    download.addEventListener('click', () => {
      const blob = new Blob([payload.copyText + '\n'], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'cloudhost247-result.txt';
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
    const uploadJson = await readJsonResponse(uploaded);
    const uploadMbps = ((uploadJson.bytes * 8) / ((performance.now() - uploadStart) / 1000) / 1e6).toFixed(2);
    render(result, { ok: true, summary: 'Path measurement complete', checkedAt: new Date().toISOString(), rows: [{ Latency: latency + ' ms', Download: downloadMbps + ' Mbps', Upload: uploadMbps + ' Mbps', Bytes: blob.size }], notes: ['This measures only the browser path to this CloudHost247 service. It is not an ISP-wide speed claim.'] }, state);
  }, true);
}
