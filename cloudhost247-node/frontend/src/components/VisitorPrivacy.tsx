import { useEffect, useState } from 'react';
import { publicFetch } from '../lib/api';
import CountrySwitcher from './CountrySwitcher';

/**
 * Why the endpoint returned no address, exactly as `src/routes/visitor-ip.ts` defines it. Anything
 * outside this list is treated as `unreachable` rather than guessed at: the server names the reason,
 * the widget never invents one.
 */
const REASONS = ['disabled', 'unverified', 'not_public'] as const;
type NoIpReason = (typeof REASONS)[number] | 'unreachable';

/** Short, visible label. Kept to roughly the width of the old "unavailable" so the utility line's
 *  measured layout (scripts/check-chrome-benchmark.mjs) does not move. */
const SHORT_LABEL: Record<NoIpReason, string> = {
  disabled: 'not enabled',
  unverified: 'unverified',
  not_public: 'not public',
  unreachable: 'unavailable',
};

/** Full explanation for the tooltip and the accessible name. */
const EXPLANATION: Record<NoIpReason, string> = {
  disabled: 'IP detection is switched off on this server, so no address is read from your connection.',
  unverified: 'IP detection is on, but the network path to this server could not be verified for your connection, so no address is claimed.',
  not_public: 'The address seen for your connection is not a public one (loopback, private or reserved), so it is not reported as your IP.',
  unreachable: 'The IP detection request did not complete, so nothing is claimed.',
};

function reasonOf(value: unknown): NoIpReason {
  return typeof value === 'string' && (REASONS as readonly string[]).includes(value)
    ? (value as NoIpReason)
    : 'unreachable';
}

/** IP is kept only in component state and is never sent to analytics or a third party. */
export default function VisitorPrivacy() {
  const [ip, setIp] = useState<string | null>(null);
  const [reason, setReason] = useState<NoIpReason>('unreachable');
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (cancelled || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const result = await publicFetch<{ ip?: unknown; reason?: unknown }>('/api/v1/visitor/ip', {
          cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
        });
        if (cancelled) return;
        const valid = typeof result.ip === 'string' && result.ip.length <= 45 && /^[a-fA-F0-9:.]+$/.test(result.ip);
        setIp(valid ? (result.ip as string) : null);
        setReason(valid ? 'unreachable' : reasonOf(result.reason));
      } catch {
        if (!cancelled) { setIp(null); setReason('unreachable'); }
      } finally { inFlight = false; }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5 * 60 * 1000);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  const message = ip
    ? 'Privacy status cannot be verified · Your public IP is visible to this website'
    : 'Privacy status cannot be verified · Your public IP may be visible to websites you visit';
  const ipLabel = ip
    ? `Your public IP address as this server observed it: ${ip}`
    : `Your public IP address was not reported: ${EXPLANATION[reason]}`;
  return (
    <div className="ch247-visitor-privacy">
      <div className="ch247-visitor-privacy__location">
        <CountrySwitcher />
        {/* The visible label stays short (the utility line is measured by
            scripts/check-chrome-benchmark.mjs); the full reason is a visually-hidden continuation
            inside the same live region, so a screen reader hears why nothing was reported instead
            of only hearing a bare "unavailable". `title` covers pointer users. */}
        <span className="ch247-visitor-privacy__ip" aria-live="polite" title={ipLabel}>
          IP: {ip ?? SHORT_LABEL[reason]}
          {!ip ? <span className="sr-only">. {EXPLANATION[reason]}</span> : null}
        </span>
      </div>
      <div className="ch247-privacy-ticker" role="region" aria-label="Privacy status">
        <span className="ch247-privacy-ticker__dot" aria-hidden="true" />
        <div className="ch247-privacy-ticker__viewport">
          <div className="ch247-privacy-ticker__track">
            <span className="ch247-privacy-ticker__message">{message}</span>
            <span className="ch247-privacy-ticker__message" aria-hidden="true">{message}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
