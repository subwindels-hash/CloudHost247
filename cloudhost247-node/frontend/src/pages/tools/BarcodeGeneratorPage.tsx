/**
 * Barcode Generator — /tools/barcode-generator
 *
 * The page is the form; the server is the encoder. Everything the user changes triggers a debounced
 * run, and the response carries the SVG, the exact printed geometry and the issue list, so the
 * preview and the numbers under it can never disagree.
 *
 * What the page does *not* do is guess a symbology: the format list is served by the API (with the
 * use case for each), and the payload hint under the input explains the rules for the selected
 * format — a Code 128 that accepts an untrimmed string and an EAN-13 that needs 12 or 13 digits are
 * different problems, and the operator should learn that from the page, not from an error.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePageMeta } from '../../lib/usePageMeta';
import { copyText, runStudio, type StudioResponse } from '../../lib/design-studio';
import StudioFrame, { StudioCheck, StudioField, StudioInput, StudioRange, StudioSelect } from '../../components/design-studio/StudioFrame';

interface FormatOption {
  id: string;
  name: string;
  family: 'linear' | '2d';
  useCase: string;
}

const FALLBACK_FORMATS: FormatOption[] = [
  { id: 'code128', name: 'Code 128', family: 'linear', useCase: 'General purpose alpha-numeric' },
  { id: 'qrcode', name: 'QR Code', family: '2d', useCase: 'URLs and contact details' },
  { id: 'ean13', name: 'EAN-13', family: 'linear', useCase: 'Retail products' },
  { id: 'datamatrix', name: 'Data Matrix', family: '2d', useCase: 'Small parts and industrial marking' },
];

const FORMAT_HINTS: Record<string, string> = {
  code128: 'Any printable ASCII character. The densest general-purpose linear symbology.',
  code39: 'Digits, A–Z and - . $ / + %. Uppercase only; about 19 modules per character, so it needs more width than Code 128.',
  code93: 'Digits, A–Z and - . $ / + %. Denser than Code 39 with a two-character check.',
  ean13: '12 digits (the check digit is calculated) or 13 with a valid check digit. Retail products.',
  ean8: '7 digits (check digit calculated) or 8. Small retail packages.',
  upca: '11 digits (check digit calculated) or 12. North American retail.',
  upce: '7 digits (number system and check digit are derived) or 8 with a valid check digit. Compressed UPC for small packages.',
  itf14: '13 digits (check digit calculated) or 14. Shipping cartons.',
  interleaved2of5: 'Digits only, an even count. Older logistics and warehouse labels.',
  codabar: 'Digits and - $ : / . + — the start/stop characters are added automatically.',
  'gs1-128': 'GS1 element strings in parentheses, for example (01)09521234543213(10)BATCH7.',
  gs1databar: 'A GTIN without brackets: 13 digits, or 14 with the indicator digit.',
  qrcode: 'Up to ~2 900 bytes. Use the error correction control for a damaged or partially covered code.',
  datamatrix: 'Up to ~2 300 characters. The standard for small industrial parts.',
  pdf417: 'Up to ~1 800 characters. Used on ID cards and shipping documents.',
  azteccode: 'Up to ~3 800 characters. Common on transport tickets.',
  microqrcode: 'Up to 35 characters. For very small items where a full QR will not fit.',
};

const USE_CASE_GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: 'General purpose', ids: ['code128', 'code39', 'code93', 'qrcode', 'datamatrix', 'pdf417', 'azteccode'] },
  { label: 'Retail', ids: ['ean13', 'ean8', 'upca', 'upce'] },
  { label: 'Logistics', ids: ['itf14', 'interleaved2of5', 'codabar', 'gs1-128', 'gs1databar'] },
  { label: 'Small parts', ids: ['microqrcode'] },
];

export default function BarcodeGeneratorPage() {
  usePageMeta(
    'Barcode Generator — Code 128, EAN, QR, Data Matrix and PDF417',
    'Generate standards-compliant barcodes as PNG, SVG or print-ready PDF: Code 128, Code 39, Code 93, EAN-8/13, UPC-A/E, ITF-14, GS1-128, QR, Micro QR, Data Matrix, PDF417 and Aztec.'
  );

  const [formats, setFormats] = useState<FormatOption[]>(FALLBACK_FORMATS);
  const [formatId, setFormatId] = useState('code128');
  const [payload, setPayload] = useState('CH247-2026-000123');
  const [moduleMm, setModuleMm] = useState(0.35);
  const [barHeightMm, setBarHeightMm] = useState(20);
  const [showText, setShowText] = useState(true);
  const [foreground, setForeground] = useState('#10171d');
  const [background, setBackground] = useState('#ffffff');
  const [errorCorrection, setErrorCorrection] = useState<'L' | 'M' | 'Q' | 'H'>('M');
  const [paddingMm, setPaddingMm] = useState(2);
  const [result, setResult] = useState<StudioResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const family = useMemo(() => formats.find((entry) => entry.id === formatId)?.family ?? 'linear', [formats, formatId]);

  const run = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    const response = await runStudio(
      'barcode-generator',
      {
        formatId,
        payload,
        moduleMm,
        barHeightMm,
        showText,
        foreground,
        background,
        errorCorrection,
        paddingMm,
        pdf: true,
      },
      controller.signal
    );
    if (controller.signal.aborted) return;
    setBusy(false);
    if (!response.ok || !response.data) {
      setError(response.error ?? { code: 'UNKNOWN', message: 'The barcode could not be generated.' });
      return;
    }
    setError(null);
    setResult(response.data);
    const served = response.data.meta.formats as FormatOption[] | undefined;
    if (served && served.length > 0) setFormats(served);
  }, [formatId, payload, moduleMm, barHeightMm, showText, foreground, background, errorCorrection, paddingMm]);

  // Debounced: typing a payload should not fire a request per keystroke, but the preview should still
  // feel immediate — 250 ms is below the threshold where a form feels laggy.
  useEffect(() => {
    const timer = setTimeout(() => void run(), 250);
    return () => clearTimeout(timer);
  }, [run]);

  useEffect(() => () => abort.current?.abort(), []);

  const reset = () => {
    setFormatId('code128');
    setPayload('CH247-2026-000123');
    setModuleMm(0.35);
    setBarHeightMm(20);
    setShowText(true);
    setForeground('#10171d');
    setBackground('#ffffff');
    setErrorCorrection('M');
    setPaddingMm(2);
  };

  const options = USE_CASE_GROUPS.map((group) => ({
    label: group.label,
    entries: formats.filter((entry) => group.ids.includes(entry.id)),
  })).filter((group) => group.entries.length > 0);

  return (
    <StudioFrame
      title="Barcode Generator"
      lede="Choose a symbology, enter the value and download a symbol that has been encoded by a standards-compliant encoder and verified by decoding it back."
      intro={
        <p className="ch247-studio__hint" style={{ maxWidth: '68ch' }}>
          The preview is the real symbol at the module width you set — not a lookup image. Every format here is generated by the
          platform&rsquo;s own encoder; nothing about your payload is sent to a third party.
        </p>
      }
      config={
        <>
          <h2>Barcode</h2>
          <div className="ch247-studio__fields ch247-studio__fields--single">
            <StudioField label="Symbology" htmlFor="barcode-format" hint={FORMAT_HINTS[formatId]}>
              <select id="barcode-format" value={formatId} onChange={(event) => setFormatId(event.target.value)}>
                {options.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.entries.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </StudioField>

            <StudioField label="Value" htmlFor="barcode-payload" hint="Exactly what the scanner will read back.">
              <textarea
                id="barcode-payload"
                value={payload}
                rows={2}
                maxLength={3000}
                aria-invalid={error ? 'true' : undefined}
                onChange={(event) => setPayload(event.target.value)}
              />
            </StudioField>
          </div>

          <h3 style={{ marginTop: '1rem' }}>Size and appearance</h3>
          <div className="ch247-studio__fields">
            <StudioRange label="Module width" unit="mm" value={moduleMm} min={0.15} max={2} step={0.05} onChange={setModuleMm} hint="The width of one narrow bar. Below 0.25 mm most office printers cannot resolve it." />
            {family === 'linear' ? (
              <StudioRange label="Bar height" unit="mm" value={barHeightMm} min={5} max={80} step={1} onChange={setBarHeightMm} hint="Height has no effect on what the symbol says, only on how easy it is to aim." />
            ) : null}
            <StudioRange label="Padding" unit="mm" value={paddingMm} min={0} max={20} step={0.5} onChange={setPaddingMm} hint="Extra white space around the symbol, on top of the quiet zone the standard requires." />
            {family === '2d' ? (
              <StudioSelect
                label="Error correction"
                value={errorCorrection}
                options={[
                  { value: 'L', label: 'L — 7% recoverable' },
                  { value: 'M', label: 'M — 15%' },
                  { value: 'Q', label: 'Q — 25%' },
                  { value: 'H', label: 'H — 30%' },
                ]}
                onChange={setErrorCorrection}
                hint="Higher correction survives more damage but needs a denser symbol."
              />
            ) : null}
            <StudioField label="Bars" htmlFor="barcode-fg">
              <input id="barcode-fg" type="color" value={foreground} onChange={(event) => setForeground(event.target.value)} />
            </StudioField>
            <StudioField label="Background" htmlFor="barcode-bg" hint="Keep the contrast high: scanners need dark bars on a light ground.">
              <input id="barcode-bg" type="color" value={background} onChange={(event) => setBackground(event.target.value)} />
            </StudioField>
          </div>

          <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
            {family === 'linear' ? <StudioCheck label="Show the value under the bars" checked={showText} onChange={setShowText} /> : null}
          </div>

          <div className="ch247-studio__actions">
            <button type="button" className="ch247-button" onClick={() => void run()} disabled={busy}>
              {busy ? 'Generating…' : 'Regenerate'}
            </button>
            <button type="button" className="ch247-button ch247-button--ghost" onClick={reset}>
              Reset
            </button>
            <button
              type="button"
              className="ch247-button ch247-button--ghost"
              onClick={async () => {
                const value = String(result?.meta.payload ?? payload);
                setCopied(await copyText(value));
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Copied' : 'Copy value'}
            </button>
          </div>
        </>
      }
      result={result}
      busy={busy}
      error={error}
      exports={{ stem: formatId, pdf: true, svg: true, png: true, print: true }}
      resultDetail={
        result ? (
          <div style={{ marginTop: '0.75rem' }}>
            <h3 className="ch247-studio__label">Encoded value</h3>
            <code style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>{String(result.meta.payload ?? '')}</code>
            <p className="ch247-studio__hint">
              {String(result.meta.formatName ?? formatId)} · module {String(result.meta.moduleMm ?? moduleMm)} mm ·{' '}
              {result.sizeMm.width} × {result.sizeMm.height} mm printed
            </p>
          </div>
        ) : null
      }
      usage={
        <>
          <h2>How to use it</h2>
          <ol>
            <li>Pick the symbology your scanner or your trading partner expects. If you are unsure, Code 128 for general data and EAN-13 for retail products are the usual answers.</li>
            <li>Type the value. The page shows the exact value that will be encoded — including a check digit it calculated for you.</li>
            <li>Set the module width. This is the physical width of the narrowest bar; it is what a verifier measures. 0.25–0.5 mm covers most office and thermal printing.</li>
            <li>Download the PDF for printing or the SVG for layout work. The PNG is rasterised from the same SVG at 300 dpi.</li>
          </ol>

          <h2>What it cannot tell you</h2>
          <ul>
            <li>Whether your printer will resolve the bars. A 0.2 mm module on a 600 dpi laser printer can smear; the page warns under 0.25 mm but only a test scan confirms it.</li>
            <li>Whether your trading partner accepts the format. GS1 retail, for example, has rules about which GTIN goes in which symbology that no generator can enforce.</li>
            <li>Whether the symbol scans from a distance. Bar height, contrast and the scanner all matter, and none of them are properties of the data.</li>
          </ul>

          <h2>Formats</h2>
          <div className="ch247-studio__table-wrap">
            <table className="ch247-studio__table ch247-studio__table--compact">
              <thead>
                <tr>
                  <th>Format</th>
                  <th>Family</th>
                  <th>Typical use</th>
                </tr>
              </thead>
              <tbody>
                {formats.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.name}</td>
                    <td>{entry.family === '2d' ? '2D matrix' : 'Linear'}</td>
                    <td>{entry.useCase}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      }
      faq={[
        {
          q: 'Is the barcode real, or an image you found somewhere?',
          a: 'It is encoded on request by a standards-compliant encoder (BWIPP) and drawn from the encoder\'s own geometry. The test suite proves this by rendering each format and decoding it with an independent reader — if the geometry were wrong, the payload would not come back out.',
        },
        {
          q: 'Why is my EAN-13 rejected?',
          a: 'EAN-13 takes 12 digits and calculates the thirteenth, or 13 digits whose check digit must be correct. A transposed digit produces a wrong check digit, so the tool refuses it rather than printing a code that will fail at the till.',
        },
        {
          q: 'Can I use a coloured barcode?',
          a: 'You can, and scanners read dark-on-light best. Keep the contrast high and never invert it: a light symbol on a dark ground fails on most laser scanners because the light background is treated as the quiet zone.',
        },
        {
          q: 'Does the PNG differ from the PDF?',
          a: 'No. The PDF is generated on the server at the exact millimetre size, and the PNG is rasterised in your browser from the same SVG at 300 dpi. Both come from one drawing, so what you check on screen is what prints.',
        },
        {
          q: 'Is my data stored?',
          a: 'No. The value is encoded in memory for this one request. There is no cache, no history entry and no request-body logging for this tool, and the result is never written to the report store.',
        },
      ]}
      related={[
        { title: 'Label Designer', href: '/tools/label-designer', blurb: 'Put barcodes on a designed label and print a CSV batch.' },
        { title: 'QR Code Generator', href: '/tools/qr-code-generator', blurb: 'The original QR tool for URLs, WiFi and vCards.' },
        { title: 'QR Business Card Designer', href: '/tools/qr-business-card-designer', blurb: 'A printable card whose QR imports as a contact.' },
        { title: 'Shipping Label Generator', href: '/tools/shipping-label-generator', blurb: 'Carrier-neutral parcel labels with Code 128 or GS1-128.' },
      ]}
    />
  );
}
