import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toolsApiPath } from '../lib/tools-runtime';
import { trackTikTok } from '../lib/tiktok';
import { getToken } from '../lib/auth';
import { useAuthState } from '../layout/useAuthState';

/**
 * CloudHost247 support assistant.
 *
 * The widget is a thin view over the assistant's API: it never decides what is true, never builds a
 * URL, and never claims a message was delivered when it was not. Three details are worth knowing:
 *
 *   • **Links come from the server.** Each assistant message carries `links`, already resolved
 *     against the site's route registry. The widget renders them as real anchors and never
 *     constructs one. Clicking a link inside the panel navigates the SPA (no full reload).
 *   • **Feedback attaches to a message id.** Rating an answer posts to that message, so the admin
 *     console can show the exact answer that was wrong.
 *   • **Escalation is a state, not a message.** When the conversation passes to a human, the panel
 *     says who is handling it and stops letting the AI answer — the transcript is preserved server
 *     side for the agent.
 */

type Link = { label: string; url: string; kind?: string };
type Message = {
  id?: string;
  author_type: string;
  body: string;
  created_at?: string;
  intent?: string | null;
  links?: Link[];
  grounded?: boolean;
  /** Client-side only: this assistant message is awaiting the server. */
  pending?: boolean;
};
type SupportSession = { conversationId: string; accessToken: string };
const SESSION_KEY = 'ch247_ai_support_session';

function headers(token?: string): Record<string, string> {
  const auth = getToken();
  return {
    'Content-Type': 'application/json',
    ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    ...(token ? { 'X-AI-Conversation-Token': token } : {}),
    // Tells the assistant which page the customer is standing on, so it never suggests the page they
    // are already reading and can answer "where do I do this?" with a destination.
    'X-CloudHost-Page': typeof window === 'undefined' ? '' : window.location.pathname,
  };
}

const statusLabel = (status: string) => {
  if (status === 'AI_ACTIVE') return 'AI Assistant';
  if (status === 'WAITING_FOR_HUMAN') return 'Waiting for support';
  if (status === 'ASSIGNED' || status === 'IN_PROGRESS' || status === 'WAITING_FOR_CUSTOMER') return 'CloudHost247 Support';
  return status.replace(/_/g, ' ').toLowerCase();
};

const authorLabel = (type: string) =>
  type === 'CUSTOMER' ? 'You' : type === 'AGENT' ? 'CloudHost247 Support' : type === 'AI' ? 'AI Assistant' : 'Support status';

const STARTERS = [
  'What hosting plans do you offer?',
  'How much does a VPS cost?',
  'Can I host WordPress?',
  'How do I register a domain?',
];

export default function AiSupportWidget() {
  const { user } = useAuthState();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<SupportSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [contact, setContact] = useState({ name: '', email: '' });
  const [status, setStatus] = useState('AI_ACTIVE');
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [rated, setRated] = useState<Record<string, 'up' | 'down'>>({});
  const [pending, setPending] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (user) setContact({ name: user.fullName, email: user.email });
  }, [user]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) setSession(JSON.parse(raw) as SupportSession);
    } catch {
      // Storage may be blocked entirely in an embedded or private browsing context.
      try { localStorage.removeItem(SESSION_KEY); } catch { /* no stored session available */ }
    }
  }, []);

  // Newest message stays in view without the customer having to scroll a live region.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, pending, open]);

  // Focus moves into the panel when it opens and the Escape key closes it, so the widget is usable
  // from a keyboard alone.
  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const loadTranscript = useCallback(async (current: SupportSession) => {
    const response = await fetch(toolsApiPath(`/api/v1/ai-support/conversations/${current.conversationId}`), {
      headers: headers(current.accessToken),
    });
    if (!response.ok) throw new Error('Session expired');
    const data = await response.json();
    setMessages(data.messages as Message[]);
    setStatus(data.conversation.status);
    if (data.conversation.visitor_email) setShowContact(false);
  }, []);

  useEffect(() => {
    if (!session || !open) return undefined;
    let active = true;
    const refresh = () =>
      loadTranscript(session).catch(() => {
        if (!active) return;
        // A conversation that cannot be read is not silently shown as empty: drop the session so the
        // customer can start a new one deliberately.
        try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
        setSession(null);
        setMessages([]);
      });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [session, open, loadTranscript]);

  async function start() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(toolsApiPath('/api/v1/ai-support/conversations'), { method: 'POST', headers: headers() });
      if (!response.ok) throw new Error('Could not start support');
      const data = await response.json();
      const next = { conversationId: data.conversationId, accessToken: data.accessToken } as SupportSession;
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
      setSession(next);
      setMessages([data.message ?? { author_type: 'AI', body: 'Hello! How can CloudHost247 help?' }]);
      setStatus('AI_ACTIVE');
      setFollowUps(STARTERS.slice(0, 3));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start support');
    } finally {
      setBusy(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!session || !text.trim()) return;
    const body = text.trim();
    setText('');
    setBusy(true);
    setPending(true);
    setError('');
    setFollowUps([]);
    setMessages((current) => [...current, { author_type: 'CUSTOMER', body }]);
    try {
      const response = await fetch(toolsApiPath(`/api/v1/ai-support/conversations/${session.conversationId}/messages`), {
        method: 'POST',
        headers: headers(session.accessToken),
        body: JSON.stringify({ message: body }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'Message failed');
      if (data.decision?.kind === 'NEWSLETTER') setShowSubscribe(true);
      if (data.decision?.followUps?.length) setFollowUps(data.decision.followUps);
      if (data.transfer) {
        setStatus(data.transfer.status);
        setMessages((current) => [...current, { author_type: 'SYSTEM', body: data.transfer.body }]);
        if (data.transfer.requiresContact) setShowContact(true);
      } else if (data.response) {
        setMessages((current) => [...current, data.response]);
      }
      // Re-read from the server rather than trusting the local echo: the transcript is the record.
      void loadTranscript(session).catch(() => undefined);
    } catch (cause) {
      // Do not present an unsent message as delivered. Keep it available for a retry.
      setMessages((current) => {
        const next = [...current];
        for (let index = next.length - 1; index >= 0; index -= 1) {
          if (next[index]!.author_type === 'CUSTOMER' && next[index]!.body === body) {
            next.splice(index, 1);
            break;
          }
        }
        return next;
      });
      setText((current) => current || body);
      setError(cause instanceof Error ? cause.message : 'Message failed');
    } finally {
      setPending(false);
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function rate(messageId: string, rating: 'up' | 'down') {
    if (!session) return;
    setRated((current) => ({ ...current, [messageId]: rating }));
    try {
      await fetch(
        toolsApiPath(`/api/v1/ai-support/conversations/${session.conversationId}/messages/${messageId}/feedback`),
        {
          method: 'POST',
          headers: headers(session.accessToken),
          body: JSON.stringify({
            rating,
            ...(rating === 'down' ? { reason: 'incorrect' as const } : {}),
          }),
        }
      );
    } catch {
      // Feedback is advisory; a failed rating must not interrupt the conversation.
    }
  }

  async function saveContact(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(toolsApiPath(`/api/v1/ai-support/conversations/${session.conversationId}/contact`), {
        method: 'PATCH',
        headers: headers(session.accessToken),
        body: JSON.stringify(contact),
      });
      if (!response.ok) throw new Error((await response.json()).message ?? 'Could not save contact details');
      setShowContact(false);
      setMessages((current) => [...current, { author_type: 'SYSTEM', body: 'Thanks. Your name and email are attached to this support conversation.' }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save contact details');
    } finally {
      setBusy(false);
    }
  }

  async function subscribe(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(toolsApiPath(`/api/v1/ai-support/conversations/${session.conversationId}/newsletter`), {
        method: 'POST',
        headers: headers(session.accessToken),
        body: JSON.stringify(contact),
      });
      if (!response.ok) throw new Error((await response.json()).message ?? 'Subscription failed');
      const data = await response.json();
      if (data.marketingEvent?.eventId) trackTikTok('Subscribe', { content_name: 'Newsletter subscription', content_category: 'newsletter' }, data.marketingEvent.eventId);
      setShowSubscribe(false);
      setMessages((current) => [
        ...current,
        { author_type: 'SYSTEM', body: data.alreadySubscribed ? 'That email is already subscribed to CloudHost247 updates.' : 'You are subscribed to CloudHost247 updates. Newsletter subscription is separate from support requests.' },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Subscription failed');
    } finally {
      setBusy(false);
    }
  }

  /** In-panel navigation: a verified link should not eject the customer from the conversation. */
  function navigate(url: string) {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
    setOpen(false);
  }

  const humanActive = ['ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER'].includes(status);
  const closed = ['RESOLVED', 'CLOSED'].includes(status);
  const transcript = useMemo(() => messages.filter((message) => (message.body ?? '').trim().length > 0), [messages]);

  return (
    <div className="ch247-ai-support">
      <button
        className="ch247-ai-launch"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="ch247-ai-panel"
      >
        {open ? 'Close support' : humanActive ? 'CloudHost247 Support' : 'AI Support'}
      </button>
      {open && (
        <section
          className="ch247-ai-panel"
          id="ch247-ai-panel"
          aria-label="CloudHost247 AI Support"
          role="dialog"
          aria-modal="false"
          ref={panelRef}
        >
          <header>
            <div>
              <strong>CloudHost247 Support</strong>
              <small>{statusLabel(status)}</small>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close support">×</button>
          </header>
          <div className="ch247-ai-messages" aria-live="polite" aria-relevant="additions" ref={scroller}>
            {transcript.map((message, index) => {
              const key = message.id ?? `${message.author_type}-${index}`;
              const canRate = message.author_type === 'AI' && Boolean(message.id);
              return (
                <div key={key} className={`ch247-ai-message ch247-ai-message--${message.author_type.toLowerCase()}`}>
                  <small>{authorLabel(message.author_type)}</small>
                  <p>{message.body}</p>
                  {message.links && message.links.length > 0 && (
                    <ul className="ch247-ai-links">
                      {message.links.map((link) => (
                        <li key={link.url}>
                          <a
                            href={link.url}
                            onClick={(event) => {
                              // Same-origin internal path only: the server resolved it against the
                              // route registry, so this is a real page and not an arbitrary URL.
                              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                              event.preventDefault();
                              navigate(link.url);
                            }}
                          >
                            {link.label || link.url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                  {canRate && (
                    <div className="ch247-ai-feedback">
                      <span className="ch247-visually-hidden">Was this answer useful?</span>
                      <button
                        type="button"
                        aria-pressed={rated[message.id!] === 'up'}
                        aria-label="This answer was useful"
                        onClick={() => void rate(message.id!, 'up')}
                        disabled={Boolean(rated[message.id!])}
                      >
                        👍 Helpful
                      </button>
                      <button
                        type="button"
                        aria-pressed={rated[message.id!] === 'down'}
                        aria-label="This answer was not useful"
                        onClick={() => void rate(message.id!, 'down')}
                        disabled={Boolean(rated[message.id!])}
                      >
                        👎 Not helpful
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {pending && (
              <div className="ch247-ai-message ch247-ai-message--ai ch247-ai-typing" role="status" aria-label="The assistant is typing">
                <span /><span /><span />
              </div>
            )}
            {!session && (
              <div className="ch247-ai-welcome">
                <p>Get answers from verified CloudHost247 knowledge or ask for a human representative.</p>
                <button disabled={busy} onClick={() => void start()}>Start conversation</button>
              </div>
            )}
          </div>
          {followUps.length > 0 && session && !closed && (
            <div className="ch247-ai-followups" aria-label="Suggested questions">
              {followUps.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => setText(suggestion)} disabled={busy}>
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          {error && <p className="ch247-status-error" role="alert">{error}</p>}
          {showContact && (
            <form className="ch247-ai-subscribe" onSubmit={saveContact}>
              <strong>Contact details for support</strong>
              <p>Our team needs your name and email to follow up. This is separate from newsletter subscription.</p>
              <input required minLength={2} placeholder="Full name" value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} />
              <input required type="email" placeholder="Email address" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} />
              <button disabled={busy}>Save contact details</button>
            </form>
          )}
          {showSubscribe && (
            <form className="ch247-ai-subscribe" onSubmit={subscribe}>
              <strong>Newsletter subscription</strong>
              <p>Subscribe to CloudHost247 updates, offers and service announcements.</p>
              <input required minLength={2} placeholder="Full name" value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} />
              <input required type="email" placeholder="Email address" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} />
              <button disabled={busy}>Subscribe</button>
            </form>
          )}
          {session && !closed && (
            <form className="ch247-ai-compose" onSubmit={send}>
              <input
                ref={inputRef}
                aria-label="Support message"
                maxLength={10000}
                placeholder={humanActive ? 'Message CloudHost247 Support…' : 'Ask CloudHost247…'}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
              <button disabled={busy || !text.trim()}>Send</button>
            </form>
          )}
          {humanActive && <p className="ch247-ai-handoff">A CloudHost247 support representative is handling this conversation. The AI will not reply unless support explicitly returns it.</p>}
          {status === 'WAITING_FOR_HUMAN' && <p className="ch247-ai-handoff">Your conversation is preserved in the CloudHost247 support queue. A representative will follow up when available.</p>}
        </section>
      )}
    </div>
  );
}
