import { useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { trackAnalyticsContact, trackMarketing } from '../lib/marketing';
import { trackTikTok } from '../lib/tiktok';
import { usePageMeta } from '../lib/usePageMeta';
import './contact-page.css';

const departments = ['General support', 'Billing', 'Abuse & security', 'Privacy & data protection', 'Legal'];

type StarStyle = CSSProperties & {
  '--star-x': string;
  '--star-y': string;
  '--star-size': string;
  '--star-delay': string;
  '--star-duration': string;
  '--star-drift': string;
  '--star-opacity': string;
  '--star-light-duration': string;
  '--star-light-delay': string;
};

/**
 * A deterministic star map keeps the decorative field stable across rerenders (and across the
 * analytics tests) while still looking scattered rather than grid-like. Every star gets its own
 * size, phase, speed and drift; the animation itself lives in CSS so JavaScript does no work
 * while the page is open.
 */
function pseudoRandom(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function bronzeStarStyles(count: number, group: number): StarStyle[] {
  return Array.from({ length: count }, (_, index) => {
    const seed = index + 1 + group * 100;
    const duration = 13 + pseudoRandom(seed + 31) * 13;
    return {
      '--star-x': `${(2 + pseudoRandom(seed) * 96).toFixed(2)}%`,
      '--star-y': `${(2 + pseudoRandom(seed + 7) * 96).toFixed(2)}%`,
      '--star-size': `${(8 + pseudoRandom(seed + 13) * 18).toFixed(1)}px`,
      '--star-delay': `${(-pseudoRandom(seed + 19) * duration).toFixed(2)}s`,
      '--star-duration': `${duration.toFixed(2)}s`,
      '--star-drift': `${((pseudoRandom(seed + 23) - 0.5) * 110).toFixed(1)}px`,
      '--star-opacity': (0.42 + pseudoRandom(seed + 29) * 0.48).toFixed(2),
      '--star-light-duration': `${(8 + pseudoRandom(seed + 37) * 5).toFixed(2)}s`,
      '--star-light-delay': `${(-pseudoRandom(seed + 41) * 13).toFixed(2)}s`,
    };
  });
}

const PAGE_STARS = bronzeStarStyles(60, 1);
const FORM_STARS = bronzeStarStyles(18, 2);

function BronzeStarField({ className, stars }: { className: string; stars: StarStyle[] }) {
  return (
    <div className={className} aria-hidden="true">
      {stars.map((style, index) => <span className="ch247-bronze-star" style={style} key={index} />)}
    </div>
  );
}

export default function ContactPage() {
  usePageMeta('Contact', 'Contact the CloudHost247 team.');
  const [sending, setSending] = useState(false);
  const submitting = useRef(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const form = event.currentTarget;
    const data = new FormData(form);
    setSending(true);
    setStatus('idle');
    try {
      const response = await apiFetch<{ received: boolean; marketingEvent?: { eventName: string; eventId: string; customData: Record<string, unknown> } | null }>('/api/v1/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      if (response.received !== true) throw new Error('Contact submission not confirmed');
      trackAnalyticsContact();
      if (response.marketingEvent) {
        trackMarketing(response.marketingEvent.eventName, response.marketingEvent.customData, response.marketingEvent.eventId);
        trackMarketing('Lead', { content_name: 'Contact form' }, response.marketingEvent.eventId.replace(/^contact:/,'lead:'));
        trackTikTok('SubmitForm', { content_name: 'Contact form', content_category: 'contact' }, response.marketingEvent.eventId.replace(/^contact:/, 'submit:'));
      }
      form.reset();
      setStatus('success');
    } catch {
      setStatus('error');
    } finally {
      submitting.current = false;
      setSending(false);
    }
  }

  return (
    <div className="ch247-contact-page">
      <BronzeStarField className="ch247-contact-page__stars" stars={PAGE_STARS} />
      <section className="ch247-hero ch247-hero--compact ch247-contact-hero">
        <div className="ch247-hero__inner">
          <p className="ch247-contact-hero__eyebrow"><span aria-hidden="true">✦</span> Premium support</p>
          <h1>Contact Us</h1>
          <p>Have a question? Send us a message and choose the department that can help.</p>
        </div>
      </section>
      <section className="ch247-section ch247-contact-section">
        <div className="ch247-page ch247-contact">
          <BronzeStarField className="ch247-contact-card__stars" stars={FORM_STARS} />
          <div className="ch247-contact__content">
            <p className="ch247-contact__eyebrow"><span aria-hidden="true">✦</span> Direct line to our team</p>
            <h2>Send us a message</h2>
            <p className="ch247-contact__lede">Choose a department and tell us how we can help. Our team will review your message in the shared inbox.</p>
            <form className="ch247-contact__form" onSubmit={submit}>
              <label htmlFor="contact-name">Your name</label>
              <input id="contact-name" name="name" autoComplete="name" maxLength={200} required />
              <label htmlFor="contact-email">Your email</label>
              <input id="contact-email" name="email" type="email" autoComplete="email" maxLength={255} required />
              <label htmlFor="contact-department">Department</label>
              <select id="contact-department" name="department" defaultValue="" required>
                <option value="" disabled>Select a department</option>
                {departments.map((department) => <option key={department} value={department}>{department}</option>)}
              </select>
              <label htmlFor="contact-subject">Subject</label>
              <input id="contact-subject" name="subject" maxLength={180} required />
              <label htmlFor="contact-message">Message</label>
              <textarea id="contact-message" name="message" rows={7} maxLength={10000} required />
              <button className="ch247-button" type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send message'}</button>
              {status === 'success' && <p role="status">Your message has been received. Thank you for contacting us.</p>}
              {status === 'error' && <p role="alert">We couldn’t send your message. Please try again later.</p>}
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
