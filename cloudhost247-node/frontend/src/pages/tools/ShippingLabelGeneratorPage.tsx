/**
 * Shipping Label Generator — /tools/shipping-label-generator
 *
 * The page's honesty constraint shows in two places: there is no carrier picker (a carrier logo and
 * a carrier barcode are the carrier's artwork, and inventing them produces a label a driver will not
 * accept), and the carrier notice returned by every response is rendered under the preview.
 *
 * `reference` and `trackingNumber` are separate fields on purpose. A seller's own order reference is
 * not a tracking number; printing one in the other's place is how a parcel becomes untraceable.
 */
import { useEffect, useState } from 'react';
import { usePageMeta } from '../../lib/usePageMeta';
import { runListing, runStudio, type StudioResponse } from '../../lib/design-studio';
import StudioFrame, { StudioField, StudioInput, StudioSelect, StudioTextarea } from '../../components/design-studio/StudioFrame';

interface TemplateMeta {
  id: string;
  name: string;
  sizeMm: { width: number; height: number };
  blurb: string;
  description: string;
  codes: string[];
}

const FALLBACK_TEMPLATES: TemplateMeta[] = [
  { id: 'thermal-100x150', name: 'Thermal parcel — 100 × 150 mm', sizeMm: { width: 100, height: 150 }, blurb: 'Courier-style parcel label.', description: '', codes: ['code128', 'qrcode'] },
  { id: 'address-70x40', name: 'Address sticker — 70 × 40 mm', sizeMm: { width: 70, height: 40 }, blurb: 'Compact address sticker.', description: '', codes: ['code128'] },
];

const CODE_LABELS: Record<string, string> = {
  code128: 'Code 128 — your own reference',
  'gs1-128': 'GS1-128 — SSCC and lot (needs an 18-digit SSCC)',
  qrcode: 'QR code — tracking page URL',
  datamatrix: 'Data Matrix',
};

export default function ShippingLabelGeneratorPage() {
  usePageMeta(
    'Shipping Label Generator — carrier-neutral parcel labels',
    'Create a print-ready parcel label from your own reference: sender and recipient blocks, a Code 128 or GS1-128 barcode and a QR tracking link on 100 × 150 mm thermal stock or a 70 × 40 mm sticker.'
  );

  const [templates, setTemplates] = useState<TemplateMeta[]>(FALLBACK_TEMPLATES);
  const [templateId, setTemplateId] = useState('thermal-100x150');
  const [code, setCode] = useState('code128');
  const [shipment, setShipment] = useState<Record<string, string>>({
    senderName: 'Ada Obi',
    senderCompany: 'CloudHost247 Ltd',
    senderAddress: '12 Rukuba Road\nJos North, Plateau 930101\nNigeria',
    senderPhone: '+234 800 000 0000',
    senderEmail: 'despatch@cloudhost247.com',
    recipientName: 'Musa Bello',
    recipientCompany: 'Sahel Retail Ltd',
    recipientAddress: '27 Ahmadu Bello Way\nKaduna South, Kaduna 800241\nNigeria',
    recipientPhone: '+234 801 111 1111',
    recipientEmail: '',
    reference: 'CH247-2026-000123',
    trackingNumber: '',
    carrier: '',
    service: 'Standard',
    weight: '1.8 kg',
    dimensions: '32 × 24 × 12 cm',
    pieces: '1 of 1',
    declaredValue: '',
    shipDate: '2026-11-09',
    instructions: '',
    sscc: '',
    gtin: '',
    trackingUrl: 'https://cloudhost247.com/track/CH247-2026-000123',
  });
  const [result, setResult] = useState<StudioResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const response = await runListing<{ templates?: TemplateMeta[] }>('shipping-label-generator', { action: 'templates' });
      if (live && response.data?.templates?.length) setTemplates(response.data.templates);
    })();
    return () => {
      live = false;
    };
  }, []);

  const update = (key: string) => (value: string) => setShipment((previous) => ({ ...previous, [key]: value }));

  const run = async () => {
    setBusy(true);
    const response = await runStudio('shipping-label-generator', { action: 'preview', templateId, code, shipment, pdf: true });
    setBusy(false);
    if (!response.ok || !response.data) {
      setError(response.error ?? { code: 'UNKNOWN', message: 'The label could not be generated.' });
      return;
    }
    setError(null);
    setResult(response.data);
  };

  const template = templates.find((entry) => entry.id === templateId);
  const carrierNotice = result ? String((result.meta as { carrierNotice?: string }).carrierNotice ?? '') : '';

  return (
    <StudioFrame
      title="Shipping Label Generator"
      lede="A parcel label from your own reference and addresses, with a scannable Code 128 or GS1-128 symbol and a QR link to your tracking page — no carrier artwork, no invented tracking numbers."
      notice={
        <div className="ch247-studio__notice">
          <strong>Carrier-neutral by design.</strong> This tool cannot issue a carrier&rsquo;s own label: it has no carrier logo, no carrier
          barcode artwork and no carrier-issued tracking number. Use it for your own despatch labels, or as the outer label alongside the
          carrier&rsquo;s document.
        </div>
      }
      config={
        <>
          <h2>Template</h2>
          <div className="ch247-studio__templates">
            {templates.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="ch247-studio__template"
                aria-pressed={entry.id === templateId}
                onClick={() => setTemplateId(entry.id)}
              >
                <strong>{entry.name}</strong>
                <span>
                  {entry.sizeMm.width} × {entry.sizeMm.height} mm · {entry.blurb}
                </span>
              </button>
            ))}
          </div>

          <div className="ch247-studio__fields" style={{ marginTop: '0.75rem' }}>
            <StudioSelect
              label="Barcode"
              value={code}
              options={(template?.codes ?? ['code128', 'qrcode']).map((entry) => ({ value: entry, label: CODE_LABELS[entry] ?? entry }))}
              onChange={setCode}
              hint={code === 'gs1-128' ? 'GS1-128 needs an 18-digit SSCC; without one the label prints the problem rather than an unscannable symbol.' : undefined}
            />
          </div>

          <h3 style={{ marginTop: '1rem' }}>Sender</h3>
          <div className="ch247-studio__fields">
            <StudioInput label="Name" value={shipment.senderName ?? ''} onChange={update('senderName')} maxLength={80} />
            <StudioInput label="Company" value={shipment.senderCompany ?? ''} onChange={update('senderCompany')} maxLength={100} />
            <StudioInput label="Phone" type="tel" value={shipment.senderPhone ?? ''} onChange={update('senderPhone')} maxLength={32} />
            <StudioInput label="Email" type="email" value={shipment.senderEmail ?? ''} onChange={update('senderEmail')} maxLength={120} />
          </div>
          <div className="ch247-studio__fields ch247-studio__fields--single" style={{ marginTop: '0.75rem' }}>
            <StudioTextarea label="Address" value={shipment.senderAddress ?? ''} onChange={update('senderAddress')} rows={3} maxLength={400} />
          </div>

          <h3 style={{ marginTop: '1rem' }}>Recipient</h3>
          <div className="ch247-studio__fields">
            <StudioInput label="Name" value={shipment.recipientName ?? ''} onChange={update('recipientName')} maxLength={80} />
            <StudioInput label="Company" value={shipment.recipientCompany ?? ''} onChange={update('recipientCompany')} maxLength={100} />
            <StudioInput label="Phone" type="tel" value={shipment.recipientPhone ?? ''} onChange={update('recipientPhone')} maxLength={32} />
            <StudioInput label="Email" type="email" value={shipment.recipientEmail ?? ''} onChange={update('recipientEmail')} maxLength={120} />
          </div>
          <div className="ch247-studio__fields ch247-studio__fields--single" style={{ marginTop: '0.75rem' }}>
            <StudioTextarea label="Address" value={shipment.recipientAddress ?? ''} onChange={update('recipientAddress')} rows={3} maxLength={400} />
          </div>

          <h3 style={{ marginTop: '1rem' }}>Shipment</h3>
          <div className="ch247-studio__fields">
            <StudioInput
              label="Your reference"
              hint="Your own order or despatch number. It is what the barcode carries unless you supply a tracking number."
              value={shipment.reference ?? ''}
              onChange={update('reference')}
              maxLength={40}
            />
            <StudioInput
              label="Tracking number (optional)"
              hint="Only a number your carrier actually issued. Leaving it blank is correct for a new shipment."
              value={shipment.trackingNumber ?? ''}
              onChange={update('trackingNumber')}
              maxLength={40}
            />
            <StudioInput label="Service" value={shipment.service ?? ''} onChange={update('service')} maxLength={40} />
            <StudioInput label="Weight" value={shipment.weight ?? ''} onChange={update('weight')} maxLength={20} />
            <StudioInput label="Dimensions" value={shipment.dimensions ?? ''} onChange={update('dimensions')} maxLength={40} />
            <StudioInput label="Pieces" value={shipment.pieces ?? ''} onChange={update('pieces')} maxLength={20} placeholder="1 of 1" />
            <StudioInput label="Ship date" type="date" value={shipment.shipDate ?? ''} onChange={update('shipDate')} maxLength={10} />
            <StudioInput label="SSCC (GS1-128 only)" hint="18 digits for AI (00)." value={shipment.sscc ?? ''} onChange={update('sscc')} maxLength={20} />
            <StudioInput label="GTIN (optional)" value={shipment.gtin ?? ''} onChange={update('gtin')} maxLength={14} />
            <StudioInput label="QR destination" type="url" hint="The tracking page the QR code opens." value={shipment.trackingUrl ?? ''} onChange={update('trackingUrl')} maxLength={300} />
          </div>
          <div className="ch247-studio__fields ch247-studio__fields--single" style={{ marginTop: '0.75rem' }}>
            <StudioTextarea label="Instructions" value={shipment.instructions ?? ''} onChange={update('instructions')} rows={2} maxLength={200} placeholder="Handle with care · This way up" />
          </div>

          <div className="ch247-studio__actions">
            <button type="button" className="ch247-button" onClick={() => void run()} disabled={busy}>
              {busy ? 'Generating…' : 'Generate label'}
            </button>
          </div>
        </>
      }
      result={result}
      busy={busy}
      error={error}
      exports={{ stem: templateId, pdf: true, svg: true, png: true, print: true }}
      resultDetail={
        result && carrierNotice ? (
          <p className="ch247-studio__notice" style={{ marginTop: '0.75rem' }}>
            {carrierNotice}
          </p>
        ) : null
      }
      usage={
        <>
          <h2>Reference versus tracking number</h2>
          <p>
            Your <strong>reference</strong> is the number you assigned — an order id, a despatch note. It is what the barcode carries, and
            it is the number you will read when the parcel comes back to you. A <strong>tracking number</strong> is issued by the carrier
            after it accepts the parcel. The two are separate fields because a label that prints one where the other belongs misroutes the
            first scan.
          </p>
          <h2>GS1-128</h2>
          <p>
            For warehouses that scan Application Identifiers. AI (00) needs an 18-digit SSCC, and the reference becomes AI (10) lot data. If
            the element string is incomplete the label reports the problem instead of rendering a symbol that no scanner can read. Choose it
            only when the receiving warehouse asked for it.
          </p>
          <h2>Printing</h2>
          <ul>
            <li>Print at 100%. A &ldquo;fit to page&rdquo; setting shrinks the module width and can put the symbol below the scanner&rsquo;s resolution.</li>
            <li>Thermal stock is usually 100 × 150 mm; the 70 × 40 mm sticker is for envelopes and small parcels.</li>
            <li>Keep the label flat and untaped over the bars: a glossy tape over a Code 128 is a common cause of a failed scan.</li>
          </ul>
        </>
      }
      faq={[
        {
          q: 'Does this produce a DHL, UPS or FedEx label?',
          a: 'No. Those labels carry the carrier’s own artwork and a tracking number the carrier issues. This tool is for your own despatch label and says so on every response. Generating something that looks like a carrier label but is not one is exactly the failure this tool refuses.',
        },
        {
          q: 'Can I add my own tracking number?',
          a: 'Yes — if your carrier gave you one, put it in the tracking-number field. Left blank, the label simply does not claim one, which is the honest state before a carrier has accepted the parcel.',
        },
        {
          q: 'Are the addresses stored?',
          a: 'No. They are posted to this server for one request, rendered, and discarded: no cache, no history entry and no report. The audit record for this tool is the template and the reference only.',
        },
        {
          q: 'Why does the QR code need an https URL?',
          a: 'Because you host the tracking page. The QR code points wherever you tell it to; if the URL is wrong the scan fails at the doorstep, so the payload is shown under the preview for you to check before printing.',
        },
      ]}
      related={[
        { title: 'Label Designer', href: '/tools/label-designer', blurb: 'Address, product and asset labels from templates.' },
        { title: 'VDA 4902 Label Generator', href: '/tools/vda-4902-label-generator', blurb: 'Automotive goods tags with a PDF417 data field.' },
        { title: 'QR Business Card Designer', href: '/tools/qr-business-card-designer', blurb: 'A contact card that scans into an address book.' },
        { title: 'Barcode Generator', href: '/tools/barcode-generator', blurb: 'Test a single symbol before you print a batch.' },
      ]}
    />
  );
}
