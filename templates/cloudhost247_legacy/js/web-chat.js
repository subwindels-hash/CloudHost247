/* CloudHost247 built-in live chat — first-party visitor widget.
 *
 * No third-party chat provider (Tawk.to, LiveChat, Zendesk) is embedded. Visitors talk directly
 * to the CloudHost247 platform service (`POST/GET /api/v1/web-chat/*`); staff answer from the
 * platform's Admin → Live Chat console. The visitor is identified by an opaque token stored in
 * this browser only; the server stores just its sha256 hash.
 *
 * Transport is short polling (every 4s while the panel is open) — deliberately simple and
 * proxy-friendly. Configured through the script tag's `data-web-chat-api` attribute:
 *
 *   <script src=".../web-chat.js" data-web-chat-api="https://app.cloudhost247.com" defer></script>
 *
 * With no (or an unreachable) API base the widget renders nothing rather than a broken shell. */
(function (root) {
  'use strict';

  if (root.CloudHost247WebChat) return;

  var script = document.currentScript;
  var apiBase = (script && script.getAttribute('data-web-chat-api') || '').replace(/\/+$/, '');
  // Accept either an absolute API origin (https://app.example.com) or a same-origin mount
  // path (e.g. /platform). Anything else renders nothing — fail closed, no broken shell.
  if (!/^https?:\/\/[^/]+/i.test(apiBase) && !/^\/(?:[a-zA-Z0-9_-]+\/?)*[a-zA-Z0-9_-]+$/.test(apiBase)) return;

  var STORAGE_KEY = 'ch247.webchat.v1';
  var POLL_MS = 4000;

  function storageRead() {
    try {
      var parsed = JSON.parse(root.localStorage.getItem(STORAGE_KEY) || 'null');
      return parsed && typeof parsed.token === 'string' ? parsed.token : null;
    } catch (_) { return null; }
  }
  function storageWrite(token) {
    try {
      if (token) root.localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: token }));
      else root.localStorage.removeItem(STORAGE_KEY);
    } catch (_) { /* private mode — the session just will not survive a reload */ }
  }

  function api(path, options) {
    var opts = options || {};
    return root.fetch(apiBase + '/api/v1/web-chat' + path, {
      method: opts.method || 'GET',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        opts.token ? { 'X-Web-Chat-Token': opts.token } : {}
      ),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'omit',
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) {
        if (!res.ok) {
          var err = new Error((body && body.message) || ('Chat request failed (HTTP ' + res.status + ')'));
          err.status = res.status;
          throw err;
        }
        return body;
      });
    });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function isSafeLink(url) {
    return (typeof url === 'string') && ((url.indexOf('/') === 0 && url.indexOf('//') !== 0) || /^https:\/\//i.test(url));
  }

  function timeLabel(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  var state = {
    token: storageRead(),
    conversation: null,
    lastSeq: 0,
    lastMessages: [],
    phase: 'intro', // 'intro' | 'ready'
    pollTimer: null,
    busy: false,
  };

  // --- DOM -----------------------------------------------------------------
  var wrap = el('div', 'ch247wc');
  var panel = el('section', 'ch247wc-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Live chat with CloudHost247 support');
  panel.hidden = true;

  var header = el('header', 'ch247wc-header');
  var headText = el('div');
  headText.appendChild(el('strong', null, 'Chat with us'));
  headText.appendChild(el('small', null, 'AI answers first — ask for a human any time'));
  var closeBtn = el('button', 'ch247wc-close', '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close chat');
  header.appendChild(headText);
  header.appendChild(closeBtn);

  var messages = el('div', 'ch247wc-messages');
  messages.setAttribute('aria-live', 'polite');

  var intro = el('div', 'ch247wc-intro');
  var introCopy = el('p', null, 'Hi! Ask us anything about hosting, domains, billing or migrations. We reply right here.');
  var introForm = el('form');
  var nameInput = el('input');
  nameInput.type = 'text'; nameInput.maxLength = 120; nameInput.placeholder = 'Name (optional)'; nameInput.autocomplete = 'name';
  nameInput.setAttribute('aria-label', 'Name (optional)');
  var emailInput = el('input');
  emailInput.type = 'email'; emailInput.maxLength = 255; emailInput.placeholder = 'Email (optional)'; emailInput.autocomplete = 'email';
  emailInput.setAttribute('aria-label', 'Email (optional)');
  var startBtn = el('button', null, 'Start chat');
  startBtn.type = 'submit';
  introForm.appendChild(nameInput);
  introForm.appendChild(emailInput);
  introForm.appendChild(startBtn);
  intro.appendChild(introCopy);
  intro.appendChild(introForm);

  var compose = el('form', 'ch247wc-compose');
  compose.hidden = true;
  var composeInput = el('input');
  composeInput.type = 'text'; composeInput.maxLength = 2000; composeInput.placeholder = 'Type your message…';
  composeInput.setAttribute('aria-label', 'Type your message');
  var sendBtn = el('button', null, 'Send');
  sendBtn.type = 'submit';
  compose.appendChild(composeInput);
  compose.appendChild(sendBtn);

  var followups = el('div', 'ch247wc-followups');
  followups.setAttribute('aria-label', 'Suggested questions');
  followups.hidden = true;

  var aiBar = el('div', 'ch247wc-ai-bar');
  aiBar.hidden = true;
  var aiBarText = el('span');
  var aiHumanBtn = el('button', null, 'Talk to a human');
  aiHumanBtn.type = 'button';
  aiBar.appendChild(aiBarText);
  aiBar.appendChild(aiHumanBtn);

  var closedHint = el('p', 'ch247wc-hint', 'This conversation was closed by support. Send a message to reopen it.');
  closedHint.hidden = true;
  var errorLine = el('p', 'ch247wc-error', '');
  errorLine.hidden = true;
  errorLine.setAttribute('role', 'alert');

  panel.appendChild(header);
  panel.appendChild(messages);
  panel.appendChild(closedHint);
  panel.appendChild(errorLine);
  panel.appendChild(followups);
  panel.appendChild(aiBar);
  panel.appendChild(intro);
  panel.appendChild(compose);

  var launch = el('button', 'ch247wc-launch');
  launch.type = 'button';
  launch.setAttribute('aria-expanded', 'false');
  launch.setAttribute('aria-label', 'Open live chat');
  launch.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-4.7 3.9A1 1 0 0 1 3 21V5a2 2 0 0 1 1-2z"/></svg><span>Chat</span>';

  wrap.appendChild(panel);
  wrap.appendChild(launch);

  function renderMessages(list, append) {
    if (!append) state.lastMessages = [];
    state.lastMessages = append ? (state.lastMessages || []).concat(list) : list.slice();
    var scroll = messages.scrollHeight - messages.scrollTop;
    if (!append) messages.textContent = '';
    list.forEach(function (message) {
      var mine = message.author === 'visitor';
      var ai = message.author === 'ai';
      var bubble = el('div', 'ch247wc-msg ' + (mine ? 'ch247wc-msg--visitor' : ai ? 'ch247wc-msg--ai' : 'ch247wc-msg--staff'));
      bubble.appendChild(el('small', null, mine ? 'You' : (message.authorName || (ai ? 'CloudHost247 AI Support' : 'CloudHost247 Support'))));
      bubble.appendChild(el('p', null, message.body));
      if (ai && Array.isArray(message.links)) {
        var safeLinks = message.links.filter(function (link) { return link && isSafeLink(link.url); });
        if (safeLinks.length) {
          var list = el('ul', 'ch247wc-links');
          safeLinks.forEach(function (link) {
            var item = el('li');
            var anchor = el('a', null, link.label || link.url);
            // Relative links are SPA routes on the platform itself; the platform may be mounted
            // under a sub-path (e.g. /platform behind the WHMCS host), so resolve them against the
            // configured API base, which is where the SPA lives. Absolute https:// links pass through.
            if (/^https?:\/\//i.test(link.url)) {
              anchor.href = link.url;
            } else {
              anchor.href = apiBase + link.url;
            }
            item.appendChild(anchor);
            list.appendChild(item);
          });
          bubble.appendChild(list);
        }
      }
      bubble.appendChild(el('time', null, timeLabel(message.createdAt)));
      messages.appendChild(bubble);
      state.lastSeq = Math.max(state.lastSeq, message.seq || 0);
    });
    messages.scrollTop = messages.scrollHeight;
    renderFollowUps();
  }

  function showError(err) {
    errorLine.textContent = (err && err.message) || 'Something went wrong — please try again.';
    errorLine.hidden = false;
  }
  function clearError() { errorLine.hidden = true; errorLine.textContent = ''; }

  function setPhase(phase) {
    state.phase = phase;
    intro.hidden = phase !== 'intro';
    compose.hidden = phase !== 'ready';
  }

  function latestAiMessage() {
    for (var i = state.lastMessages ? state.lastMessages.length - 1 : -1; i >= 0; i -= 1) {
      if (state.lastMessages[i].author === 'ai') return state.lastMessages[i];
    }
    return null;
  }

  function renderFollowUps() {
    followups.textContent = '';
    if (state.phase !== 'ready') { followups.hidden = true; return; }
    var last = latestAiMessage();
    var suggestions = last && Array.isArray(last.followUps) ? last.followUps.slice(0, 4) : [];
    if (!suggestions.length) { followups.hidden = true; return; }
    suggestions.forEach(function (question) {
      var button = el('button', null, question);
      button.type = 'button';
      button.disabled = state.busy;
      button.addEventListener('click', function () { postMessage(question); });
      followups.appendChild(button);
    });
    followups.hidden = false;
  }

  function refreshStatus(conversation) {
    var closed = conversation && conversation.status === 'closed';
    closedHint.hidden = !closed;
    var ready = conversation && state.phase === 'ready';
    if (!ready || closed) { aiBar.hidden = true; return; }
    aiBar.hidden = false;
    renderFollowUps();
    if (conversation.aiHandling === 'ai') {
      aiBar.classList.remove('ch247wc-ai-bar--human');
      aiBarText.textContent = 'AI support answers first — it can hand you to a person anytime.';
      aiHumanBtn.hidden = false;
      aiHumanBtn.disabled = false;
    } else {
      aiBar.classList.add('ch247wc-ai-bar--human');
      aiBarText.textContent = 'A support specialist owns this conversation — they reply right here.';
      aiHumanBtn.hidden = true;
    }
  }

  function poll(after) {
    return api('/messages?after=' + encodeURIComponent(String(after)), { token: state.token }).then(function (res) {
      state.conversation = res.conversation;
      refreshStatus(res.conversation);
      if (res.messages && res.messages.length) renderMessages(res.messages, true);
    });
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = root.setInterval(function () { poll(state.lastSeq).catch(function () { /* transient — next tick retries */ }); }, POLL_MS);
  }
  function stopPolling() {
    if (state.pollTimer) root.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  introForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if (state.busy) return;
    state.busy = true; clearError(); startBtn.disabled = true;
    var body = { source: 'whmcs' };
    if (nameInput.value.trim()) body.name = nameInput.value.trim();
    if (emailInput.value.trim()) body.email = emailInput.value.trim();
    api('/session', { method: 'POST', body: body, token: state.token || undefined }).then(function (res) {
      if (res.token) { state.token = res.token; storageWrite(res.token); }
      state.conversation = res.conversation;
      refreshStatus(res.conversation);
      setPhase('ready');
      return poll(0);
    }).catch(showError).then(function () {
      state.busy = false; startBtn.disabled = false;
    });
  });

  function postMessage(body) {
    if (state.busy || !state.token) return Promise.resolve(false);
    state.busy = true; clearError(); sendBtn.disabled = true; aiHumanBtn.disabled = true;
    return api('/messages', { method: 'POST', body: { body: body }, token: state.token }).then(function () {
      return poll(state.lastSeq);
    }).then(function () {
      state.busy = false; sendBtn.disabled = false; aiHumanBtn.disabled = false;
      return true;
    }, function (err) {
      showError(err);
      state.busy = false; sendBtn.disabled = false; aiHumanBtn.disabled = false;
      return false;
    });
  }

  compose.addEventListener('submit', function (event) {
    event.preventDefault();
    var text = composeInput.value.trim();
    if (!text || state.busy) return;
    postMessage(text).then(function (sent) { if (sent) composeInput.value = ''; });
  });

  aiHumanBtn.addEventListener('click', function () {
    // The AI's own guardrail recognises this phrasing and hands the conversation to the
    // support queue — visitors never steer the routing directly.
    postMessage("I'd like to talk to a human");
  });

  launch.addEventListener('click', function () {
    togglePanel(panel.hidden);
  });
  closeBtn.addEventListener('click', function () {
    togglePanel(false);
  });

  function togglePanel(open) {
    panel.hidden = !open;
    launch.setAttribute('aria-expanded', String(open));
    launch.querySelector('span').textContent = open ? 'Close' : 'Chat';
    if (open) {
      poll(state.lastSeq).catch(function () { /* opening offline is fine */ });
      startPolling();
      composeInput.focus();
    } else {
      stopPolling();
    }
  }

  // Legacy "Live chat" links (class="live-chat-con", href="#") open this widget instead of being dead links.
  document.addEventListener('click', function (event) {
    var anchor = event.target && event.target.closest ? event.target.closest('a.live-chat-con') : null;
    if (!anchor) return;
    event.preventDefault();
    togglePanel(true);
  });

  // Mount
  (function mount() {
    var target = document.body;
    if (!target) { root.setTimeout(mount, 50); return; }
    target.appendChild(wrap);
    if (state.token) {
      // Resume any stored session silently.
      api('/session', { method: 'POST', body: { source: 'whmcs' }, token: state.token }).then(function (res) {
        state.conversation = res.conversation;
        refreshStatus(res.conversation);
        setPhase('ready');
        return poll(0);
      }).catch(function () {
        storageWrite(null);
        state.token = null;
        setPhase('intro');
      });
    } else {
      setPhase('intro');
    }
  })();

  root.CloudHost247WebChat = { version: '1.0.0', open: function () { togglePanel(true); } };
})(window);
