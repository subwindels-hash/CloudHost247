/* CloudHost247 canonical marketing runtime. Shared by React and both Smarty themes.
 * No inline executable configuration, no optional third-party request before consent.
 * One shared owner coordinates Meta, Google Ads, legacy GA4/GTM and Baidu runtime loading.
 */
(function (root) {
  'use strict';
  if (root.CloudHost247Marketing) return;
  var EVENTS = ['PageView','ViewContent','Search','AddToCart','InitiateCheckout','AddPaymentInfo','Purchase','CompleteRegistration','Lead','Contact'];
  var DATA_KEYS = ['content_ids','contents','content_type','content_name','content_category','currency','value','num_items'];
  var state = { config: null, ads: null, consent: null, ready: false, initialized: null, initializedGoogle: null, initializedGa4: null, initializedGtm: false, initializedBaidu: false, googleConsentDefaultSet: false, googleLibraryLoaded: false, dataLayerStarted: false, lastPage: null, epoch: 0, requestRevision: 0, queue: [], seen: new Set(), error: null };
  var listeners = new Set();
  var options = { apiBase: '/api/v1/marketing', ga4Id: '', gtmId: '', baiduId: '', fetch: null, document: null, window: null, reportEvents: true };
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
  function consentGranted() { return Boolean(state.consent && state.consent.marketingGranted); }
  function analyticsGranted() { return Boolean(state.consent && state.consent.preferences && state.consent.preferences.analytics); }
  function ga4Granted() { return Boolean(analyticsGranted() && /^(G-[A-Z0-9]+|UA-[0-9]+-[0-9]+)$/i.test(options.ga4Id || '')); }
  function gtmGranted() { return Boolean(analyticsGranted() && consentGranted() && /^GTM-[A-Z0-9]+$/i.test(options.gtmId || '')); }
  function baiduGranted() { return Boolean(analyticsGranted() && /^[a-fA-F0-9]{16,64}$/.test(options.baiduId || '')); }
  function analyticsProviderGranted() { return ga4Granted() || gtmGranted() || baiduGranted(); }
  function metaGranted() { return Boolean(consentGranted() && state.config && state.config.enabled && /^[1-9][0-9]{4,31}$/.test(state.config.pixelId || '')); }
  function adsGranted() { return Boolean(consentGranted() && state.ads && state.ads.enabled && /^AW-\d{5,20}$/.test(state.ads.destination || '')); }
  function granted() { return metaGranted() || adsGranted(); }
  function googleConsentState() {
    var ad = consentGranted();
    var analytics = analyticsGranted();
    return { ad_storage: ad ? 'granted' : 'denied', analytics_storage: analytics ? 'granted' : 'denied', ad_user_data: ad ? 'granted' : 'denied', ad_personalization: ad && state.ads && state.ads.remarketingEnabled ? 'granted' : 'denied' };
  }
  function ensureGoogleQueue() {
    var w = win();
    w.dataLayer = w.dataLayer || [];
    if (!w.gtag) w.gtag = function () { w.dataLayer.push(arguments); };
    // Consent defaults are queued once, before either Google tag or GTM can execute.
    if (!state.googleConsentDefaultSet) {
      w.gtag('consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
      state.googleConsentDefaultSet = true;
    }
    w.gtag('consent', 'update', googleConsentState());
    return w;
  }
  function loadGoogleLibrary(destination) {
    var w = ensureGoogleQueue(), d = doc();
    if (!d.getElementById('ch247-google-tag')) {
      var script = d.createElement('script'); script.id = 'ch247-google-tag'; script.async = true;
      script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(destination);
      script.setAttribute('data-owner', 'cloudhost247');
      script.onerror = function () { state.error = 'Google tag could not load. Check connectivity and the Content Security Policy.'; emit(); };
      d.head.appendChild(script);
    }
    if (!state.googleLibraryLoaded) { w.gtag('js', new Date()); state.googleLibraryLoaded = true; }
    return w;
  }
  function loadGoogleAds() {
    if (!adsGranted()) return;
    var w = loadGoogleLibrary(state.ads.destination);
    if (state.initializedGoogle !== state.ads.destination) {
      w.gtag('config', state.ads.destination, { allow_ad_personalization_signals: Boolean(state.ads.remarketingEnabled && consentGranted()), send_page_view: false });
      state.initializedGoogle = state.ads.destination;
    }
  }
  function loadGa4() {
    if (!ga4Granted()) return;
    var w = loadGoogleLibrary(options.ga4Id);
    if (state.initializedGa4 !== options.ga4Id) {
      w.gtag('config', options.ga4Id, { send_page_view: false });
      state.initializedGa4 = options.ga4Id;
    }
  }
  function loadGtm() {
    if (!gtmGranted() || state.initializedGtm) return;
    var w = ensureGoogleQueue(), d = doc();
    if (!state.dataLayerStarted) { w.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' }); state.dataLayerStarted = true; }
    if (!d.getElementById('ch247-google-tag-manager')) {
      var script = d.createElement('script'); script.id = 'ch247-google-tag-manager'; script.async = true;
      script.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(options.gtmId);
      script.setAttribute('data-owner', 'cloudhost247');
      script.onerror = function () { state.error = 'Google Tag Manager could not load. Check connectivity and the Content Security Policy.'; emit(); };
      d.head.appendChild(script);
    }
    state.initializedGtm = true;
  }
  function loadBaidu() {
    if (!baiduGranted() || state.initializedBaidu) return;
    var w = win(), d = doc(); w._hmt = w._hmt || [];
    if (!d.getElementById('ch247-baidu-analytics')) {
      var script = d.createElement('script'); script.id = 'ch247-baidu-analytics'; script.async = true;
      script.src = 'https://hm.baidu.com/hm.js?' + encodeURIComponent(options.baiduId);
      d.head.appendChild(script);
    }
    state.initializedBaidu = true;
  }
  function loadAnalytics() { loadGa4(); loadGtm(); loadBaidu(); }
  function sendGa4PageView(path) {
    if (!ga4Granted()) return false;
    loadGa4();
    var safePath = String(path || win().location.pathname).split(/[?#]/)[0].slice(0,1024) || '/';
    var key = 'ga4:' + options.ga4Id + ':page:' + safePath;
    if (state.seen.has(key)) return false;
    try { win().gtag('event', 'page_view', { send_to: options.ga4Id, page_location: win().location.origin + safePath, page_title: String(doc().title || '').slice(0,200) }); remember(key); return true; }
    catch (_) { state.error = 'GA4 page view dispatch failed; no provider delivery success is assumed.'; emit(); return false; }
  }
  function sendGoogleConversion(name, data, eventId, googleItems) {
    if (!adsGranted()) return false;
    var actionName = ({ Purchase:'purchase', Lead:'lead', Contact:'contact', CompleteRegistration:'sign_up', InitiateCheckout:'begin_checkout', AddToCart:'add_to_cart' })[name];
    var action = actionName && state.ads.actions && state.ads.actions[actionName];
    if (!action || !action.label) return false;
    var key = 'google:' + state.ads.destination + ':' + actionName + ':' + eventId;
    if (state.seen.has(key)) return false;
    loadGoogleAds();
    var payload = { send_to: state.ads.destination + '/' + action.label, transaction_id: eventId };
    if (data && typeof data.value === 'number' && /^[A-Z]{3}$/.test(data.currency || '')) { payload.value = data.value; payload.currency = data.currency; }
    if (name === 'Purchase' && Array.isArray(googleItems)) payload.items = googleItems.filter(function (item) { return item && typeof item.id === 'string' && item.id.length <= 128 && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 1000; }).slice(0,100).map(function (item) { return { id: item.id, google_business_vertical: 'custom', quantity: item.quantity, ...(typeof item.name === 'string' && item.name.length <= 255 ? { name: item.name } : {}) }; });
    if (name === 'Purchase' && (!data || typeof data.value !== 'number' || !/^[A-Z]{3}$/.test(data.currency || ''))) return false;
    try { win().gtag('event', 'conversion', payload); remember(key); return true; }
    catch (_) { state.error = 'Google Ads conversion dispatch failed. No provider delivery success is assumed.'; emit(); return false; }
  }
  function updateGoogleConsent() {
    if (state.googleConsentDefaultSet && win().gtag) {
      try { win().gtag('consent', 'update', googleConsentState()); } catch (_) { /* optional tracking fails closed */ }
    }
  }
  function sendGooglePageView(path) {
    if (!adsGranted() || !state.ads.remarketingEnabled) return false;
    loadGoogleAds();
    var safePath = String(path || win().location.pathname).split(/[?#]/)[0].slice(0,1024) || '/';
    var key = 'google:' + state.ads.destination + ':page:' + safePath;
    if (state.seen.has(key)) return false;
    try { win().gtag('event', 'page_view', { send_to: state.ads.destination, page_location: win().location.origin + safePath, page_title: String(doc().title || '').slice(0,200) }); remember(key); return true; }
    catch (_) { state.error = 'Google Ads remarketing dispatch failed. No provider delivery success is assumed.'; emit(); return false; }
  }
  function sendGoogleRemarketingEvent(name, data) {
    if (!adsGranted() || !state.ads.remarketingEnabled) return;
    var eventName = ({ ViewContent:'view_item', AddToCart:'add_to_cart', InitiateCheckout:'begin_checkout' })[name];
    if (!eventName) return;
    loadGoogleAds();
    var payload = { send_to: state.ads.destination };
    if (Array.isArray(data.content_ids)) payload.items = data.content_ids.map(function (id, i) { return { item_id: id, quantity: data.contents && data.contents[i] ? data.contents[i].quantity : 1 }; });
    if (typeof data.value === 'number' && /^[A-Z]{3}$/.test(data.currency || '')) { payload.value = data.value; payload.currency = data.currency; }
    try { win().gtag('event', eventName, payload); } catch (_) { /* remarketing is optional; do not affect the user operation */ }
  }
  function clearGoogleCookies() {
    var d = doc(), host = win().location.hostname, parts = host.split('.'), domains = ['', host];
    for (var i = 1; i < parts.length; i++) domains.push('.' + parts.slice(i).join('.'));
    ['_gcl_au','_gcl_aw','_gcl_dc'].forEach(function (name) { domains.forEach(function (domain) { d.cookie = name + '=; Max-Age=0; Path=/' + (domain ? '; Domain=' + domain : '') + '; SameSite=Lax'; }); });
  }
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
  function stopMeta() {
    var fbq = win().fbq;
    if (fbq && state.initialized) { try { fbq('consent', 'revoke'); } catch (_) { /* no subsequent tracking call is made */ } }
    state.initialized = null; clearMetaCookies();
  }
  function stopGoogle() {
    updateGoogleConsent(); state.initializedGoogle = null; clearGoogleCookies();
  }
  function stopAnalyticsProviders() {
    state.initializedGa4 = null; state.initializedGtm = false; state.initializedBaidu = false;
  }
  function stop() {
    state.epoch++; state.queue = []; state.lastPage = null;
    stopMeta(); stopGoogle(); stopAnalyticsProviders();
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
  function dispatch(name, data, eventId, persistent, googleItems) {
    if (name === 'Purchase' && persistent !== 'verified-receipt') return false;
    var clean = validData(data);
    if (!clean || EVENTS.indexOf(name) < 0 || typeof eventId !== 'string' || !/^[A-Za-z0-9:._-]{8,128}$/.test(eventId)) return false;
    if (!granted()) return false;
    var metaKey = metaGranted() ? state.config.pixelId + ':' + name + ':' + eventId : null;
    var adsAction = ({ Purchase:'purchase', Lead:'lead', Contact:'contact', CompleteRegistration:'sign_up', InitiateCheckout:'begin_checkout', AddToCart:'add_to_cart' })[name];
    var adsActionConfig = adsAction && state.ads && state.ads.actions && state.ads.actions[adsAction];
    var adsKey = adsGranted() && adsActionConfig && adsActionConfig.label ? 'google:' + state.ads.destination + ':' + adsAction + ':' + eventId : null;
    if ((!metaKey || state.seen.has(metaKey)) && (!adsKey || state.seen.has(adsKey))) return false;
    var epoch = state.epoch;
    var send = function () {
      if (epoch !== state.epoch || !granted()) return;
      if (metaKey && !state.seen.has(metaKey) && metaGranted()) {
        loadMeta();
        try {
          win().fbq('trackSingle', state.config.pixelId, name, clean, { eventID: eventId });
          remember(metaKey);
          if (options.reportEvents && name !== 'Purchase') {
            void fetcher()(endpoint('/browser-events'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Consent-CSRF': state.consent.csrfToken },
              body: JSON.stringify({ events: [{ eventName: name, eventId: eventId, customData: clean, sourceUrl: win().location.origin + win().location.pathname }] })
            }).catch(function () { state.error = 'Browser activity logging unavailable; this does not confirm or disprove Meta receipt.'; emit(); });
          }
        } catch (_) { state.error = 'Meta browser dispatch failed. No delivery success is assumed.'; emit(); }
      }
      if (adsKey && !state.seen.has(adsKey)) sendGoogleConversion(name, clean, eventId, googleItems);
      sendGoogleRemarketingEvent(name, clean);
    };
    if (state.ready) send(); else if (state.queue.length < 50) state.queue.push(send);
    return true;
  }
  function pageView(path) {
    path = String(path || win().location.pathname);
    var googleTracked = sendGooglePageView(path);
    var analyticsTracked = sendGa4PageView(path);
    if (!metaGranted()) return googleTracked || analyticsTracked;
    if (state.lastPage === path || state.seen.has(state.config.pixelId + ':PageView:page:' + state.config.revision + ':' + path.replace(/[^A-Za-z0-9._-]/g,'_').slice(0,100))) return googleTracked || analyticsTracked;
    var id = 'page:' + state.config.revision + ':' + path.replace(/[^A-Za-z0-9._-]/g,'_').slice(0,100);
    if (dispatch('PageView', {}, id, true)) { state.lastPage = path; return true; }
    return googleTracked || analyticsTracked;
  }
  function applyBootstrap(payload) {
    if (!payload || !payload.configuration || !payload.consent || typeof payload.consent.csrfToken !== 'string') throw new Error('Invalid marketing configuration response');
    var previouslyGranted = granted(), previouslyMeta = metaGranted(), previouslyAds = adsGranted(), previouslyAnalyticsProviders = analyticsProviderGranted(), previouslyGa4 = ga4Granted(), previouslyGtm = gtmGranted(), previouslyBaidu = baiduGranted();
    state.config = payload.configuration; state.ads = payload.googleAds || null; state.consent = payload.consent;
    if (!metaGranted() && previouslyMeta) stopMeta();
    if (!adsGranted() && previouslyAds) stopGoogle();
    var analyticsRevoked = previouslyGa4 && !ga4Granted() || previouslyGtm && !gtmGranted() || previouslyBaidu && !baiduGranted();
    if (analyticsRevoked) { if (!ga4Granted()) state.initializedGa4=null; if (!gtmGranted()) state.initializedGtm=false; if (!baiduGranted()) state.initializedBaidu=false; }
    if (!analyticsProviderGranted() && previouslyAnalyticsProviders) stopAnalyticsProviders();
    if (!granted() && !analyticsProviderGranted()) { if (previouslyGranted || previouslyAnalyticsProviders || state.initialized || state.initializedGoogle || state.initializedGa4 || state.initializedGtm || state.initializedBaidu) stop(); state.ready = false; }
    else { state.ready = true; if (metaGranted()) loadMeta(); if (adsGranted()) loadGoogleAds(); if (analyticsProviderGranted()) loadAnalytics(); pageView(); }
    updateGoogleConsent();
    var queued = state.queue.splice(0); if (granted()) queued.forEach(function (fn) { fn(); });
    state.error = null; emit();
    if (analyticsRevoked) win().location.reload();
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
      if (state.initialized || state.initializedGoogle || state.initializedGa4 || state.initializedGtm || state.initializedBaidu) stop();
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
      var reloadTags = Boolean(state.initialized || state.initializedGoogle || state.initializedGa4 || state.initializedGtm || state.initializedBaidu);
      state.requestRevision++; state.consent = null; stop(); state.ready = false; state.queue = [];
      state.error = 'Privacy choice changed in another tab. Refreshing your choice.'; emit();
      if (reloadTags) win().location.reload();
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
      var previouslyGranted = granted(), previouslyAnalyticsProviders = analyticsProviderGranted(), previouslyGa4 = ga4Granted(), previouslyGtm = gtmGranted(), previouslyBaidu = baiduGranted();
      state.consent = body.consent;
      try { win().localStorage.setItem(consentSignalKey, String(Date.now()) + ':' + Math.random()); } catch (_) { /* storage unavailable */ }
      if (!metaGranted()) stopMeta();
      if (!adsGranted()) stopGoogle();
      if (!ga4Granted() && previouslyGa4) state.initializedGa4 = null;
      if (!gtmGranted() && previouslyGtm) state.initializedGtm = false;
      if (!baiduGranted() && previouslyBaidu) state.initializedBaidu = false;
      var analyticsRevoked = previouslyGa4 && !ga4Granted() || previouslyGtm && !gtmGranted() || previouslyBaidu && !baiduGranted();
      if (!analyticsProviderGranted()) stopAnalyticsProviders();
      updateGoogleConsent();
      if (!granted() && !analyticsProviderGranted()) { stop(); state.ready = false; if (previouslyGranted || previouslyAnalyticsProviders) win().location.reload(); }
      else {
        state.ready = true; if (metaGranted()) loadMeta(); if (adsGranted()) loadGoogleAds(); if (analyticsProviderGranted()) loadAnalytics();
        pageView();
        if (analyticsRevoked) win().location.reload();
        var queued = state.queue.splice(0); if (granted()) queued.forEach(function (fn) { fn(); });
      }
      emit(); return snapshot();
    });
  }
  var dialogReturnFocus = null;
  function renderPreferences() {
    var d = doc();
    if (d.getElementById('ch247-cookie-preferences')) return;
    var region = d.createElement('div'); region.id = 'ch247-cookie-preferences';
    region.innerHTML = '<section class="ch247-cookie-banner" role="region" aria-label="Cookie choices"><div><h2>Your privacy choices</h2><p>Essential cookies keep the website working. Optional analytics and advertising measurement cookies are off until you allow them. You can change your choice at any time.</p><p class="ch247-cookie-status" role="status"></p></div><div class="ch247-cookie-actions"><button type="button" data-consent-action="accept_all" class="ch247-button">Accept All</button><button type="button" data-consent-action="reject_optional" class="ch247-button ch247-button--outline">Reject Optional Cookies</button><button type="button" data-consent-action="customize" class="ch247-button ch247-button--outline">Customize Preferences</button></div></section><dialog class="ch247-cookie-dialog" aria-labelledby="ch247-cookie-title"><form method="dialog"><h2 id="ch247-cookie-title">Cookie preferences</h2><p>Allow each optional purpose separately. Accepting terms, registering or checking out does not grant marketing permission.</p><fieldset><legend>Essential — always on</legend><p>Security, cart continuity and storing this privacy choice.</p><label><input type="checkbox" checked disabled> Essential cookies</label></fieldset><label class="ch247-cookie-toggle"><input name="analytics" type="checkbox"> Analytics cookies</label><p>Permission for optional analytics measurement. Configured GA4 uses this choice; Google analytics_storage follows it. Google Ads does not create a GA4 property.</p><label class="ch247-cookie-toggle"><input name="marketing" type="checkbox"> Marketing cookies</label><p>Consent-aware Meta Pixel and Google Ads conversion measurement; optional remarketing signals where configured. Google ad_storage, ad_user_data and ad_personalization follow this choice. No passwords, payment details or contact data are sent.</p><p class="ch247-cookie-dialog-error" role="alert"></p><div class="ch247-cookie-actions"><button type="submit" class="ch247-button">Save Preferences</button><button type="button" data-consent-action="withdraw" class="ch247-button ch247-button--outline">Withdraw Consent</button><button type="button" data-consent-action="close" class="ch247-button ch247-button--outline">Cancel</button></div></form></dialog>';
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
    return dispatch('Purchase', receipt.customData, receipt.eventId, 'verified-receipt', Array.isArray(receipt.googleItems) ? receipt.googleItems : []);
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
  if (apiBase && (apiBase.charAt(0) === '/' && apiBase.charAt(1) !== '/' || /^https:\/\//i.test(apiBase))) void initialize({ apiBase: apiBase,
    ga4Id: current.getAttribute('data-ga4-id') || '', gtmId: current.getAttribute('data-gtm-id') || '', baiduId: current.getAttribute('data-baidu-id') || '' });
})(typeof window !== 'undefined' ? window : globalThis);
