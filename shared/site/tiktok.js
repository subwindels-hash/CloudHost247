/* CloudHost247 TikTok Pixel runtime. Shared by React and both Smarty themes.
 * Consent is owned by the single CloudHost247 cookie consent manager
 * (marketing.js / /api/v1/marketing/bootstrap): this runtime only reads the
 * shared consent state from the TikTok bootstrap, which derives from the same
 * consent session. No TikTok library is requested and no event is sent before
 * marketing consent. No pixel ID is hardcoded here.
 */
(function (root) {
  'use strict';
  if (root.CloudHost247TikTok) return;
  var EVENTS = ['PageView','ViewContent','Search','AddToCart','InitiateCheckout','AddPaymentInfo','PlaceAnOrder','CompletePayment','SubmitForm','CompleteRegistration','Contact','Subscribe'];
  var DATA_KEYS = ['content_ids','contents','content_type','content_name','content_category','currency','value','num_items'];
  var state = { config: null, consent: null, ready: false, initialized: null, lastPage: null, epoch: 0, requestRevision: 0, queue: [], seen: new Set(), error: null };
  var listeners = new Set();
  var options = { apiBase: '/api/v1/marketing', fetch: null, document: null, window: null, reportEvents: true };
  var initializationPromise = null;
  var seenKey = 'ch247.tiktok.dispatched.v1';
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
    try { win().sessionStorage.setItem(seenKey, JSON.stringify(Array.from(state.seen).slice(-1000))); } catch (_) { /* private mode: memory + TikTok event_id still deduplicate */ }
  }
  function validData(data) {
    var clean = {};
    DATA_KEYS.forEach(function (key) { if (data && data[key] !== undefined) clean[key] = data[key]; });
    if (clean.value !== undefined && (typeof clean.value !== 'number' || !isFinite(clean.value) || clean.value < 0 || !/^[A-Z]{3}$/.test(clean.currency || ''))) return null;
    if (clean.content_ids !== undefined && (!Array.isArray(clean.content_ids) || clean.content_ids.length > 100 || clean.content_ids.some(function (id) { return typeof id !== 'string' || !id || id.length > 128; }))) return null;
    if (clean.contents !== undefined && (!Array.isArray(clean.contents) || clean.contents.length > 100 || clean.contents.some(function (item) { return !item || typeof item.id !== 'string' || !item.id || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000; }))) return null;
    return clean;
  }
  function toProperties(clean) {
    var properties = {};
    Object.keys(clean).forEach(function (key) { if (key !== 'contents') properties[key] = clean[key]; });
    if (clean.contents) properties.contents = clean.contents.map(function (item) {
      var out = { content_id: item.id, quantity: item.quantity };
      if (item.item_price !== undefined) out.price = item.item_price;
      return out;
    });
    return properties;
  }
  function eventEnabled(name) { return Boolean(state.config && state.config.enabledEvents && state.config.enabledEvents.indexOf(name) >= 0); }
  function granted() { return Boolean(state.consent && state.consent.marketingGranted && state.config && state.config.enabled && /^[A-Za-z0-9]{16,32}$/.test(state.config.pixelId || '')); }
  function clearTikTokCookies() {
    var document = doc();
    var hostname = win().location.hostname;
    var parts = hostname.split('.');
    var domains = ['', hostname];
    for (var i = 1; i < parts.length; i++) domains.push('.' + parts.slice(i).join('.'));
    ['_ttp', 'ttclid'].forEach(function (name) {
      domains.forEach(function (domain) {
        document.cookie = name + '=; Max-Age=0; Path=/' + (domain ? '; Domain=' + domain : '') + '; SameSite=Lax';
      });
    });
  }
  function stop() {
    state.epoch++;
    state.queue = [];
    state.lastPage = null;
    state.initialized = null;
    clearTikTokCookies();
  }
  /* Official TikTok Pixel installation: the ttq stub queues calls until the
   * official library (analytics.tiktok.com/i18n/pixel/events.js) loads.
   * Loaded only after consent; test_event_code is passed only in test mode so
   * test traffic never pollutes production reporting. */
  function loadTikTok() {
    var w = win(), d = doc();
    if (!w.ttq) {
      w.ttq = w.ttq || [];
      w.ttq.methods = ['track','page','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie'];
      w.ttq.factory = function (t) { return function () { w.ttq.push([t].concat(Array.prototype.slice.call(arguments))); }; };
      w.ttq.methods.forEach(function (t) { w.ttq[t] = w.ttq.factory(t); });
      w.ttq.load = function (e, n) {
        var r = 'https://analytics.tiktok.com/i18n/pixel/events.js';
        var o = n && n.partner; w._ttq = w._ttq || []; w._ttq.push(e);
        var script = d.createElement('script');
        script.type = 'text/javascript'; script.async = true;
        script.src = r + '?sdkid=' + encodeURIComponent(e) + '&lib=ttq';
        script.id = 'ch247-tiktok-pixel-sdk'; script.setAttribute('data-owner', 'cloudhost247');
        if (o) script.setAttribute('data-partner', o);
        script.onerror = function () { state.error = 'TikTok Pixel library could not load. Check connectivity and Content Security Policy.'; emit(); };
        var first = d.getElementsByTagName('script')[0];
        if (first && first.parentNode) first.parentNode.insertBefore(script, first); else d.head.appendChild(script);
      };
    }
    if (state.initialized !== state.config.pixelId) {
      w.ttq.load(state.config.pixelId);
      state.initialized = state.config.pixelId;
    }
  }
  function dispatch(name, data, eventId, persistent) {
    if (name === 'CompletePayment' && persistent !== 'verified-receipt') return false;
    var clean = validData(data);
    if (!clean || EVENTS.indexOf(name) < 0 || !eventEnabled(name) || typeof eventId !== 'string' || !/^[A-Za-z0-9:._-]{8,128}$/.test(eventId)) return false;
    if (!granted()) return false;
    // ViewContent carries the product context used for remarketing audiences.
    if (name === 'ViewContent' && !state.config.remarketingEnabled && persistent !== 'standard') { /* ViewContent remains a standard event; remarketing gates audience use, documented in admin */ }
    var key = state.config.pixelId + ':' + name + ':' + eventId;
    if (state.seen.has(key)) return false;
    var epoch = state.epoch;
    var send = function () {
      if (epoch !== state.epoch || !granted()) return;
      loadTikTok();
      try {
        var optionsArg = { event_id: eventId };
        if (state.config.testMode && state.config.testEventCode) optionsArg.test_event_code = state.config.testEventCode;
        if (name === 'PageView') win().ttq.page();
        else win().ttq.track(name, toProperties(clean), optionsArg);
        remember(key);
        if (options.reportEvents && name !== 'CompletePayment') {
          void fetcher()(endpoint('/tiktok/browser-events'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Consent-CSRF': state.consent.csrfToken },
            body: JSON.stringify({ events: [{ eventName: name, eventId: eventId, customData: clean, sourceUrl: win().location.origin + win().location.pathname }] })
          }).catch(function () { state.error = 'Browser activity logging unavailable; this does not confirm or disprove TikTok receipt.'; emit(); });
        }
      } catch (_) { state.error = 'TikTok browser dispatch failed. No delivery success is assumed.'; emit(); }
    };
    if (state.ready) send(); else if (state.queue.length < 50) state.queue.push(send);
    return true;
  }
  function pageView(path) {
    path = String(path || win().location.pathname);
    if (!granted() || !eventEnabled('PageView')) return false;
    var id = 'page:' + state.config.revision + ':' + path.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
    if (state.lastPage === path || state.seen.has(state.config.pixelId + ':PageView:' + id)) return false;
    if (dispatch('PageView', {}, id, true)) { state.lastPage = path; return true; }
    return false;
  }
  function applyBootstrap(payload) {
    if (!payload || !payload.configuration || !payload.consent || typeof payload.consent.csrfToken !== 'string') throw new Error('Invalid TikTok configuration response');
    var previouslyGranted = granted();
    state.config = payload.configuration; state.consent = payload.consent;
    if (!granted()) { if (previouslyGranted || state.initialized) stop(); state.ready = false; }
    else { state.ready = true; loadTikTok(); pageView(); }
    var queued = state.queue.splice(0); if (granted()) queued.forEach(function (fn) { fn(); });
    state.error = null; emit();
  }
  function refresh() {
    var revision = ++state.requestRevision;
    return fetcher()(endpoint('/tiktok/bootstrap'), { credentials: 'same-origin', cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('TikTok configuration unavailable'); return response.json();
    }).then(function (payload) {
      if (revision !== state.requestRevision) return snapshot();
      applyBootstrap(payload); return snapshot();
    }).catch(function () {
      if (revision !== state.requestRevision) return snapshot();
      state.ready = false; state.config = null; state.consent = null; state.queue = [];
      if (state.initialized) stop();
      state.error = 'TikTok configuration could not be loaded. Optional tracking remains off.'; emit();
      return snapshot();
    });
  }
  function initialize(next) {
    if (initializationPromise) return initializationPromise;
    options = Object.assign(options, next || {});
    try { storageRead().forEach(function (key) { state.seen.add(key); }); } catch (_) { /* storage unavailable */ }
    win().addEventListener('ch247:marketing-refresh', function () { void refresh(); });
    win().addEventListener('storage', function (event) {
      if (event.key !== 'ch247.marketing-consent-changed.v1') return;
      state.requestRevision++; stop(); state.consent = null; state.ready = false; state.queue = [];
      void refresh();
    });
    win().addEventListener('pagehide', function () { state.queue = []; });
    initializationPromise = refresh().then(function () { return api; });
    return initializationPromise;
  }
  function track(name, data, eventId) { return dispatch(name, data || {}, eventId || 'event:' + Date.now() + ':' + Math.random().toString(36).slice(2), 'standard'); }
  function purchase(receipt) {
    if (!receipt || receipt.verified !== true || receipt.status !== 'successful' || !receipt.eventId || !receipt.customData) return false;
    return dispatch(receipt.eventName || 'CompletePayment', receipt.customData, receipt.eventId, 'verified-receipt');
  }
  var api = { initialize: initialize, refresh: refresh, ready: function () { return initializationPromise || Promise.resolve(api); }, snapshot: snapshot,
    subscribe: function (fn) { listeners.add(fn); fn(snapshot()); return function () { listeners.delete(fn); }; },
    track: track, trackPurchase: purchase, pageView: pageView };
  root.CloudHost247TikTok = api;
  var current = root.document && root.document.currentScript;
  var apiBase = current && current.getAttribute('data-marketing-api');
  if (apiBase && apiBase.charAt(0) === '/' && apiBase.charAt(1) !== '/') void initialize({ apiBase: apiBase });
})(typeof window !== 'undefined' ? window : globalThis);
