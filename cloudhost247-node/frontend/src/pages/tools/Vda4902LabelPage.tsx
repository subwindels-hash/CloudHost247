/**
 * VDA 4902 Label Generator — /tools/vda-4902-label-generator
 *
 * This page carries a warning the other four do not, and it is not boilerplate: the tool renders the
 * two version-4 sizes from public descriptions of the standard, and it has not been certified by the
 * VDA or any vehicle manufacturer. The limitations returned by the API are rendered verbatim above
 * the form so nobody can print a goods tag believing it is accepted at goods-in without reading them.
 *
 * The field list also comes from the API (numbers, German captions, maximum lengths, which are
 * required), so the form cannot drift from the specification the generator validates against.
 */
import { useEffect, useMemo, useState } from 'react';
import { usePageMeta } from '../../lib/usePageMeta';
import { runListing, runStudio, type StudioResponse } from '../../lib/design-studio';
import StudioFrame, { StudioCheck, StudioField, StudioInput, StudioSelect } from '../../components/design-studio/StudioFrame';

interface VdaFieldSpec {
  no: number;
  key: string;
  label: string;
  german: string;
  required: boolean;
  maxLength: number;
  type: string;
  help: string;
  formats: string[];
}

const FALLBACK_FIELDS: VdaFieldSpec[] = [
  { no: 1, key: 'receiver', label: 'Goods receiver', german: 'Warenempfänger', required: true, maxLength: 60, type: 'text', help: 'The customer company the goods are delivered to.', formats: ['master', 'klt'] },
  { no: 2, key: 'plant', label: 'Delivery plant', german: 'Lieferwerk / Abladestelle', required: true, maxLength: 40, type: 'text', help: 'The plant or unloading point from the call-off data.', formats: ['master', 'klt'] },
  { no: 3, key: 'supplier', label: 'Supplier', german: 'Lieferant', required: true, maxLength: 60, type: 'text', help: 'Your company name as registered with the customer.', formats: ['master', 'klt'] },
  { no: 4, key: 'supplierNumber', label: 'Supplier number', german: 'Lieferantennummer', required: true, maxLength: 20, type: 'text', help: 'The customer-assigned supplier number.', formats: ['master', 'klt'] },
  { no: 5, key: 'deliveryNote', label: 'Delivery note number', german: 'Lieferschein-Nr.', required: true, maxLength: 20, type: 'text', help: 'The number the receiving plant books against.', formats: ['master', 'klt'] },
  { no: 6, key: 'deliveryNoteDate', label: 'Delivery note date', german: 'Lieferschein-Datum', required: true, maxLength: 10, type: 'date', help: 'Date on the delivery note.', formats: ['master', 'klt'] },
  { no: 8, key: 'partNumber', label: 'Part number', german: 'Sach-Nr. Kunde', required: true, maxLength: 35, type: 'text', help: 'The customer’s part number exactly as issued.', formats: ['master', 'klt'] },
  { no: 10, key: 'quantity', label: 'Quantity', german: 'Menge', required: true, maxLength: 12, type: 'number', help: 'The quantity on this package or loading unit.', formats: ['master', 'klt'] },
];

const UNITS = ['PCE', 'KG', 'M', 'M2', 'M3', 'L', 'SET', 'PAK'];

export default function Vda4902LabelPage() {
  usePageMeta(
    'VDA 4902 Label Generator — 210 × 148 mm and 210 × 74 mm goods tags',
    'Generate a VDA 4902 version 4 goods tag (210 × 148 mm master tag or 210 × 74 mm KLT label) with a PDF417 data field and a Code 39 delivery note number, as a print-ready PDF.'
  );

  const [fields, setFields] = useState<VdaFieldSpec[]>(FALLBACK_FIELDS);
  const [limitations, setLimitations] = useState<string[]>([]);
  const [format, setFormat] = useState<'master' | 'klt'>('master');
  const [data, setData] = useState<Record<string, string>>({
    receiver: 'Continental Automotive GmbH',
    plant: 'Plant D5, Regensburg',
    supplier: 'CloudHost247 Components Ltd',
    supplierNumber: '39127',
    deliveryNote: 'LS-2026-000123',
    deliveryNoteDate: '2026-11-09',
    customerNumber: '550021',
    partNumber: 'A-5510-2291',
    partDescription: 'Mounting bracket, left',
    quantity: '480',
    unit: 'PCE',
    purchaseOrder: 'PO-88120',
    deliveryDate: '2026-11-14',
    batch: 'B-2026-11',
    serial: '',
  });
  const [mixedLoad, setMixedLoad] = useState(false);
  const [germanCaptions, setGermanCaptions] = useState(true);
  const [result, setResult] = useState<StudioResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const response = await runListing<{ fields?: VdaFieldSpec[]; limitations?: string[] }>('vda-4902-label-generator', { action: 'spec' });
      if (!live || !response.data) return;
      if (response.data.fields?.length) setFields(response.data.fields);
      if (response.data.limitations) setLimitations(response.data.limitations);
    })();
    return () => {
      live = false;
    };
  }, []);

  const run = async () => {
    setBusy(true);
    const response = await runStudio('vda-4902-label-generator', {
      action: 'preview',
      data: { ...data, format, mixedLoad, germanCaptions, version: '4' },
      pdf: true,
    });
    setBusy(false);
    if (!response.ok || !response.data) {
      setError(response.error ?? { code: 'UNKNOWN', message: 'The label could not be generated.' });
      return;
    }
    setError(null);
    setResult(response.data);
  };

  const visible = useMemo(() => fields.filter((field) => field.formats.includes(format)), [fields, format]);

  return (
    <StudioFrame
      title="VDA 4902 Label Generator"
      lede="A goods tag for German automotive supply chains: the version-4 field list, a PDF417 data field and the delivery note number as Code 39, at the two standard sizes."
      notice={
        <div className="ch247-studio__notice ch247-studio__notice--strong">
          <strong>Not certified.</strong> This tool renders VDA 4902 (version 4) from public descriptions of the specification. It has not
          been certified by the VDA or by any vehicle manufacturer, and many manufacturers publish supplementary requirements that
          override the base standard. Confirm the label with your customer&rsquo;s goods-in before relying on it.
        </div>
      }
      config={
        <>
          <h2>Format</h2>
          <div className="ch247-studio__fields">
            <StudioSelect
              label="Label size"
              value={format}
              options={[
                { value: 'master', label: 'Master tag — 210 × 148 mm (A6 landscape)' },
                { value: 'klt', label: 'KLT label — 210 × 74 mm' },
              ]}
              onChange={setFormat}
            />
            <StudioField label="Unit of measure" htmlFor="vda-unit" hint="The unit the customer specifies for this part, usually PCE.">
              <select id="vda-unit" value={data.unit ?? 'PCE'} onChange={(event) => setData((previous) => ({ ...previous, unit: event.target.value }))}>
                {UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </StudioField>
          </div>

          <h3 style={{ marginTop: '1rem' }}>Fields</h3>
          <div className="ch247-studio__fields">
            {visible.map((field) => (
              <StudioInput
                key={field.key}
                label={`${field.no}. ${field.label}${field.required ? '' : ' (optional)'}`}
                hint={field.help}
                value={data[field.key] ?? ''}
                maxLength={field.maxLength}
                type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
                onChange={(value) => setData((previous) => ({ ...previous, [field.key]: value }))}
              />
            ))}
          </div>

          <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
            <StudioCheck label="Print German field captions alongside the English ones" checked={germanCaptions} onChange={setGermanCaptions} />
            {format === 'master' ? <StudioCheck label="This load unit is mixed (prints the mixed-load marker in field 8)" checked={mixedLoad} onChange={setMixedLoad} /> : null}
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
      exports={{ stem: format, pdf: true, svg: true, png: true, print: true }}
      resultDetail={
        result ? (
          <div style={{ marginTop: '0.75rem' }}>
            <h3 className="ch247-studio__label">Encoded content</h3>
            <div className="ch247-studio__table-wrap">
              <table className="ch247-studio__table ch247-studio__table--compact">
                <tbody>
                  <tr>
                    <th>Code 39 (delivery note)</th>
                    <td><code>{String(result.meta.linearValue ?? '')}</code></td>
                  </tr>
                  <tr>
                    <th>PDF417 payload</th>
                    <td><code style={{ wordBreak: 'break-all' }}>{String(result.meta.payload2d ?? '')}</code></td>
                  </tr>
                  <tr>
                    <th>Version</th>
                    <td>{String(result.meta.version ?? '4')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : null
      }
      usage={
        <>
          <h2>The two sizes</h2>
          <ul>
            <li><strong>Master tag — 210 × 148 mm.</strong> The large goods tag for a mixed or single-material load unit. Field 8 can print the mixed-load marker.</li>
            <li><strong>KLT label — 210 × 74 mm.</strong> The small-format label for a Kleinladungsträger (small load carrier). No mixed-load marker: a KLT holds one part.</li>
          </ul>
          <h2>What the label carries</h2>
          <p>
            The human-readable fields are the version-4 list, with the field numbers the receiving plant books against. The PDF417 code
            carries the same values as an identifier string, and the delivery note number is also printed as a Code 39 symbol so a scanner
            can read it without decoding the 2D block.
          </p>
          <h2>Limitations</h2>
          {limitations.length > 0 ? (
            <ul>
              {limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          ) : (
            <p>See the warning at the top of this page: the label has not been certified, and manufacturer supplements override the base standard.</p>
          )}
          <h2>Field reference</h2>
          <div className="ch247-studio__table-wrap">
            <table className="ch247-studio__table ch247-studio__table--compact">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Field</th>
                  <th>German</th>
                  <th>Required</th>
                  <th>Max</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field) => (
                  <tr key={field.key}>
                    <td>{field.no}</td>
                    <td>{field.label}</td>
                    <td>{field.german}</td>
                    <td>{field.required ? 'Yes' : 'No'}</td>
                    <td>{field.maxLength}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      }
      faq={[
        {
          q: 'Will my customer accept this label?',
          a: 'Unknown, and the page will not pretend otherwise. VDA 4902 is a base specification; manufacturers add requirements — extra fields, moved positions, plant-specific codes. The only reliable answer comes from your customer’s goods-in, and the label is worth testing there before a shipment depends on it.',
        },
        {
          q: 'Why is the delivery note number also a Code 39 symbol?',
          a: 'Because a goods-in scanner often reads the linear code first: it identifies the delivery note without decoding the PDF417 block, which is slower and needs a better imager. The number is the same in both places.',
        },
        {
          q: 'What exactly goes in the PDF417 code?',
          a: 'The fields you enter, in the GTL-style identifier form this tool documents. It is shown in full under the preview, so you can compare it with what your customer expects before you print a pallet of them.',
        },
        {
          q: 'Can I use another size?',
          a: 'No — versions 1–3 and custom sizes are refused rather than approximated. A label that is the wrong size is not a VDA 4902 label, and printing one at an invented size is worse than printing nothing.',
        },
      ]}
      related={[
        { title: 'Shipping Label Generator', href: '/tools/shipping-label-generator', blurb: 'Carrier-neutral parcel labels for general freight.' },
        { title: 'Label Designer', href: '/tools/label-designer', blurb: 'Address, product, asset and parcel templates.' },
        { title: 'Barcode Generator', href: '/tools/barcode-generator', blurb: 'Code 39, PDF417 and 15 other symbologies.' },
      ]}
    />
  );
}
