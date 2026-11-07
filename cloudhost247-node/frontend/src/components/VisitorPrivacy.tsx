import { useEffect, useState } from 'react';
import { publicFetch } from '../lib/api';
import CountrySwitcher from './CountrySwitcher';

/** IP is kept only in component state and is never sent to analytics or a third party. */
export default function VisitorPrivacy() {
  const [ip, setIp] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (cancelled || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const result = await publicFetch<{ ip?: unknown }>('/api/v1/visitor/ip', {
          cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
        });
        if (!cancelled) setIp(typeof result.ip === 'string' && result.ip.length <= 45 && /^[a-fA-F0-9:.]+$/.test(result.ip) ? result.ip : null);
      } catch {
        if (!cancelled) setIp(null);
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
  return (
    <div className="ch247-visitor-privacy">
      <div className="ch247-visitor-privacy__location">
        <CountrySwitcher />
        <span aria-hidden="true"> – </span>
        <span className="ch247-visitor-privacy__ip" aria-live="polite">IP: {ip ?? 'unavailable'}</span>
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
