import { useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { trackMarketing } from '../lib/marketing';
import { usePageMeta } from '../lib/usePageMeta';
import './contact-page.css';

const departments = ['General support', 'Billing', 'Abuse & security', 'Privacy & data protection', 'Legal'];

export default function ContactPage() {
  usePageMeta('Contact', 'Contact the CloudHost247 team.');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setSending(true);
    setStatus('idle');
    try {
      const response = await apiFetch<{ marketingEvent?: { eventName: string; eventId: string; customData: Record<string, unknown> } | null }>('/api/v1/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      if (response.marketingEvent) {
        trackMarketing(response.marketingEvent.eventName, response.marketingEvent.customData, response.marketingEvent.eventId);
        trackMarketing('Lead', { content_name: 'Contact form' }, response.marketingEvent.eventId.replace(/^contact:/,'lead:'));
      }
      form.reset();
      setStatus('success');
    } catch {
      setStatus('error');
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact ch247-contact-hero">
        <div className="ch247-hero__inner">
          <h1>Contact Us</h1>
          <p>Have a question? Send us a message and choose the department that can help.</p>
        </div>
      </section>
      <section className="ch247-section">
        <div className="ch247-page ch247-contact">
          <h2>Send us a message</h2>
          <p>Choose a department and tell us how we can help. Our team will review your message in the shared inbox.</p>
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
      </section>
    </div>
  );
}
