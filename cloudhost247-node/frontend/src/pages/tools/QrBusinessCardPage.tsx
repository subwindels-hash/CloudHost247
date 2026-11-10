/**
 * QR Business Card Designer — /tools/qr-business-card-designer
 *
 * Three things make this page different from a generic "vCard QR" generator:
 *
 *  1. **The card is the artefact.** The QR is only useful if it is big enough to scan from a card held
 *     at arm's length, so the preview is the card at its real 85 × 55 mm size and the format picker
 *     explains the trade-off instead of hiding it.
 *  2. **The payload is shown.** A vCard is text; a wrong field separator produces a contact that
 *     imports with the phone number as the last name. The exact payload is printed under the preview.
 *  3. **The logo is raster-only.** An uploaded SVG is refused by the server and by this page, because
 *     a data URL in a rendered document is not a place for a file that can carry script.
 */
import { useEffect, useRef, useState } from 'react';
import { usePageMeta } from '../../lib/usePageMeta';
import { copyText, runListing, runStudio, type StudioResponse } from '../../lib/design-studio';
import StudioFrame, { StudioCheck, StudioField, StudioInput, StudioSelect, StudioTextarea } from '../../components/design-studio/StudioFrame';
import SavedTemplatesPanel from '../../components/design-studio/SavedTemplatesPanel';

interface CardTemplateMeta {
  id: string;
  name: string;
  sizeMm: { width: number; height: number };
  blurb: string;
  ground: 'light' | 'dark';
}

interface CardFieldRule {
  key: string;
  label: string;
  maxLength: number;
  placeholder?: string;
  type?: string;
}

const FALLBACK_TEMPLATES: CardTemplateMeta[] = [
  { id: 'classic-white', name: 'Classic white', sizeMm: { width: 85, height: 55 }, blurb: 'Dark text on white, QR right.', ground: 'light' },
  { id: 'dark-slate', name: 'Dark slate', sizeMm: { width: 85, height: 55 }, blurb: 'Light text on slate, QR left.', ground: 'dark' },
];

const FALLBACK_FIELDS: CardFieldRule[] = [
  { key: 'firstName', label: 'First name', maxLength: 60, placeholder: 'Ada' },
  { key: 'lastName', label: 'Last name', maxLength: 60, placeholder: 'Obi' },
  { key: 'title', label: 'Job title', maxLength: 80, placeholder: 'Logistics Manager' },
  { key: 'company', label: 'Company', maxLength: 100, placeholder: 'CloudHost247 Ltd' },
  { key: 'department', label: 'Department', maxLength: 60, placeholder: 'Operations' },
  { key: 'phone', label: 'Phone', maxLength: 32, placeholder: '+234 800 000 0000', type: 'tel' },
  { key: 'mobile', label: 'Mobile', maxLength: 32, placeholder: '+234 801 111 1111', type: 'tel' },
  { key: 'email', label: 'Email', maxLength: 120, placeholder: 'ada@cloudhost247.com', type: 'email' },
  { key: 'website', label: 'Website', maxLength: 200, placeholder: 'https://cloudhost247.com', type: 'url' },
  { key: 'address', label: 'Street address', maxLength: 120 },
  { key: 'city', label: 'City', maxLength: 60 },
  { key: 'region', label: 'State / region', maxLength: 60 },
  { key: 'postcode', label: 'Postcode', maxLength: 20 },
  { key: 'country', label: 'Country', maxLength: 60 },
  { key: 'note', label: 'Note or tagline', maxLength: 160 },
];

const ACCEPTED_LOGO = /^data:image\/(png|jpeg|webp|gif);base64,/i;

export default function QrBusinessCardPage() {
  usePageMeta(
    'QR Business Card Designer — a printable card that scans into a contact',
    'Design a printable 85 × 55 mm business card whose QR code imports as a vCard or MeCard contact. Choose a template, add your details and download a print-ready PDF.'
  );

  const [templates, setTemplates] = useState<CardTemplateMeta[]>(FALLBACK_TEMPLATES);
  const [fields, setFields] = useState<CardFieldRule[]>(FALLBACK_FIELDS);
  const [templateId, setTemplateId] = useState('classic-white');
  const [side, setSide] = useState<'front' | 'back' | 'both'>('both');
  const [payloadFormat, setPayloadFormat] = useState<'vcard' | 'mecard'>('vcard');
  const [contact, setContact] = useState<Record<string, string>>({
    firstName: 'Ada',
    lastName: 'Obi',
    title: 'Logistics Manager',
    company: 'CloudHost247 Ltd',
    department: 'Operations',
    phone: '+234 800 000 0000',
    mobile: '+234 801 111 1111',
    email: 'ada@cloudhost247.com',
    website: 'https://cloudhost247.com',
    address: '12 Rukuba Road',
    city: 'Jos',
    region: 'Plateau',
    postcode: '930101',
    country: 'Nigeria',
    note: 'Despatch and freight',
    logoDataUrl: '',
  });
  const [result, setResult] = useState<StudioResponse | null>(null);
  const [payload, setPayload] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [logoError, setLogoError] = useState('');
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const response = await runListing<{ templates?: CardTemplateMeta[]; fields?: CardFieldRule[] }>('qr-business-card-designer', { action: 'templates' });
      if (!live || !response.data) return;
      if (response.data.templates?.length) setTemplates(response.data.templates);
      if (response.data.fields?.length) setFields(response.data.fields);
    })();
    return () => {
      live = false;
    };
  }, []);

  const update = (key: string) => (value: string) => setContact((previous) => ({ ...previous, [key]: value }));

  // The payload preview is a separate, cheap call: it lets the page show the *exact* text that will be
  // encoded without rendering the card on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        const response = await runListing<{ payload?: string }>('qr-business-card-designer', { action: 'payload', contact, payloadFormat });
        if (response.data?.payload) setPayload(response.data.payload);
      })();
    }, 350);
    return () => clearTimeout(timer);
  }, [contact, payloadFormat]);

  const run = async () => {
    setBusy(true);
    const response = await runStudio('qr-business-card-designer', { action: 'preview', templateId, side, payloadFormat, contact, pdf: true });
    setBusy(false);
    if (!response.ok || !response.data) {
      setError(response.error ?? { code: 'UNKNOWN', message: 'The card could not be generated.' });
      return;
    }
    setError(null);
    setResult(response.data);
  };

  const readLogo = (file: File) => {
    setLogoError('');
    if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) {
      setLogoError('Use a PNG, JPEG, WebP or GIF. An SVG logo is refused: an SVG can carry script and this image is embedded in the printed document.');
      return;
    }
    if (file.size > 512 * 1024) {
      setLogoError(`That file is ${Math.round(file.size / 1024)} KB; the maximum is 512 KB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? '');
      if (!ACCEPTED_LOGO.test(value)) {
        setLogoError('That file could not be read as an embedded image.');
        return;
      }
      setContact((previous) => ({ ...previous, logoDataUrl: value }));
    };
    reader.onerror = () => setLogoError('The file could not be read.');
    reader.readAsDataURL(file);
  };

  const shown = fields.filter((rule) => rule.key in contact);

  return (
    <StudioFrame
      title="QR Business Card Designer"
      lede="A printable business card whose QR code imports as a contact — vCard 3.0 by default, MeCard if you need the smaller payload. Front and back, one PDF."
      config={
        <>
          <h2>Template</h2>
          <div className="ch247-studio__templates">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                className="ch247-studio__template"
                aria-pressed={template.id === templateId}
                onClick={() => setTemplateId(template.id)}
              >
                <strong>{template.name}</strong>
                <span>
                  {template.sizeMm.width} × {template.sizeMm.height} mm · {template.blurb}
                </span>
              </button>
            ))}
          </div>

          <div className="ch247-studio__fields" style={{ marginTop: '0.75rem' }}>
            <StudioSelect
              label="Sides"
              value={side}
              options={[
                { value: 'both', label: 'Front and back (2-page PDF)' },
                { value: 'front', label: 'Front only' },
                { value: 'back', label: 'Back only' },
              ]}
              onChange={setSide}
            />
            <StudioSelect
              label="Contact format"
              value={payloadFormat}
              options={[
                { value: 'vcard', label: 'vCard 3.0 — widest support' },
                { value: 'mecard', label: 'MeCard — shorter, no title or department' },
              ]}
              onChange={setPayloadFormat}
              hint={payloadFormat === 'mecard' ? 'MeCard cannot carry a job title or department; those fields are dropped from the coded payload (and the card warns about it).' : 'vCard 3.0 carries name, organisation, title, phone, email, address and website.'}
            />
          </div>

          <h3 style={{ marginTop: '1rem' }}>Details</h3>
          <div className="ch247-studio__fields">
            {shown.map((rule) => (
              <StudioInput
                key={rule.key}
                label={rule.label}
                value={contact[rule.key] ?? ''}
                placeholder={rule.placeholder}
                maxLength={rule.maxLength}
                type={rule.type === 'email' ? 'email' : rule.type === 'url' ? 'url' : rule.type === 'tel' ? 'tel' : 'text'}
                onChange={update(rule.key)}
              />
            ))}
          </div>

          <div className="ch247-studio__fields ch247-studio__fields--single" style={{ marginTop: '0.75rem' }}>
            <StudioTextarea label="Note" value={contact.note ?? ''} onChange={update('note')} rows={2} maxLength={160} />
            <StudioField label="Logo" htmlFor="card-logo" hint="Optional. PNG, JPEG, WebP or GIF, up to 512 KB. It is placed in the document, not linked, so the PDF is self-contained.">
              <input
                id="card-logo"
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) readLogo(file);
                }}
              />
            </StudioField>
            {logoError ? <p className="ch247-studio__issue ch247-studio__issue--error">{logoError}</p> : null}
            {contact.logoDataUrl ? (
              <div className="ch247-studio__check">
                <img src={contact.logoDataUrl} alt="Selected logo preview" style={{ height: '2.5rem', border: '1px solid var(--ch247-border)', borderRadius: '0.25rem', padding: '2px', background: '#fff' }} />
                <button
                  type="button"
                  className="ch247-button ch247-button--ghost ch247-button--small"
                  onClick={() => {
                    setContact((previous) => ({ ...previous, logoDataUrl: '' }));
                    if (fileInput.current) fileInput.current.value = '';
                  }}
                >
                  Remove logo
                </button>
              </div>
            ) : null}
          </div>

          <div className="ch247-studio__actions">
            <button type="button" className="ch247-button" onClick={() => void run()} disabled={busy}>
              {busy ? 'Generating…' : 'Generate card'}
            </button>
          </div>
        </>
      }
      result={result}
      busy={busy}
      error={error}
      extra={
        <SavedTemplatesPanel
          kind="card"
          document={{ templateId, side, payloadFormat, contact }}
          defaultName={templateId}
          summary={templates.find((entry) => entry.id === templateId)?.name ?? templateId}
          onLoad={(document) => {
            if (typeof document.templateId === 'string') setTemplateId(document.templateId);
            if (document.side === 'front' || document.side === 'back' || document.side === 'both') setSide(document.side);
            if (document.payloadFormat === 'vcard' || document.payloadFormat === 'mecard') setPayloadFormat(document.payloadFormat);
            const loaded = document.contact;
            if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
              setContact((previous) => ({ ...previous, ...(loaded as Record<string, string>) }));
            }
          }}
        />
      }
      exports={{ stem: payloadFormat, pdf: true, svg: true, png: true, print: true }}
      resultDetail={
        payload ? (
          <div style={{ marginTop: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <h3 className="ch247-studio__label" style={{ margin: 0 }}>
                Encoded contact ({payload.length} characters)
              </h3>
              <button
                type="button"
                className="ch247-button ch247-button--ghost ch247-button--small"
                onClick={async () => {
                  setCopied(await copyText(payload));
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre style={{ fontSize: '0.72rem', lineHeight: 1.5, background: '#faf9f7', border: '1px solid var(--ch247-border)', borderRadius: '0.35rem', padding: '0.6rem', overflowX: 'auto', marginTop: '0.4rem' }}>
              {payload}
            </pre>
            <p className="ch247-studio__hint">
              This is exactly what a phone reads when it scans the code. Check it before you print: a misplaced semicolon shows up in the
              address book as a field in the wrong place.
            </p>
          </div>
        ) : null
      }
      usage={
        <>
          <h2>vCard or MeCard?</h2>
          <p>
            <strong>vCard 3.0</strong> is the safe default: every recent phone, address book and CRM imports it, and it carries a job title,
            department, both phone numbers and a full address. <strong>MeCard</strong> is short — it fits a smaller QR code — but it has no
            field for a job title or department, so those values cannot be encoded, only printed on the card.
          </p>
          <h2>Making the code scannable</h2>
          <ul>
            <li>The QR code is placed on a white panel at no less than 18–20 mm. Below that, a phone camera struggles on a glossy card in office light.</li>
            <li>The card template fixes the size; the payload length decides the module count. If you need a dense payload, MeCard and fewer fields help.</li>
            <li>Print on uncoated or matte stock if you can. A high-gloss laminate over a QR code is the most common reason a card will not scan.</li>
          </ul>
          <h2>Logos</h2>
          <p>
            A logo is embedded as a raster image in the PDF. SVG is refused, because an SVG can carry script and this value is embedded
            straight into the rendered document. Keep the file under 512 KB; a large image makes the PDF heavy without looking better at
            business-card size.
          </p>
        </>
      }
      faq={[
        {
          q: 'Will this card scan as a contact on an iPhone and Android?',
          a: 'Yes for vCard 3.0 — both platforms import it as a contact. MeCard is an Android-era format: iOS support is uneven, which is why vCard is the default rather than an alternative.',
        },
        {
          q: 'Why is the QR code not in the middle of the card?',
          a: 'Because a code in the middle forces the text to wrap around it, and a code partly over a coloured band scans badly. The templates place it on a clear white panel, at the size the card can afford.',
        },
        {
          q: 'Can I add my photo?',
          a: 'A logo, yes. A vCard photo could be encoded into the payload, but it multiplies the code density and is the fastest way to make a card that no phone can read. Not offered here for that reason.',
        },
        {
          q: 'Is my contact detail stored?',
          a: 'No. It is posted for one request, rendered, and discarded. The only thing the audit log records is the template name — never the contact fields.',
        },
      ]}
      related={[
        { title: 'QR Code Generator', href: '/tools/qr-code-generator', blurb: 'A single QR code for a URL, WiFi network or vCard.' },
        { title: 'Label Designer', href: '/tools/label-designer', blurb: 'Address, product, asset and parcel labels.' },
        { title: 'Barcode Generator', href: '/tools/barcode-generator', blurb: 'Linear and 2D symbologies with exact module control.' },
        { title: 'Employee ID Card Generator', href: '/tools/business-tools/employee-id-card-generator', blurb: 'PVC-style staff cards with a photo and a barcode.' },
      ]}
    />
  );
}
