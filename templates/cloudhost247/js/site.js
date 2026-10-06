/* Progressive enhancement: links, search and disclosure navigation work without JS. */
(() => {
  'use strict';
  document.body.classList.add('ch-enhanced');
  const nav = document.getElementById('ch-navigation');
  const toggle = document.querySelector('.ch-menu-toggle');
  const menus = Array.from(document.querySelectorAll('.ch-nav-item'));
  const closeMenus = (except) => menus.forEach(menu => { if (menu !== except) menu.open = false; });
  menus.forEach(menu => menu.addEventListener('toggle', () => { if (menu.open) closeMenus(menu); }));
  if (nav && toggle) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
      if (!open) closeMenus();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const opened = menus.find(menu => menu.open);
      if (opened) { opened.open = false; opened.querySelector('summary').focus(); }
      else if (nav.classList.contains('is-open')) { nav.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); }
    });
    document.addEventListener('click', event => { if (!nav.contains(event.target)) closeMenus(); });
    document.addEventListener('focusin', event => { if (!nav.contains(event.target)) closeMenus(); });
  }
  // Public, read-only Node APIs only. Credentials and mutation controls remain in the platform.
  document.querySelectorAll('[data-ch-catalog]').forEach(async container => {
    const platform = container.dataset.platform;
    if (!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(platform || '')) return;
    const os = container.dataset.chCatalog === 'os';
    const status = container.querySelector('[data-catalog-status]');
    const results = container.querySelector('[data-catalog-results]');
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 10000);
    try {
      const response = await fetch(platform + '/api/v1/' + (os ? 'operating-systems' : 'apps?limit=24'), { signal: abort.signal, credentials: 'omit', headers: {Accept: 'application/json'} });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      const rows = os ? data.operatingSystems : data.apps;
      if (!Array.isArray(rows)) throw new Error('invalid catalog');
      // Only display results the public backend explicitly returns, never a hard-coded OS/app list.
      rows.slice(0, 48).forEach(row => {
        if (typeof row.name !== 'string') return;
        const card = document.createElement('article'); card.className = 'ch-plan';
        card.append(ApplicationLogo(row.name));
        const title = document.createElement('h3'); title.textContent = row.name; card.append(title);
        const description = document.createElement('p'); description.textContent = String(row.description || (os ? 'Provider-mapped image family. Select a server configuration to verify available versions.' : 'View the application’s current versions and deployment requirements.')).slice(0, 450); card.append(description);
        const link = document.createElement('a'); link.className = 'ch-text-link'; link.textContent = os ? 'View server options →' : 'Explore application →';
        link.href = platform + (os ? '/servers/new' : '/apps/' + encodeURIComponent(String(row.slug || ''))); card.append(link); results.append(card);
      });
      status.textContent = rows.length ? 'Availability is verified by the connected platform. Confirm the selected configuration before ordering.' : 'No eligible catalog entries are currently published.';
    } catch (_) { status.textContent = 'The platform catalog is temporarily unavailable. No sample results are shown. Please try the platform or contact support.'; }
    finally { clearTimeout(timeout); }
  });
  const toolFilter = document.querySelector('[data-ch-tools-filter]');
  if (toolFilter) {
    toolFilter.addEventListener('input', () => {
      const query = toolFilter.value.trim().toLowerCase();
      document.querySelectorAll('[data-ch-tools-menu] .ch-mega-group li').forEach(item => {
        item.hidden = query !== '' && !item.textContent.toLowerCase().includes(query);
      });
    });
  }
  // One availability request for both shared menus. Nothing is promoted from static metadata.
  const toolsMenu = document.querySelector('[data-ch-tools-menu]');
  const toolsFooter = document.querySelector('[data-ch-tools-footer]');
  if (toolsMenu) {
    const base = toolsMenu.dataset.toolsApi || '';
    const root = toolsMenu.dataset.toolsRoot || '';
    if (/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(base)) {
      const abort = new AbortController(); const timeout = setTimeout(() => abort.abort(), 10000);
      fetch(base + '/api/tools/navigation', {credentials: 'omit', signal: abort.signal, headers: {Accept: 'application/json'}})
        .then(response => { if (!response.ok) throw new Error('Unavailable'); return response.json(); })
        .then(data => {
          if (!Array.isArray(data.tools)) return;
          const tools = data.tools.filter(tool => typeof tool.name === 'string' && /^\/tools\/[a-z0-9-]+$/.test(tool.path));
          const panel = toolsMenu.querySelector('.ch-mega');
          const categories = data.categories || {};
          if (panel) Object.entries(categories).forEach(([slug, label]) => {
            const entries = tools.filter(tool => (tool.discoveryCategories || []).includes(slug)).slice(0, 5);
            if (!entries.length) return;
            const section = document.createElement('div'); section.className = 'ch-mega-group'; const title = document.createElement('h3'); title.textContent = label;
            const list = document.createElement('ul'); section.append(title, list);
            entries.forEach(tool => { const li = document.createElement('li'); li.append(toolLink(tool)); list.append(li); }); panel.append(section);
          });
          if (toolsFooter) (data.footer || []).forEach(slug => {
            const tool = tools.find(row => row.slug === slug); if (!tool) return;
            const li = document.createElement('li'); li.append(toolLink(tool)); toolsFooter.insertBefore(li, toolsFooter.lastElementChild);
          });
          function toolLink(tool) { const link = document.createElement('a'); link.href = root + tool.path; link.textContent = tool.name; return link; }
        }).catch(() => { /* All Tools remains a normal server-rendered link. */ }).finally(() => clearTimeout(timeout));
    }
  }
  /** A neutral software badge; does not imitate third-party trademarks or imply affiliation. */
  function ApplicationLogo(name) {
    const logo = document.createElement('span'); logo.className = 'ch-application-logo';
    logo.setAttribute('aria-hidden', 'true'); logo.textContent = name.trim().slice(0, 2).toUpperCase();
    return logo;
  }
})();
