import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import { aiCustomerApi, AiActivityResponse } from '../../lib/ai-os-api';

/* ------------------------------------------------------------------------------------------------
 * Customer Cloud Assistant — scoped to the caller's own account.
 * The server forces `customerScopeUserId = auth.userId` regardless of payload; questions resolve
 * through customer-usable tools only. This UI mirrors that honesty: it never claims the AI can
 * do more than the tool registry allows.
 * ------------------------------------------------------------------------------------------------ */

interface Turn {
  question: string;
  answer: string;
  intent: string | null;
  supported: string[] | null;
}

const SUGGESTIONS = [
  'show my invoices',
  'what is my billing status',
  'my subscriptions and services',
  'my domain dns records',
  'my ssl certificate status',
];

export default function AiAssistantPage() {
  usePageMeta('Cloud Assistant', 'Ask about your CloudHost247 account — invoices, payments, services, domains, SSL or support tickets.');
  const [message, setMessage] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [activity, setActivity] = useState<AiActivityResponse | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [a, p] = await Promise.all([aiCustomerApi.activity(), aiCustomerApi.profile()]);
        setActivity(a);
        setProfile(p);
      } catch {
        // Activity/profile enrich the page but are not required for conversing.
      }
    })();
  }, []);

  async function ask(e: FormEvent) {
    e.preventDefault();
    const q = message.trim();
    if (!q || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await aiCustomerApi.ask(q);
      setTurns((t) => [...t, { question: q, answer: res.answer, intent: res.intent, supported: res.supported }]);
      setMessage('');
      // Refresh transparency panel after each exchange (a ticket may have opened).
      const a = await aiCustomerApi.activity().catch(() => null);
      if (a) setActivity(a);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Assistant could not respond');
    } finally {
      setBusy(false);
    }
  }

  const taskCount = activity?.tasks?.length ?? 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Cloud Assistant</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Ask about your CloudHost247 account — invoices, payments, services, subscriptions, domains, SSL and support tickets.
          The assistant reads only your own account data; every query is recorded and visible to you under AI Activity.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="max-h-[32rem] min-h-48 space-y-4 overflow-y-auto p-5">
              {turns.length === 0 ? (
                <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                  <p className="font-medium text-slate-800">How can I help with your account?</p>
                  <p className="mt-1">I answer from your real records. If something isn't in your account or our documentation, I'll say so plainly instead of guessing.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => setMessage(s)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                turns.map((t, i) => (
                  <div key={i} className="space-y-2">
                    <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-slate-900 px-4 py-2 text-sm text-white">{t.question}</div>
                    <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-3 text-sm text-slate-800">
                      <pre className="whitespace-pre-wrap font-sans">{t.answer}</pre>
                      {t.supported ? (
                        <p className="mt-2 text-xs text-slate-500">Try: {t.supported.slice(0, 5).join(' · ')}</p>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
            <form onSubmit={ask} className="flex gap-2 border-t border-slate-100 p-3">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder='Ask about your account… (e.g. "show my invoices" or "open ticket: my service is down")'
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
              <button disabled={busy || message.trim().length < 2} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                {busy ? '…' : 'Ask'}
              </button>
            </form>
          </div>
          {error ? <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">AI transparency</h2>
            <p className="mt-1 text-xs text-slate-500">
              What the AI has done on your account — nothing happens outside this register.
            </p>
            <p className="mt-3 text-2xl font-bold text-slate-900">{taskCount}</p>
            <p className="text-xs text-slate-500">task(s) recorded for your account</p>
            {activity && (activity.approvals?.length ?? 0) > 0 ? (
              <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                {activity.approvals.length} action request(s) about your account required a human decision before execution.
              </p>
            ) : null}
          </section>

          {profile ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Your account at a glance</h2>
              <dl className="mt-2 space-y-1 text-xs text-slate-600">
                {Object.entries((profile.metrics as Record<string, unknown> | undefined) ?? {})
                  .slice(0, 8)
                  .map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <dt className="capitalize">{k.replace(/([A-Z])/g, ' $1').trim()}</dt>
                      <dd className="font-semibold text-slate-800">{String(v)}</dd>
                    </div>
                  ))}
              </dl>
            </section>
          ) : null}

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm text-xs text-slate-500">
            <p>
              The assistant cannot message you unprompted or change your services. Opening a support ticket uses your words,
              exactly as asked. Full history is in <Link className="text-indigo-600 hover:underline" to="/support">Support</Link>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
