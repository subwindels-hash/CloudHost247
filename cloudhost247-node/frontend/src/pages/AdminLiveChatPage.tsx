import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import {
  adminCloseConversation,
  adminGetMessagesAfter,
  adminListConversations,
  adminReopenConversation,
  adminSendMessage,
  adminSetHandling,
  type AdminWebChatConversation,
  type WebChatMessage,
} from '../lib/web-chat-api';
import { ApiRequestError } from '../lib/api';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import {
  desktopAlertsEnabled,
  desktopAlertsSupported,
  disableDesktopAlerts,
  enableDesktopAlerts,
  liveChatSoundEnabled,
  notifyEscalation,
  playEscalationRing,
  setLiveChatSoundEnabled,
} from '../lib/web-chat-alert';

const LIST_POLL_MS = 4000;
const THREAD_POLL_MS = 3000;

function timeLabel(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
        ' ' +
        date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function visitorLabel(c: Pick<AdminWebChatConversation, 'visitorName' | 'visitorEmail'>): string {
  return c.visitorName || c.visitorEmail || 'Anonymous visitor';
}

/** Who owns the conversation right now. 'escalated' = the AI/visitor asked for a human, so staff
 * need to look; 'human' = a person is already on it; 'ai' = the AI is answering. */
function handlingChip(c: Pick<AdminWebChatConversation, 'aiHandling' | 'escalatedAt'>): { label: string; background: string; color: string; border: string } {
  if (c.aiHandling === 'human' && c.escalatedAt) return { label: 'Needs human', background: '#fff7ed', color: '#c2410c', border: '#fdba74' };
  if (c.aiHandling === 'human') return { label: 'Human', background: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' };
  return { label: 'AI', background: '#f0fdfa', color: '#0f766e', border: '#99f6e4' };
}

function HandlingChip({ conversation }: { conversation: Pick<AdminWebChatConversation, 'aiHandling' | 'escalatedAt'> }) {
  const chip = handlingChip(conversation);
  return (
    <span
      style={{
        background: chip.background,
        color: chip.color,
        border: `1px solid ${chip.border}`,
        borderRadius: 999,
        fontSize: '.65rem',
        fontWeight: 700,
        padding: '.05rem .45rem',
        textTransform: 'uppercase',
        letterSpacing: '.02em',
      }}
    >
      {chip.label}
    </span>
  );
}

/** Staff console for the built-in, first-party live chat. No third-party provider is involved —
 * conversations arrive here from the public site's built-in widget (SPA and WHMCS theme). The AI
 * support decision layer answers first; escalated conversations are stamped and sorted to the top,
 * and staff can take one over or hand it back to the AI at any time. */
export default function AdminLiveChatPage() {
  usePageMeta('Live Chat', 'CloudHost247 first-party live chat — staff console.');
  const [filter, setFilter] = useState<'open' | 'closed'>('open');
  const [needsHumanOnly, setNeedsHumanOnly] = useState(false);
  const [needsHuman, setNeedsHuman] = useState(0);
  const [soundOn, setSoundOn] = useState(() => liveChatSoundEnabled());
  const soundOnRef = useRef(soundOn);
  const [desktopOn, setDesktopOn] = useState(() => desktopAlertsSupported() && desktopAlertsEnabled());
  const desktopOnRef = useRef(desktopOn);
  const [desktopNotice, setDesktopNotice] = useState<string | null>(null);
  // Keys of escalated conversations already known to this tab — seeded on the first poll so a
  // backlog never rings, only genuinely new handoffs do.
  const escalationBaseline = useRef<Set<string> | null>(null);
  const [toast, setToast] = useState<{ id: string; label: string; extra: number } | null>(null);
  const [conversations, setConversations] = useState<AdminWebChatConversation[]>([]);
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [listError, setListError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WebChatMessage[]>([]);
  const [threadState, setThreadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [threadError, setThreadError] = useState('');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const lastSeq = useRef(0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const refreshList = useCallback(
    async (showSpinner: boolean) => {
      if (showSpinner) setListState('loading');
      try {
        const res = await adminListConversations(filter, needsHumanOnly ? 'human' : undefined);
        setConversations(res.conversations);
        setListState('ready');
      } catch (err) {
        if (showSpinner) {
          setListState('error');
          setListError(
            err instanceof ApiRequestError && err.status === 403
              ? 'Your account does not have permission to read live chat conversations.'
              : err instanceof Error
                ? err.message
                : 'Something went wrong loading conversations.',
          );
        }
      }
    },
    [filter, needsHumanOnly],
  );

  // Initial load + list polling.
  useEffect(() => {
    void refreshList(true);
    const id = window.setInterval(() => void refreshList(false), LIST_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshList]);

  // Watch for NEW escalations regardless of what the console is filtered to — this is the
  // audible timer. Polls the (small) human-owned open queue.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await adminListConversations('open', 'human');
        if (cancelled) return;
        const escalated = res.conversations.filter((c) => c.escalatedAt);
        setNeedsHuman(escalated.length);
        const keys = escalated.map((c) => `${c.id}:${c.escalatedAt}`);
        if (escalationBaseline.current === null) {
          escalationBaseline.current = new Set(keys); // first look — backlog, no ring
          return;
        }
        const known = escalationBaseline.current;
        const fresh = escalated.filter((c) => !known.has(`${c.id}:${c.escalatedAt}`));
        for (const c of escalated) known.add(`${c.id}:${c.escalatedAt}`);
        if (fresh.length > 0) {
          if (soundOnRef.current) playEscalationRing();
          if (desktopOnRef.current && document.hidden) {
            const label = visitorLabel(fresh[0]!);
            notifyEscalation(
              'Visitor needs a human',
              `${label}${fresh.length > 1 ? ` and ${fresh.length - 1} more` : ''} — open Admin → Live Chat to reply.`,
              fresh[0]!.id,
            );
          }
          setToast({
            id: fresh[0]!.id,
            label: visitorLabel(fresh[0]!),
            extra: fresh.length - 1,
          });
          void refreshList(false);
        }
      } catch {
        /* transient — next tick retries */
      }
    };
    void tick();
    const id = window.setInterval(tick, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [refreshList]);

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  // Full history load when selecting a conversation.
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setThreadState('idle');
      lastSeq.current = 0;
      return;
    }
    let cancelled = false;
    setThreadState('loading');
    setThreadError('');
    adminGetMessagesAfter(selectedId, 0)
      .then((res) => {
        if (cancelled) return;
        setMessages(res.messages);
        lastSeq.current = res.messages.length ? res.messages[res.messages.length - 1]!.seq : 0;
        setThreadState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setThreadState('error');
        setThreadError(err instanceof Error ? err.message : 'Could not load the conversation.');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Thread polling while a conversation is selected.
  useEffect(() => {
    if (!selectedId || threadState !== 'ready') return undefined;
    let cancelled = false;
    const id = window.setInterval(() => {
      const target = selectedRef.current;
      if (!target) return;
      adminGetMessagesAfter(target, lastSeq.current)
        .then((res) => {
          if (cancelled) return;
          if (res.messages.length) {
            setMessages((prev) => {
              const seen = new Set(prev.map((m) => m.seq));
              return [...prev, ...res.messages.filter((m) => !seen.has(m.seq))];
            });
            lastSeq.current = res.messages[res.messages.length - 1]!.seq;
          }
        })
        .catch(() => {
          /* transient — next tick retries */
        });
    }, THREAD_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [selectedId, threadState]);

  // Pin the thread to the latest message.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages]);

  const sendReply = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const body = reply.trim();
      if (!body || sending || !selectedId) return;
      setSending(true);
      setThreadError('');
      try {
        await adminSendMessage(selectedId, body);
        setReply('');
        const res = await adminGetMessagesAfter(selectedId, lastSeq.current);
        if (res.messages.length) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.seq));
            return [...prev, ...res.messages.filter((m) => !seen.has(m.seq))];
          });
          lastSeq.current = res.messages[res.messages.length - 1]!.seq;
        }
        void refreshList(false);
      } catch (err) {
        setThreadError(err instanceof Error ? err.message : 'Could not send your reply — please try again.');
      } finally {
        setSending(false);
      }
    },
    [refreshList, reply, selectedId, sending],
  );

  const toggleSound = useCallback(() => {
    setSoundOn((previous) => {
      const next = !previous;
      soundOnRef.current = next;
      setLiveChatSoundEnabled(next);
      return next;
    });
  }, []);

  const toggleDesktop = useCallback(async () => {
    if (desktopOnRef.current) {
      disableDesktopAlerts();
      desktopOnRef.current = false;
      setDesktopOn(false);
      setDesktopNotice(null);
      return;
    }
    const result = await enableDesktopAlerts();
    const on = result === 'enabled';
    desktopOnRef.current = on;
    setDesktopOn(on);
    setDesktopNotice(
      result === 'enabled'
        ? null
        : result === 'unsupported'
          ? 'This browser does not support desktop notifications.'
          : 'Your browser blocked notifications for this site — allow them in the address bar or site settings, then toggle this on again.',
    );
    if (on) {
      notifyEscalation('Desktop alerts on', 'You will get a desktop notification when a visitor needs a human.', 'ch247-desktop-alerts-test');
    }
  }, []);

  const toggleHandling = useCallback(async () => {
    if (!selected) return;
    try {
      await adminSetHandling(selected.id, selected.aiHandling === 'ai' ? 'human' : 'ai');
      void refreshList(false);
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : 'Could not change who owns the conversation.');
    }
  }, [refreshList, selected]);

  const toggleStatus = useCallback(async () => {
    if (!selected) return;
    try {
      if (selected.status === 'open') await adminCloseConversation(selected.id);
      else await adminReopenConversation(selected.id);
      void refreshList(false);
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : 'Could not update the conversation.');
    }
  }, [refreshList, selected]);

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <p>
          <Link to="/admin">← Back to Admin</Link>
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ marginBottom: '.25rem' }}>Live Chat</h1>
            <p className="ch247-page__hint" style={{ margin: 0 }}>
              Built-in first-party chat — visitors arrive from the site widget; no third-party provider involved.
            </p>
          </div>
          <div role="group" aria-label="Filter conversations" style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {(['open', 'closed'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={filter === value ? 'ch247-btn ch247-btn--primary' : 'ch247-btn'}
                style={{ textTransform: 'capitalize' }}
              >
                {value}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={needsHumanOnly}
              onClick={() => setNeedsHumanOnly((v) => !v)}
              className={needsHumanOnly ? 'ch247-btn ch247-btn--primary' : 'ch247-btn'}
            >
              Needs human{needsHuman > 0 ? ` (${needsHuman})` : ''}
            </button>
            <button
              type="button"
              aria-pressed={soundOn}
              onClick={toggleSound}
              className="ch247-btn"
              title={soundOn ? 'Mute the ring when a visitor is handed to a human' : 'Unmute the ring when a visitor is handed to a human'}
            >
              {soundOn ? '🔔 Sound on' : '🔕 Sound off'}
            </button>
            <button
              type="button"
              aria-pressed={desktopOn}
              onClick={() => void toggleDesktop()}
              disabled={!desktopAlertsSupported()}
              className="ch247-btn"
              title={
                desktopOn
                  ? 'Turn off desktop alerts when a visitor needs a human'
                  : 'Get a desktop notification when a visitor needs a human (asks browser permission)'
              }
            >
              {desktopOn ? '🖥️ Desktop alerts on' : '🖥️ Desktop alerts off'}
            </button>
          </div>
        </div>
      </div>

      {desktopNotice && (
        <p role="status" className="ch247-page__hint" style={{ margin: 0, display: 'flex', gap: '.75rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span>{desktopNotice}</span>
          <button type="button" className="ch247-btn" onClick={() => setDesktopNotice(null)}>Dismiss</button>
        </p>
      )}

      {toast && (
        <div
          role="alert"
          style={{
            border: '1px solid #fdba74',
            background: '#fff7ed',
            color: '#9a3412',
            borderRadius: 12,
            padding: '.75rem .9rem',
            display: 'flex',
            alignItems: 'center',
            gap: '.75rem',
            flexWrap: 'wrap',
            fontWeight: 600,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: '1.3rem' }}>🔔</span>
          <span style={{ flex: '1 1 220px' }}>
            {toast.label} asked for a human{toast.extra > 0 ? ` (and ${toast.extra} more)` : ''} — the conversation is waiting in the queue.
          </span>
          <button
            type="button"
            className="ch247-btn ch247-btn--primary"
            onClick={() => {
              setSelectedId(toast.id);
              setToast(null);
            }}
          >
            Open conversation
          </button>
          <button type="button" className="ch247-btn" aria-label="Dismiss notification" onClick={() => setToast(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="ch247-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: '1rem', minHeight: '28rem' }}>
        {/* Conversation list */}
        <div style={{ borderRight: '1px solid #e2e8f0', paddingRight: '1rem', overflowY: 'auto' }}>
          {listState === 'loading' && <CatalogLoadingBanner label="Loading conversations…" />}
          {listState === 'error' && <CatalogErrorBanner message={listError} />}
          {listState === 'ready' && conversations.length === 0 && (
            <p className="ch247-page__hint">No {filter} conversations.</p>
          )}
          {listState === 'ready' &&
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                aria-current={selectedId === c.id}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '.6rem .7rem',
                  borderRadius: 10,
                  border: selectedId === c.id ? '1px solid #0f766e' : '1px solid transparent',
                  background: selectedId === c.id ? '#f0fdfa' : 'transparent',
                  cursor: 'pointer',
                  marginBottom: '.35rem',
                }}
              >
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', fontWeight: 700 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
                    {visitorLabel(c)}
                    <HandlingChip conversation={c} />
                    {c.unreadStaff > 0 && (
                      <span
                        aria-label={`${c.unreadStaff} unread`}
                        style={{ marginLeft: '.4rem', background: '#dc2626', color: '#fff', borderRadius: 999, fontSize: '.68rem', padding: '.05rem .4rem' }}
                      >
                        {c.unreadStaff}
                      </span>
                    )}
                  </span>
                  <time style={{ fontWeight: 400, color: '#64748b', fontSize: '.75rem' }}>{timeLabel(c.lastMessageAt ?? c.createdAt)}</time>
                </span>
                <span style={{ display: 'block', fontSize: '.78rem', color: '#475569', marginTop: '.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.lastMessageBody ?? 'No messages yet'}
                </span>
                <span style={{ display: 'block', fontSize: '.68rem', color: '#94a3b8', marginTop: '.15rem' }}>
                  {c.source === 'whmcs' ? 'WHMCS site' : c.source === 'spa' ? 'Public site' : 'Unknown source'} · {c.messageCount} message{c.messageCount === 1 ? '' : 's'}
                </span>
              </button>
            ))}
        </div>

        {/* Thread */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '24rem' }}>
          {threadState === 'idle' && <p className="ch247-page__hint">Select a conversation to read it.</p>}
          {threadState === 'loading' && <CatalogLoadingBanner label="Loading conversation…" />}
          {selected && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.75rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '.6rem', marginBottom: '.6rem', flexWrap: 'wrap' }}>
                <div>
                  <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem' }}>
                    {visitorLabel(selected)}
                    <HandlingChip conversation={selected} />
                  </strong>
                  <p className="ch247-page__hint" style={{ margin: '.15rem 0 0' }}>
                    {selected.visitorEmail ? `${selected.visitorEmail} · ` : ''}
                    {selected.source === 'whmcs' ? 'via the WHMCS site' : 'via the public site'} · {selected.status}
                    {selected.escalatedAt ? ` · handed to support ${timeLabel(selected.escalatedAt)}` : ''}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                  <button type="button" className="ch247-btn" onClick={() => void toggleHandling()}>
                    {selected.aiHandling === 'ai' ? 'Take over from AI' : 'Return to AI'}
                  </button>
                  <button type="button" className="ch247-btn" onClick={() => void toggleStatus()}>
                    {selected.status === 'open' ? 'Close conversation' : 'Reopen conversation'}
                  </button>
                </div>
              </div>

              <div ref={scroller} aria-live="polite" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '.5rem', paddingBottom: '.5rem' }}>
                {messages.map((message) => (
                  <div
                    key={message.seq}
                    style={{
                      alignSelf: message.author === 'staff' ? 'flex-end' : 'flex-start',
                      maxWidth: '80%',
                      padding: '.45rem .65rem',
                      borderRadius: 12,
                      border: message.author === 'ai' ? '1px solid #ddd6fe' : '1px solid #e2e8f0',
                      background: message.author === 'staff' ? '#ccfbf1' : message.author === 'ai' ? '#ede9fe' : '#fff',
                    }}
                  >
                    <div style={{ fontSize: '.68rem', fontWeight: 700, color: message.author === 'ai' ? '#6d28d9' : '#0f766e' }}>
                      {message.author === 'staff' ? message.authorName ?? 'You' : message.author === 'ai' ? 'CloudHost247 AI Support' : visitorLabel(selected)}
                      <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: '.4rem' }}>{timeLabel(message.createdAt)}</span>
                    </div>
                    <p style={{ margin: '.2rem 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{message.body}</p>
                  </div>
                ))}
                {threadState === 'ready' && messages.length === 0 && (
                  <p className="ch247-page__hint">No messages yet — the visitor has not written anything.</p>
                )}
              </div>

              {threadError && <CatalogErrorBanner message={threadError} />}

              <form onSubmit={sendReply} style={{ display: 'flex', gap: '.5rem', borderTop: '1px solid #e2e8f0', paddingTop: '.6rem' }}>
                <input
                  type="text"
                  value={reply}
                  maxLength={4000}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={selected.status === 'closed' ? 'Conversation closed — reopen to reply' : 'Type your reply…'}
                  aria-label="Type your reply"
                  disabled={selected.status === 'closed'}
                  style={{ flex: 1, padding: '.6rem .7rem', border: '1px solid #cbd5e1', borderRadius: 8, font: 'inherit' }}
                />
                <button type="submit" className="ch247-btn ch247-btn--primary" disabled={sending || !reply.trim() || selected.status === 'closed'}>
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </form>
            </>
          )}
          {threadState === 'error' && <CatalogErrorBanner message={threadError} />}
        </div>
      </div>
    </div>
  );
}
