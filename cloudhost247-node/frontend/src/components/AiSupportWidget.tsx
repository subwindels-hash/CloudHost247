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
type LaunchProgress = { status: string; label: string; attentionState?: 'none' | 'suspected_interrupted' };
const SESSION_KEY = 'ch247_ai_support_session';
// Contains only an opaque submission marker, never the message or conversation token.
const messageMarkerKey = (conversationId: string) => `ch247_ai_support_pending_message:${conversationId}`;

function safeAssistantLink(link: Link): boolean {
  if (link.url.startsWith('/') && !link.url.startsWith('//')) return true;
  if (link.kind !== 'whmcs_cart') return false;
  try { return new URL(link.url).protocol === 'https:'; } catch { return false; }
}

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
  const [launchProgress, setLaunchProgress] = useState<LaunchProgress | null>(null);
  const [transcriptState, setTranscriptState] = useState<'loading' | 'current' | 'unavailable'>('loading');
  const [messageUncertain, setMessageUncertain] = useState(false);
  const [uncertaintyReviewed, setUncertaintyReviewed] = useState(false);
  const [rated, setRated] = useState<Record<string, 'up' | 'down'>>({});
  const [pending, setPending] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  // Polling and post-send refreshes can overlap; only the latest request may publish a snapshot.
  const transcriptRequest = useRef(0);
  const submissionInFlight = useRef(false);

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

  // A submitted message with no observed response remains uncertain across reloads and tabs.
  useEffect(() => {
    if (!session) { setMessageUncertain(false); return undefined; }
    const key = messageMarkerKey(session.conversationId);
    const update = () => {
      try { setMessageUncertain(Boolean(localStorage.getItem(key))); }
      catch { setMessageUncertain(true); }
      setUncertaintyReviewed(false);
    };
    update();
    const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) update(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [session]);

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
    const requestId = ++transcriptRequest.current;
    try {
      const response = await fetch(toolsApiPath(`/api/v1/ai-support/conversations/${current.conversationId}`), {
        headers: headers(current.accessToken),
      });
      if (!response.ok) throw new Error('Transcript unavailable');
      const data = await response.json();
      if (requestId !== transcriptRequest.current) return;
      setMessages(data.messages as Message[]);
      setStatus(data.conversation.status);
      setLaunchProgress(data.launchProgress ?? null);
      setTranscriptState('current');
      if (data.conversation.visitor_email) setShowContact(false);
    } catch {
      // A failed read does not establish that a conversation is gone or its token is invalid.
      // Retain the session, mark the snapshot stale, and pause actions until a read succeeds.
      if (requestId === transcriptRequest.current) setTranscriptState('unavailable');
    }
  }, []);

  useEffect(() => {
    if (!session || !open) return undefined;
    setTranscriptState('loading');
    void loadTranscript(session);
    const timer = window.setInterval(() => void loadTranscript(session), 5000);
    return () => {
      ++transcriptRequest.current;
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
      setLaunchProgress(null);
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
    if (!session || transcriptState !== 'current' || messageUncertain || submissionInFlight.current || !text.trim()) return;
    const body = text.trim();
    const key = messageMarkerKey(session.conversationId);
    // A stable cryptographically random request ID binds the server's durable intake record.
    // Refuse dispatch if secure UUID generation or persistent storage is unavailable.
    let marker: string;
    try {
      marker = crypto.randomUUID();
      if (localStorage.getItem(key)) { setMessageUncertain(true); return; }
      localStorage.setItem(key, marker);
      if (localStorage.getItem(key) !== marker) throw new Error('Unable to retain submission marker');
    } catch {
      setMessageUncertain(true);
      setError('Cannot safely send while browser storage is unavailable.');
      return;
    }
    submissionInFlight.current = true;
    setMessageUncertain(true);
    setUncertaintyReviewed(false);
    setText('');
    setBusy(true);
    setPending(true);
    setError('');
    setFollowUps([]);
    try {
      const response = await fetch(toolsApiPath(`/api/v1/ai-support/conversations/${session.conversationId}/messages`), {
        method: 'POST',
        headers: headers(session.accessToken),
        body: JSON.stringify({ message: body, requestId: marker }),
      });
      const data = await response.json();
      if (!response.ok || !data || typeof data !== 'object' || data.outcomeUnknown === true ||
          !(data.accepted === true || (data.decision && typeof data.decision === 'object' &&
            ((data.response && typeof data.response === 'object') || (data.transfer && typeof data.transfer === 'object'))))) {
        throw new Error('Submission outcome unknown');
      }
      // Only clear our own marker after an observed successful response. A concurrent tab's
      // marker is not ours to clear. Never infer acceptance from matching transcript text.
      try {
        if (localStorage.getItem(key) === marker) localStorage.removeItem(key);
        setMessageUncertain(Boolean(localStorage.getItem(key)));
      } catch { setMessageUncertain(true); }
      if (data.decision?.kind === 'NEWSLETTER') setShowSubscribe(true);
      if (data.decision?.followUps?.length) setFollowUps(data.decision.followUps);
      if (data.transfer) {
        setStatus(data.transfer.status);
        setMessages((current) => [...current, { author_type: 'SYSTEM', body: data.transfer.body }]);
        if (data.transfer.requiresContact) setShowContact(true);
      } else if (data.response) {
        setMessages((current) => [...current, data.response]);
      }
      // The transcript, not an optimistic echo, is the record of the customer message.
      void loadTranscript(session);
    } catch {
      // Even a 4xx/5xx, invalid response or lost connection may follow a committed intake.
      // Keep the marker and draft; never resend automatically or claim it was unsent.
      setText((current) => current || body);
      setMessageUncertain(true);
    } finally {
      submissionInFlight.current = false;
      setPending(false);
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function acknowledgeUncertainMessage() {
    if (!session || !uncertaintyReviewed || busy || transcriptState !== 'current') return;
    try {
      localStorage.removeItem(messageMarkerKey(session.conversationId));
      if (localStorage.getItem(messageMarkerKey(session.conversationId))) throw new Error('Marker still present');
      setMessageUncertain(false);
      setUncertaintyReviewed(false);
      setError('');
    } catch {
      setError('Cannot clear the warning while browser storage is unavailable.');
    }
  }

  async function rate(messageId: string, rating: 'up' | 'down') {
    if (!session || transcriptState !== 'current') return;
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
    if (!session || transcriptState !== 'current') return;
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
    if (!session || transcriptState !== 'current') return;
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
                      {message.links.filter(safeAssistantLink).map((link) => (
                        <li key={link.url}>
                          <a
                            href={link.url}
                            onClick={(event) => {
                              // WHMCS cart URLs are verified server-side and navigate normally;
                              // internal paths continue using the SPA router.
                              if (link.kind === 'whmcs_cart' || event.metaKey || event.ctrlKey || event.shiftKey) return;
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
                        disabled={transcriptState !== 'current' || Boolean(rated[message.id!])}
                      >
                        👍 Helpful
                      </button>
                      <button
                        type="button"
                        aria-pressed={rated[message.id!] === 'down'}
                        aria-label="This answer was not useful"
                        onClick={() => void rate(message.id!, 'down')}
                        disabled={transcriptState !== 'current' || Boolean(rated[message.id!])}
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
          {session && transcriptState === 'loading' && <p role="status">Loading the conversation…</p>}
          {session && transcriptState === 'unavailable' && (
            <div className="ch247-ai-handoff" role="alert">
              <p>Conversation unavailable. Displayed messages and launch status may be out of date. Your session is kept; new actions are paused until it can be loaded. Actions already in progress may still finish.</p>
              <button type="button" onClick={() => void loadTranscript(session)}>Refresh conversation</button>
            </div>
          )}
          {session && messageUncertain && !pending && (
            <div className="ch247-ai-handoff" role="alert">
              <p>A previous message may have been received or may still be processing. Its outcome is unknown; refreshing the conversation cannot prove it was not received. Check the transcript and ask support for help before sending again.</p>
              <label><input type="checkbox" checked={uncertaintyReviewed} onChange={(event) => setUncertaintyReviewed(event.target.checked)} /> I understand the previous message may still be processed, and another message may duplicate it.</label>
              <button type="button" onClick={acknowledgeUncertainMessage} disabled={!uncertaintyReviewed || busy || transcriptState !== 'current'}>Continue with this uncertainty</button>
            </div>
          )}
          {session && launchProgress && (
            <p className="ch247-ai-handoff" role="status">
              Website launch{launchProgress.attentionState === 'suspected_interrupted' ? ' — may need attention' : ''}: {launchProgress.label}
            </p>
          )}
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
              <button disabled={busy || transcriptState !== 'current'}>Save contact details</button>
            </form>
          )}
          {showSubscribe && (
            <form className="ch247-ai-subscribe" onSubmit={subscribe}>
              <strong>Newsletter subscription</strong>
              <p>Subscribe to CloudHost247 updates, offers and service announcements.</p>
              <input required minLength={2} placeholder="Full name" value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} />
              <input required type="email" placeholder="Email address" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} />
              <button disabled={busy || transcriptState !== 'current'}>Subscribe</button>
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
              <button disabled={busy || transcriptState !== 'current' || messageUncertain || !text.trim()}>Send</button>
            </form>
          )}
          {humanActive && <p className="ch247-ai-handoff">A CloudHost247 support representative is handling this conversation. The AI will not reply unless support explicitly returns it.</p>}
          {status === 'WAITING_FOR_HUMAN' && <p className="ch247-ai-handoff">Your conversation is preserved in the CloudHost247 support queue. A representative will follow up when available.</p>}
        </section>
      )}
    </div>
  );
}
