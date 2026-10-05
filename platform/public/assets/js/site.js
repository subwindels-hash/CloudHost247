/**
 * Public site behaviour: navigation, auth-aware header, domain search, PWA registration.
 *
 * Vanilla JS with no framework and no build step. Loaded as an ES module from every page, so
 * there are no inline scripts and the server's `script-src 'self'` CSP holds without exceptions.
 */

import { store, authApi, describeError, ApiError } from './api.js';

// --- mobile navigation ----------------------------------------------------

function initNav() {
  const toggle = document.querySelector('[data-nav-toggle]');
  const nav = document.querySelector('[data-nav]');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', () => {
    const open = nav.dataset.open === 'true';
    nav.dataset.open = String(!open);
    toggle.setAttribute('aria-expanded', String(!open));
  });

  // Close the drawer when a link inside it is followed.
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      nav.dataset.open = 'false';
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && nav.dataset.open === 'true') {
      nav.dataset.open = 'false';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    }
  });
}

// --- auth-aware header ----------------------------------------------------

function initAuthState() {
  const slot = document.querySelector('[data-auth-slot]');
  if (!slot) return;

  const user = store.user;
  slot.innerHTML = '';

  if (user) {
    const account = document.createElement('a');
    account.href = '/app/account';
    account.className = 'btn btn-ghost';
    account.textContent = 'My account';

    const signOut = document.createElement('button');
    signOut.type = 'button';
    signOut.className = 'btn btn-primary';
    signOut.textContent = 'Sign out';
    signOut.addEventListener('click', async () => {
      signOut.disabled = true;
      try {
        await authApi.logout();
      } catch {
        // Sign out locally even if the server call failed — the token is dropped either way.
      }
      store.clear();
      window.location.href = '/';
    });

    slot.append(account, signOut);
  } else {
    const signIn = document.createElement('a');
    signIn.href = '/login.html';
    signIn.className = 'btn btn-ghost';
    signIn.textContent = 'Sign in';

    const signUp = document.createElement('a');
    signUp.href = '/register.html';
    signUp.className = 'btn btn-primary';
    signUp.textContent = 'Get started';

    slot.append(signIn, signUp);
  }
}

// --- domain search --------------------------------------------------------

function initDomainSearch() {
  const form = document.querySelector('[data-domain-form]');
  if (!form) return;

  const input = form.querySelector('input[name="domain"]');
  const result = document.querySelector('[data-domain-result]');
  const submit = form.querySelector('button[type="submit"]');

  const setState = (state, message) => {
    result.dataset.state = state;
    result.textContent = message;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const raw = input.value.trim().toLowerCase();
    if (!raw) {
      setState('error', 'Enter a domain name to search.');
      return;
    }

    // Accept "example" or "example.com" — normalise to a bare label plus optional TLD.
    const cleaned = raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    const hasTld = cleaned.includes('.');

    submit.disabled = true;
    setState('checking', `Checking ${cleaned}…`);

    try {
      // The domain availability endpoint belongs to the domain-services domain. Until that
      // domain is ported, this degrades to honest client-side validation rather than inventing
      // an answer — see MIGRATION.md "Domain availability".
      const data = await fetch(`/api/v1/domains/availability?domain=${encodeURIComponent(cleaned)}`, {
        headers: { Accept: 'application/json' },
      }).then((r) => (r.ok ? r.json() : null));

      if (data && typeof data.available === 'boolean') {
        if (data.available) {
          setState('available', `${cleaned} is available — ${data.price ?? ''}`.trim());
        } else {
          setState('taken', `${cleaned} is already registered. Try another name or a different extension.`);
        }
      } else {
        setState(
          hasTld ? 'error' : 'checking',
          hasTld
            ? 'Availability lookup is not available right now, please try again shortly.'
            : `Choose an extension for ${cleaned} to check availability.`
        );
      }
    } catch (err) {
      setState('error', describeError(err));
    } finally {
      submit.disabled = false;
    }
  });
}

// --- live pricing from the catalog API ------------------------------------

async function initPricing() {
  const container = document.querySelector('[data-pricing]');
  if (!container) return;

  try {
    let { products } = await fetch('/api/v1/catalog', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : { products: [] }));

    // Product pages scope the live plans to their own category; the home page shows everything.
    const category = container.dataset.category;
    if (category && Array.isArray(products)) {
      products = products.filter((p) => p.category === category);
    }

    if (!products || products.length === 0) {
      container.dataset.state = 'empty';
      return;
    }

    container.dataset.state = 'loaded';
    const list = container.querySelector('[data-pricing-list]');
    if (!list) return;

    list.innerHTML = '';
    for (const product of products.slice(0, 4)) {
      const plan = product.plans?.[0];
      const monthly = plan?.pricing?.find((p) => p.billingCycle === 'monthly');

      const card = document.createElement('div');
      card.className = 'card plan';

      const title = document.createElement('h3');
      title.textContent = product.name;

      const desc = document.createElement('p');
      desc.textContent = product.description ?? '';

      card.append(title, desc);

      if (monthly) {
        const price = document.createElement('div');
        price.className = 'price';
        price.innerHTML = '';
        const amount = document.createTextNode(`${monthly.currency} ${monthly.price.toFixed(2)}`);
        const period = document.createElement('span');
        period.textContent = ` /${monthly.billingCycle === 'monthly' ? 'mo' : monthly.billingCycle}`;
        price.append(amount, period);
        card.append(price);
      }

      if (plan?.features?.length) {
        const ul = document.createElement('ul');
        for (const feature of plan.features.slice(0, 6)) {
          const li = document.createElement('li');
          li.textContent = feature.value ? `${feature.label}: ${feature.value}` : feature.label;
          ul.append(li);
        }
        card.append(ul);
      }

      const cta = document.createElement('a');
      cta.className = 'btn btn-primary';
      cta.href = plan ? `/register.html?plan=${encodeURIComponent(plan.slug)}` : '/register.html';
      cta.textContent = 'Get started';
      card.append(cta);

      list.append(card);
    }
  } catch {
    container.dataset.state = 'error';
  }
}

// --- PWA ------------------------------------------------------------------

function initPwa() {
  if (!('serviceWorker' in navigator)) return;

  // Register after load so the worker never competes with first-paint resources.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Registration failure is not fatal: the site works without the worker.
    });
  });

  // Surface the browser's own install prompt instead of a custom banner.
  let deferredPrompt = null;
  const installButton = document.querySelector('[data-install-app]');

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (installButton) installButton.hidden = false;
  });

  installButton?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installButton.hidden = true;
  });

  window.addEventListener('appinstalled', () => {
    if (installButton) installButton.hidden = true;
  });
}

// --- misc -----------------------------------------------------------------

function initYear() {
  for (const el of document.querySelectorAll('[data-year]')) {
    el.textContent = String(new Date().getFullYear());
  }
}

/** Fill ?plan= from a pricing CTA into the registration form's product selector. */
function initPlanPrefill() {
  const params = new URLSearchParams(window.location.search);
  const plan = params.get('plan');
  if (!plan) return;
  const field = document.querySelector('[data-plan-field]');
  if (field) field.value = plan;
}

function init() {
  initNav();
  initAuthState();
  initDomainSearch();
  initPricing();
  initPwa();
  initYear();
  initPlanPrefill();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { init };
