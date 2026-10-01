import { FormEvent, useEffect, useState } from 'react';
import { getToken } from '../lib/auth';
import { useAuthState } from '../layout/useAuthState';

type Message = { id?: string; author_type: string; body: string; created_at?: string };
type SupportSession = { conversationId: string; accessToken: string };
const SESSION_KEY = 'ch247_ai_support_session';

function headers(token?: string): Record<string, string> {
  const auth = getToken();
  return {
    'Content-Type': 'application/json',
    ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    ...(token ? { 'X-AI-Conversation-Token': token } : {}),
  };
}

const statusLabel = (status: string) => {
  if (status === 'AI_ACTIVE') return 'AI Assistant';
  if (status === 'ASSIGNED' || status === 'IN_PROGRESS' || status === 'WAITING_FOR_CUSTOMER') return 'CloudHost247 Support';
  return status.replace(/_/g, ' ');
};

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

  useEffect(() => {
    if (user) setContact({ name: user.fullName, email: user.email });
  }, [user]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) setSession(JSON.parse(raw) as SupportSession);
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }, []);

  useEffect(() => {
    if (!session || !open) return undefined;
    let active = true;
    const refresh = () =>
      fetch(`/api/v1/ai-support/conversations/${session.conversationId}`, { headers: headers(session.accessToken) })
        .then(async (response) => {
          if (!response.ok) throw new Error('Session expired');
          return response.json();
        })
        .then((data) => {
          if (!active) return;
          setMessages(data.messages);
          setStatus(data.conversation.status);
          if (data.conversation.visitor_email) setShowContact(false);
        })
        .catch(() => {
          if (active) {
            localStorage.removeItem(SESSION_KEY);
            setSession(null);
            setMessages([]);
          }
        });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [session, open]);

  async function start() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/v1/ai-support/conversations', { method: 'POST', headers: headers() });
      if (!response.ok) throw new Error('Could not start support');
      const data = await response.json();
      const next = { conversationId: data.conversationId, accessToken: data.accessToken } as SupportSession;
      localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      setSession(next);
      setMessages([data.message ?? { author_type: 'AI', body: 'Hello! How can CloudHost247 help?' }]);
      setStatus('AI_ACTIVE');
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
    setMessages((current) => [...current, { author_type: 'CUSTOMER', body }]);
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/ai-support/conversations/${session.conversationId}/messages`, {
        method: 'POST',
        headers: headers(session.accessToken),
        body: JSON.stringify({ message: body }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'Message failed');
      if (data.decision?.kind === 'NEWSLETTER') setShowSubscribe(true);
      if (data.transfer) {
        setStatus(data.transfer.status);
        setMessages((current) => [...current, { author_type: 'SYSTEM', body: data.transfer.body }]);
        if (data.transfer.requiresContact) setShowContact(true);
      } else if (data.response) {
        setMessages((current) => [...current, data.response]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Message failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveContact(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/ai-support/conversations/${session.conversationId}/contact`, {
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
      const response = await fetch(`/api/v1/ai-support/conversations/${session.conversationId}/newsletter`, {
        method: 'POST',
        headers: headers(session.accessToken),
        body: JSON.stringify(contact),
      });
      if (!response.ok) throw new Error((await response.json()).message ?? 'Subscription failed');
      const data = await response.json();
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

  const humanActive = ['ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER'].includes(status);
  const closed = ['RESOLVED', 'CLOSED'].includes(status);

  return (
    <div className="ch247-ai-support">
      <button className="ch247-ai-launch" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {humanActive ? 'CloudHost247 Support' : 'AI Support'}
      </button>
      {open && (
        <section className="ch247-ai-panel" aria-label="CloudHost247 AI Support">
          <header>
            <div>
              <strong>CloudHost247 Support</strong>
              <small>{statusLabel(status)}</small>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close support">×</button>
          </header>
          <div className="ch247-ai-messages" aria-live="polite">
            {messages.map((message, index) => (
              <div key={message.id ?? `${message.author_type}-${index}`} className={`ch247-ai-message ch247-ai-message--${message.author_type.toLowerCase()}`}>
                <small>{message.author_type === 'CUSTOMER' ? 'You' : message.author_type === 'AGENT' ? 'CloudHost247 Support' : message.author_type === 'AI' ? 'AI Assistant' : 'Support status'}</small>
                <p>{message.body}</p>
              </div>
            ))}
            {!session && (
              <div className="ch247-ai-welcome">
                <p>Get answers from verified CloudHost247 knowledge or ask for a human representative.</p>
                <button disabled={busy} onClick={() => void start()}>Start conversation</button>
              </div>
            )}
          </div>
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
              <input aria-label="Support message" maxLength={10000} placeholder={humanActive ? 'Message CloudHost247 Support…' : 'Ask CloudHost247…'} value={text} onChange={(event) => setText(event.target.value)} />
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
