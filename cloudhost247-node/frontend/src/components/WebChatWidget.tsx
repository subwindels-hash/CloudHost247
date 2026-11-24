import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  visitorGetMessagesAfter,
  visitorOpenOrResumeSession,
  visitorSendMessage,
  type WebChatConversation,
  type WebChatMessage,
} from '../lib/web-chat-api';

/**
 * CloudHost247 live chat — first-party visitor widget.
 *
 * No third-party chat provider (Tawk.to, LiveChat, Zendesk) is embedded anywhere on the site.
 * The built-in AI support layer answers first; a human specialist picks the conversation up when
 * the AI escalates it, when the visitor asks for one, or when staff take it over — and then the
 * AI stays silent. Visitors talk directly to the platform's built-in live chat service. The
 * visitor is identified by an opaque token stored in this browser only; the server keeps just
 * its sha256 hash.
 *
 * Transport is short polling (every 4s while the panel is open) — deliberately simple and
 * proxy-friendly; there is no WebSocket to fail or to leak through an edge misconfiguration.
 */

const STORAGE_KEY = 'ch247_web_chat_v1';
const POLL_MS = 4000;

/** Verified destinations arrive from the server. Only relative same-origin paths and https URLs are ever rendered. */
function isSafeLink(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//') || /^https:\/\//i.test(url);
}

function readStoredToken(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: unknown };
    return typeof parsed.token === 'string' && parsed.token.length > 0 ? parsed.token : null;
  } catch {
    return null;
  }
}

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, JSON.stringify({ token }));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing / storage disabled — the session simply will not survive a reload.
  }
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function WebChatWidget() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'intro' | 'ready'>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [conversation, setConversation] = useState<WebChatConversation | null>(null);
  const [messages, setMessages] = useState<WebChatMessage[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scroller = useRef<HTMLDivElement | null>(null);
  // Monotonic message cursor — the source of truth for what this browser has received.
  const lastSeq = useRef(0);

  const mergeIncoming = useCallback((incoming: WebChatMessage[]) => {
    if (!incoming.length) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.seq));
      const fresh = incoming.filter((m) => !seen.has(m.seq));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
    lastSeq.current = incoming[incoming.length - 1]!.seq;
  }, []);

  // On mount: silently resume any stored session. No request is made until then.
  useEffect(() => {
    const stored = readStoredToken();
    if (!stored) {
      setPhase('intro');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await visitorOpenOrResumeSession({ source: 'spa' }, stored);
        // The server may have minted a fresh token if the stored one is unknown — keep whatever
        // it returns, not the stale one, or every later call would 401.
        const chatToken = res.token ?? stored;
        if (chatToken !== stored) storeToken(chatToken);
        const full = await visitorGetMessagesAfter(chatToken, 0);
        if (cancelled) return;
        setToken(chatToken);
        setConversation(res.conversation);
        setMessages(full.messages);
        lastSeq.current = full.messages.length ? full.messages[full.messages.length - 1]!.seq : 0;
        setPhase('ready');
      } catch {
        if (cancelled) return;
        // Stored token no longer recognised — drop it and start fresh.
        storeToken(null);
        setPhase('intro');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the message list pinned to the bottom as messages arrive.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, open]);

  // Poll for new messages while the panel is open.
  useEffect(() => {
    if (!open || !token || phase !== 'ready') return undefined;
    let cancelled = false;
    const tick = () => {
      visitorGetMessagesAfter(token, lastSeq.current)
        .then((res) => {
          if (cancelled) return;
          setConversation(res.conversation);
          mergeIncoming(res.messages);
        })
        .catch(() => {
          /* transient network failure — next tick retries */
        });
    };
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open, token, phase, mergeIncoming]);

  const startChat = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      setError('');
      try {
        const res = await visitorOpenOrResumeSession({
          source: 'spa',
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
        });
        const chatToken = res.token ?? token;
        if (!chatToken) throw new Error('The chat could not be started — please try again.');
        storeToken(chatToken);
        setToken(chatToken);
        setConversation(res.conversation);
        setMessages([]);
        lastSeq.current = 0;
        const full = await visitorGetMessagesAfter(chatToken, 0);
        setMessages(full.messages);
        lastSeq.current = full.messages.length ? full.messages[full.messages.length - 1]!.seq : 0;
        setPhase('ready');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start the chat — please try again.');
      } finally {
        setBusy(false);
      }
    },
    [busy, email, name, token],
  );

  const postMessage = useCallback(
    async (body: string): Promise<boolean> => {
      if (!token) return false;
      setBusy(true);
      setError('');
      try {
        await visitorSendMessage(token, body);
        const res = await visitorGetMessagesAfter(token, lastSeq.current);
        setConversation(res.conversation);
        mergeIncoming(res.messages);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Your message could not be sent — please try again.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [mergeIncoming, token],
  );

  const send = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const body = text.trim();
      if (!body || busy) return;
      if (await postMessage(body)) setText('');
    },
    [busy, postMessage, text],
  );

  // Explicit human request. The visitor never decides which system answers — the AI's own
  // guardrail recognises this phrasing and hands the conversation to the support queue.
  const talkToHuman = useCallback(async () => {
    if (busy) return;
    await postMessage("I'd like to talk to a human");
  }, [busy, postMessage]);

  const closed = conversation?.status === 'closed';

  return (
    <div className="ch247-web-chat">
      {open && (
        <section className="ch247-web-chat-panel" role="dialog" aria-label="Live chat with CloudHost247 support">
          <header>
            <div>
              <strong>Chat with us</strong>
              <small>AI answers first — ask for a human any time</small>
            </div>
            <button type="button" aria-label="Close chat" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>

          <div className="ch247-web-chat-messages" aria-live="polite" ref={scroller}>
            {phase === 'loading' && <p className="ch247-web-chat-hint">Loading your chat…</p>}
            {phase === 'intro' && (
              <div className="ch247-web-chat-intro">
                <p>Hi! Ask us anything about hosting, domains, billing or migrations. We reply right here.</p>
                <form onSubmit={startChat}>
                  <label>
                    Name <span>(optional)</span>
                    <input
                      type="text"
                      value={name}
                      maxLength={120}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ada"
                      autoComplete="name"
                    />
                  </label>
                  <label>
                    Email <span>(optional — so we can follow up)</span>
                    <input
                      type="email"
                      value={email}
                      maxLength={255}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                    />
                  </label>
                  <button type="submit" disabled={busy}>
                    {busy ? 'Starting…' : 'Start chat'}
                  </button>
                </form>
              </div>
            )}
            {phase === 'ready' && messages.length === 0 && (
              <p className="ch247-web-chat-hint">No messages yet — say hello!</p>
            )}
            {phase === 'ready' &&
              messages.map((message) => (
                <div key={message.seq} className={`ch247-web-chat-message ch247-web-chat-message--${message.author}`}>
                  <small>
                    {message.author === 'visitor' ? 'You' : message.authorName ?? (message.author === 'ai' ? 'CloudHost247 AI Support' : 'CloudHost247 Support')}
                  </small>
                  <p>{message.body}</p>
                  {message.author === 'ai' && message.links.filter((link) => isSafeLink(link.url)).length > 0 && (
                    <ul className="ch247-web-chat-links">
                      {message.links.filter((link) => isSafeLink(link.url)).map((link) => (
                        <li key={`${link.url}-${link.label}`}>
                          <a
                            href={link.url}
                            onClick={(event) => {
                              if (link.url.startsWith('/') && !link.url.startsWith('//')) {
                                event.preventDefault();
                                navigate(link.url);
                              }
                            }}
                          >
                            {link.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                  <time>{timeLabel(message.createdAt)}</time>
                </div>
              ))}
            {closed && (
              <p className="ch247-web-chat-hint" role="status">
                This conversation was closed by support. Send a message to reopen it.
              </p>
            )}
            {error && (
              <p className="ch247-web-chat-error" role="alert">
                {error}
              </p>
            )}
          </div>

          {phase === 'ready' && (() => {
            const lastAi = [...messages].reverse().find((message) => message.author === 'ai');
            if (!lastAi || lastAi.followUps.length === 0) return null;
            return (
              <div className="ch247-web-chat-followups" aria-label="Suggested questions">
                {lastAi.followUps.map((question) => (
                  <button key={question} type="button" disabled={busy} onClick={() => void postMessage(question)}>
                    {question}
                  </button>
                ))}
              </div>
            );
          })()}
          {phase === 'ready' && conversation?.aiHandling === 'ai' && !closed && (
            <p className="ch247-web-chat-ai-bar">
              <span>AI support answers first — it can hand you to a person anytime.</span>
              <button type="button" disabled={busy} onClick={() => void talkToHuman()}>
                Talk to a human
              </button>
            </p>
          )}
          {phase === 'ready' && conversation?.aiHandling === 'human' && !closed && (
            <p className="ch247-web-chat-ai-bar ch247-web-chat-ai-bar--human" role="status">
              A support specialist owns this conversation — they reply right here.
            </p>
          )}
          {phase === 'ready' && (
            <form className="ch247-web-chat-compose" onSubmit={send}>
              <input
                type="text"
                value={text}
                maxLength={2000}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type your message…"
                aria-label="Type your message"
              />
              <button type="submit" disabled={busy || !text.trim()}>
                Send
              </button>
            </form>
          )}
        </section>
      )}

      <button
        type="button"
        className="ch247-web-chat-launch"
        aria-expanded={open}
        aria-label={open ? 'Close live chat' : 'Open live chat'}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-4.7 3.9A1 1 0 0 1 3 21V5a2 2 0 0 1 1-2z"
          />
        </svg>
        <span>{open ? 'Close' : 'Chat'}</span>
      </button>
    </div>
  );
}
