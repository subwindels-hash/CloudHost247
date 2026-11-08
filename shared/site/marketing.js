/* CloudHost247 canonical marketing runtime. Shared by React and both Smarty themes.
 * No inline executable configuration, no third-party request before consent, one Meta owner.
 * Optional analytics is a consent category only; no analytics provider is installed here.
 */
(function (root) {
  'use strict';
  if (root.CloudHost247Marketing) return;
  var EVENTS = ['PageView','ViewContent','Search','AddToCart','InitiateCheckout','AddPaymentInfo','Purchase','CompleteRegistration','Lead','Contact'];
  var DATA_KEYS = ['content_ids','contents','content_type','content_name','content_category','currency','value','num_items'];
  var state = { config: null, consent: null, ready: false, initialized: null, lastPage: null, epoch: 0, requestRevision: 0, queue: [], seen: new Set(), error: null };
  var listeners = new Set();
  var options = { apiBase: '/api/v1/marketing', fetch: null, document: null, window: null, reportEvents: true };
  var initializationPromise = null;
  var seenKey = 'ch247.meta.dispatched.v1';
  var consentSignalKey = 'ch247.marketing-consent-changed.v1';
  var changeQueue = Promise.resolve();
  function win() { return options.window || root; }
  function doc() { return options.document || root.document; }
  function fetcher() { return options.fetch || root.fetch.bind(root); }
  function emit() { listeners.forEach(function (fn) { fn(snapshot()); }); }
  function snapshot() { return { ready: state.ready, configuration: state.config, consent: state.consent, error: state.error, initializedPixel: state.initialized }; }
  function endpoint(path) { return options.apiBase.replace(/\/$/, '') + path; }
  function storageRead() {
    try { var list = JSON.parse(win().sessionStorage.getItem(seenKey) || '[]'); return Array.isArray(list) ? list.filter(function (v) { return typeof v === 'string'; }).slice(-1000) : []; } catch (_) { return []; }
  }
  function remember(key) {
    state.seen.add(key);
    try { win().sessionStorage.setItem(seenKey, JSON.stringify(Array.from(state.seen).slice(-1000))); } catch (_) { /* private mode: memory + Meta eventID still deduplicate */ }
  }
  function validData(data) {
    var clean = {};
    DATA_KEYS.forEach(function (key) { if (data && data[key] !== undefined) clean[key] = data[key]; });
    if (clean.value !== undefined && (typeof clean.value !== 'number' || !isFinite(clean.value) || clean.value < 0 || !/^[A-Z]{3}$/.test(clean.currency || ''))) return null;
    if (clean.content_ids !== undefined && (!Array.isArray(clean.content_ids) || clean.content_ids.length > 100 || clean.content_ids.some(function (id) { return typeof id !== 'string' || !id || id.length > 128; }))) return null;
    if (clean.contents !== undefined && (!Array.isArray(clean.contents) || clean.contents.length > 100 || clean.contents.some(function (item) { return !item || typeof item.id !== 'string' || !item.id || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000; }))) return null;
    return clean;
  }
  function granted() { return Boolean(state.consent && state.consent.marketingGranted && state.config && state.config.enabled && /^[1-9][0-9]{4,31}$/.test(state.config.pixelId || '')); }
  function clearMetaCookies() {
    var document = doc();
    var hostname = win().location.hostname;
    var parts = hostname.split('.');
    var domains = ['', hostname];
    for (var i = 1; i < parts.length; i++) domains.push('.' + parts.slice(i).join('.'));
    ['_fbp','_fbc'].forEach(function (name) {
      domains.forEach(function (domain) {
        ['/', win().location.pathname].forEach(function (path) {
          document.cookie = name + '=; Max-Age=0; Path=' + path + (domain ? '; Domain=' + domain : '') + '; SameSite=Lax';
        });
      });
    });
  }
  function stop() {
    state.epoch++;
    state.queue = [];
    state.lastPage = null;
    var fbq = win().fbq;
    if (fbq && state.initialized) {
      try { fbq('consent', 'revoke'); } catch (_) { /* no subsequent tracking call is made */ }
    }
    state.initialized = null;
    clearMetaCookies();
  }
  // Test mode is a CAPI delivery setting (test_event_code). Meta's browser Pixel has no
  // documented fbq test-code parameter; browser verification uses the Test Events browser tab.
  // Never invent an fbq('set','testEventCode') call or send the code to the browser SDK.
  function loadMeta() {
    var w = win(), d = doc();
    if (!w.fbq) {
      var n = w.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!w._fbq) w._fbq = n;
      n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    }
    var id = 'ch247-meta-pixel-sdk';
    if (!d.getElementById(id)) {
      var script = d.createElement('script');
      script.id = id; script.async = true; script.src = 'https://connect.facebook.net/en_US/fbevents.js';
      script.setAttribute('data-owner', 'cloudhost247');
      script.onerror = function () { state.error = 'Meta SDK could not load. Check connectivity and Content Security Policy.'; emit(); };
      d.head.appendChild(script);
    }
    if (state.initialized !== state.config.pixelId) {
      // Official Pixel base-code initialization, with automatic matching and automatic config off.
      w.fbq('set', 'autoConfig', false, state.config.pixelId);
      w.fbq('consent', 'grant');
      w.fbq('init', state.config.pixelId);
      state.initialized = state.config.pixelId;
    } else w.fbq('consent', 'grant');
  }
  function dispatch(name, data, eventId, persistent) {
    if (name === 'Purchase' && persistent !== 'verified-receipt') return false;
    var clean = validData(data);
    if (!clean || EVENTS.indexOf(name) < 0 || typeof eventId !== 'string' || !/^[A-Za-z0-9:._-]{8,128}$/.test(eventId)) return false;
    if (!granted()) return false;
    var key = state.config.pixelId + ':' + name + ':' + eventId;
    if (state.seen.has(key)) return false;
    var epoch = state.epoch;
    var send = function () {
      if (epoch !== state.epoch || !granted()) return;
      loadMeta();
      try {
        win().fbq('trackSingle', state.config.pixelId, name, clean, { eventID: eventId });
        remember(key);
        if (options.reportEvents && name !== 'Purchase') {
          void fetcher()(endpoint('/browser-events'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Consent-CSRF': state.consent.csrfToken },
            body: JSON.stringify({ events: [{ eventName: name, eventId: eventId, customData: clean, sourceUrl: win().location.origin + win().location.pathname }] })
          }).catch(function () { state.error = 'Browser activity logging unavailable; this does not confirm or disprove Meta receipt.'; emit(); });
        }
      } catch (_) { state.error = 'Meta browser dispatch failed. No delivery success is assumed.'; emit(); }
    };
    if (state.ready) send(); else if (state.queue.length < 50) state.queue.push(send);
    return true;
  }
  function pageView(path) {
    path = String(path || win().location.pathname);
    if (!granted() || (state.lastPage === path || state.seen.has(state.config.pixelId + ':PageView:page:' + state.config.revision + ':' + path.replace(/[^A-Za-z0-9._-]/g,'_').slice(0,100)))) return false;
    var id = 'page:' + state.config.revision + ':' + path.replace(/[^A-Za-z0-9._-]/g,'_').slice(0,100);
    if (dispatch('PageView', {}, id, true)) { state.lastPage = path; return true; }
    return false;
  }
  function applyBootstrap(payload) {
    if (!payload || !payload.configuration || !payload.consent || typeof payload.consent.csrfToken !== 'string') throw new Error('Invalid marketing configuration response');
    var previouslyGranted = granted();
    state.config = payload.configuration; state.consent = payload.consent;
    if (!granted()) { if (previouslyGranted || state.initialized) stop(); state.ready = false; }
    else { state.ready = true; loadMeta(); pageView(); }
    var queued = state.queue.splice(0); if (granted()) queued.forEach(function (fn) { fn(); });
    state.error = null; emit();
  }
  function refresh() {
    var revision = ++state.requestRevision;
    return fetcher()(endpoint('/bootstrap'), { credentials: 'same-origin', cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('Marketing configuration unavailable'); return response.json();
    }).then(function (payload) {
      // A bootstrap fetched before withdrawal must never re-grant permission after it.
      if (revision !== state.requestRevision) return snapshot();
      applyBootstrap(payload); return snapshot();
    }).catch(function () {
      if (revision !== state.requestRevision) return snapshot();
      state.ready = false; state.config = null; state.consent = null; state.queue = [];
      if (state.initialized) stop();
      state.error = 'Cookie preferences could not be loaded. Optional tracking remains off.'; emit();
      return snapshot();
    });
  }
  function initialize(next) {
    if (initializationPromise) return initializationPromise;
    options = Object.assign(options, next || {});
    try { storageRead().forEach(function (key) { state.seen.add(key); }); } catch (_) { /* storage unavailable */ }
    var d = doc();
    d.addEventListener('click', function (event) {
      var target = event.target && event.target.closest && event.target.closest('[data-cookie-settings]');
      if (target) { event.preventDefault(); openPreferences(); }
    });
    win().addEventListener('ch247:cookie-settings', openPreferences);
    win().addEventListener('ch247:marketing-refresh', function () { void refresh(); });
    win().addEventListener('storage', function (event) {
      if (event.key !== consentSignalKey) return;
      // Other tabs fail closed immediately; the server refresh then restores only a current grant.
      state.requestRevision++; stop(); state.consent = null; state.ready = false; state.queue = [];
      state.error = 'Privacy choice changed in another tab. Refreshing your choice.'; emit();
      void refresh();
    });
    win().addEventListener('pagehide', function () { state.queue = []; });
    initializationPromise = refresh().then(function () { renderPreferences(); return api; });
    return initializationPromise;
  }
  function change(action, preferences) {
    // Serialize same-tab mutations so rapid Accept/Reject clicks cannot commit out of UI order.
    var task = function () { return performChange(action, preferences); };
    var result = changeQueue.then(task, task);
    changeQueue = result.then(function () {}, function () {});
    return result;
  }
  function performChange(action, preferences) {
    if (!state.consent) return refresh().then(function () { return Promise.reject(new Error(state.error || 'Preferences unavailable')); });
    var revision = ++state.requestRevision;
    return fetcher()(endpoint('/consent'), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Consent-CSRF': state.consent.csrfToken },
      body: JSON.stringify({ action: action, preferences: preferences, policyVersion: 1 })
    }).then(function (response) { return response.json().then(function (body) { if (!response.ok) throw new Error(body.message || 'Preferences could not be saved'); return body; }); }).then(function (body) {
      if (revision !== state.requestRevision || !body.consent) return snapshot();
      var previouslyGranted = granted();
      state.consent = body.consent;
      try { win().localStorage.setItem(consentSignalKey, String(Date.now()) + ':' + Math.random()); } catch (_) { /* storage unavailable */ }
      if (!granted()) { stop(); state.ready = false; if (previouslyGranted) win().location.reload(); }
      else { state.ready = true; loadMeta(); pageView(); var queued = state.queue.splice(0); queued.forEach(function (fn) { fn(); }); }
      emit(); return snapshot();
    });
  }
  var dialogReturnFocus = null;
  function renderPreferences() {
    var d = doc();
    if (d.getElementById('ch247-cookie-preferences')) return;
    var region = d.createElement('div'); region.id = 'ch247-cookie-preferences';
    region.innerHTML = '<section class="ch247-cookie-banner" role="region" aria-label="Cookie choices"><div><h2>Your privacy choices</h2><p>Essential cookies keep the website working. Optional analytics and Meta advertising cookies are off until you allow them. You can change your choice at any time.</p><p class="ch247-cookie-status" role="status"></p></div><div class="ch247-cookie-actions"><button type="button" data-consent-action="accept_all" class="ch247-button">Accept All</button><button type="button" data-consent-action="reject_optional" class="ch247-button ch247-button--outline">Reject Optional Cookies</button><button type="button" data-consent-action="customize" class="ch247-button ch247-button--outline">Customize Preferences</button></div></section><dialog class="ch247-cookie-dialog" aria-labelledby="ch247-cookie-title"><form method="dialog"><h2 id="ch247-cookie-title">Cookie preferences</h2><p>Allow each optional purpose separately. Accepting terms, registering or checking out does not grant marketing permission.</p><fieldset><legend>Essential — always on</legend><p>Security, cart continuity and storing this privacy choice.</p><label><input type="checkbox" checked disabled> Essential cookies</label></fieldset><label class="ch247-cookie-toggle"><input name="analytics" type="checkbox"> Analytics cookies</label><p>Permission for optional measurement. No additional analytics provider is enabled by this Meta integration.</p><label class="ch247-cookie-toggle"><input name="marketing" type="checkbox"> Marketing cookies</label><p>Meta Pixel conversion measurement and advertising/retargeting. If enabled, Meta may receive browser identifiers and your interaction events.</p><p class="ch247-cookie-dialog-error" role="alert"></p><div class="ch247-cookie-actions"><button type="submit" class="ch247-button">Save Preferences</button><button type="button" data-consent-action="withdraw" class="ch247-button ch247-button--outline">Withdraw Consent</button><button type="button" data-consent-action="close" class="ch247-button ch247-button--outline">Cancel</button></div></form></dialog>';
    d.body.appendChild(region);
    var dialog = region.querySelector('dialog');
    var banner = region.querySelector('.ch247-cookie-banner');
    function sync() {
      banner.hidden = !state.consent || state.consent.decided;
      if (state.consent) {
        region.querySelector('[name=analytics]').checked = state.consent.preferences.analytics;
        region.querySelector('[name=marketing]').checked = state.consent.preferences.marketing;
      }
      region.querySelector('.ch247-cookie-status').textContent = state.error || '';
    }
    function fail(error) { region.querySelector('.ch247-cookie-dialog-error').textContent = error.message || 'Could not save preferences'; sync(); }
    region.addEventListener('click', function (event) {
      var button = event.target.closest('[data-consent-action]'); if (!button) return;
      var action = button.getAttribute('data-consent-action');
      if (action === 'customize') { dialogReturnFocus = button; dialog.showModal(); return; }
      if (action === 'close') { dialog.close(); return; }
      button.disabled = true;
      var prefs = action === 'save_preferences' ? { essential: true, analytics: region.querySelector('[name=analytics]').checked, marketing: region.querySelector('[name=marketing]').checked } : undefined;
      void change(action, prefs).then(function () { if (dialog.open) dialog.close(); }).catch(fail).finally(function () { button.disabled = false; sync(); });
    });
    region.querySelector('form').addEventListener('submit', function (event) {
      event.preventDefault();
      void change('save_preferences', { essential: true, analytics: region.querySelector('[name=analytics]').checked, marketing: region.querySelector('[name=marketing]').checked }).then(function () { dialog.close(); }).catch(fail);
    });
    dialog.addEventListener('close', function () { if (dialogReturnFocus && dialogReturnFocus.isConnected) dialogReturnFocus.focus(); else d.querySelector('[data-cookie-settings]')?.focus(); });
    listeners.add(sync); sync();
  }
  function openPreferences() {
    renderPreferences();
    var dialog = doc().getElementById('ch247-cookie-preferences').querySelector('dialog');
    dialogReturnFocus = doc().activeElement;
    if (!dialog.open) dialog.showModal();
    if (!state.consent) void refresh();
  }
  function track(name, data, eventId) { return dispatch(name, data || {}, eventId || 'event:' + Date.now() + ':' + Math.random().toString(36).slice(2), false); }
  function purchase(receipt) {
    if (!receipt || receipt.verified !== true || receipt.status !== 'successful' || !receipt.eventId || !receipt.customData) return false;
    return dispatch('Purchase', receipt.customData, receipt.eventId, 'verified-receipt');
  }
  var api = { initialize: initialize, refresh: refresh, ready: function () { return initializationPromise || Promise.resolve(api); }, snapshot: snapshot,
    subscribe: function (fn) { listeners.add(fn); fn(snapshot()); return function () { listeners.delete(fn); }; },
    track: track, trackPurchase: purchase, pageView: pageView, openPreferences: openPreferences,
    acceptAll: function () { return change('accept_all'); }, rejectOptional: function () { return change('reject_optional'); },
    savePreferences: function (preferences) { return change('save_preferences', preferences); }, withdrawConsent: function () { return change('withdraw'); }
  };
  root.CloudHost247Marketing = api;
  // Smarty uses an external deferred script with a non-executable data attribute (CSP-safe).
  // React calls initialize explicitly after importing this same source.
  var current = root.document && root.document.currentScript;
  var apiBase = current && current.getAttribute('data-marketing-api');
  if (apiBase && apiBase.charAt(0) === '/' && apiBase.charAt(1) !== '/') void initialize({ apiBase: apiBase });
})(typeof window !== 'undefined' ? window : globalThis);
