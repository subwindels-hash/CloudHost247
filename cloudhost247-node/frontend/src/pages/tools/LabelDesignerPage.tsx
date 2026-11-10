/**
 * Label Designer — /tools/label-designer
 *
 * The page is deliberately a *form over a template*, not a drag-and-drop canvas. The templates are
 * layout-checked data (the test suite prints each one at its stated size and decodes the symbols), so
 * the fastest safe path is: pick a template, fill its fields, print. The elements of the chosen
 * template are listed so the operator can see exactly what will print and in what order.
 *
 * The CSV tab is the other half: a batch is only useful if the operator can see *which line* failed
 * and re-import the rejected rows. So the report is a table with the original line numbers and a
 * downloadable rejected-rows CSV, both produced by the server rather than re-derived here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePageMeta } from '../../lib/usePageMeta';
import { downloadFile, runListing, runStudio, type StudioResponse } from '../../lib/design-studio';
import StudioFrame, { StudioField, StudioInput, StudioTextarea } from '../../components/design-studio/StudioFrame';
import SavedTemplatesPanel from '../../components/design-studio/SavedTemplatesPanel';

type Tab = 'preview' | 'batch';

interface TemplateMeta {
  id: string;
  name: string;
  category: string;
  blurb: string;
  description?: string;
}

interface FieldSpec {
  key: string;
  label: string;
  multiline?: boolean;
}

/** The labels a template binds to, in the order they appear in the document. */
interface ElementSpec {
  id: string;
  kind: string;
  name: string;
  binding?: { key?: string; fallback?: string };
  formatId?: string;
  moduleMm?: number;
}

const TEMPLATE_FIELDS: Record<string, FieldSpec[]> = {
  'address-70x40': [
    { key: 'sender', label: 'Sender line' },
    { key: 'recipient', label: 'Recipient block', multiline: true },
    { key: 'tracking', label: 'Tracking / reference' },
    { key: 'trackingUrl', label: 'QR destination (URL)' },
  ],
  'product-50x30': [
    { key: 'sku', label: 'SKU' },
    { key: 'price', label: 'Price' },
    { key: 'gtin', label: 'GTIN (EAN-13)' },
  ],
  'asset-tag-60x25': [
    { key: 'asset', label: 'Asset number' },
    { key: 'description', label: 'Description' },
    { key: 'owner', label: 'Owner' },
  ],
  'parcel-100x150': [
    { key: 'senderName', label: 'Sender name' },
    { key: 'senderAddress', label: 'Sender address', multiline: true },
    { key: 'recipientName', label: 'Recipient name' },
    { key: 'recipientAddress', label: 'Recipient address', multiline: true },
    { key: 'reference', label: 'Reference' },
    { key: 'weight', label: 'Weight' },
    { key: 'packages', label: 'Packages' },
  ],
  'inventory-shelf-40x20': [
    { key: 'location', label: 'Location' },
    { key: 'item', label: 'Item' },
  ],
  'blank-70x40': [],
};

interface CsvReport {
  headers: string[];
  mapping: Record<string, string>;
  rows: Array<{ line: number; values: Record<string, string>; accepted: boolean; issues: Array<{ level: string; message: string }> }>;
  accepted: number;
  rejected: number;
  warnings: string[];
  rejectedCsv: string | null;
  templateCsv: string;
}

export default function LabelDesignerPage() {
  usePageMeta(
    'Label Designer — address, product, asset and parcel labels',
    'Design and print address labels, product labels, asset tags and parcel labels from checked templates. Fill the fields or import a CSV batch, then export a print-ready PDF.'
  );

  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [templateId, setTemplateId] = useState('address-70x40');
  const [values, setValues] = useState<Record<string, string>>({});
  const [elements, setElements] = useState<ElementSpec[]>([]);
  const [tab, setTab] = useState<Tab>('preview');
  /**
   * One label or a whole sheet. The default is one label: a 70 × 40 mm label rendered on an A4 page
   * is a tiny rectangle in the corner, which is useless for checking the design. The sheet view is
   * there for the thing it is good at — seeing how many fit and whether the grid lines up.
   */
  const [sheet, setSheet] = useState(false);
  const [result, setResult] = useState<StudioResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const [csv, setCsv] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [report, setReport] = useState<CsvReport | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState<{ code: string; message: string } | null>(null);

  const abort = useRef<AbortController | null>(null);

  // A loaded saved template is a document, not a set of form fields: it can carry a size, a style and
  // elements this page has no inputs for. It is therefore sent with the preview rather than unpacked
  // into state, and it is dropped the moment the operator picks a different template — otherwise the
  // next preview would print the old layout under the new template's name.
  const [savedDocument, setSavedDocument] = useState<Record<string, unknown> | null>(null);

  // One templates call populates the picker. It is a server call rather than a constant so the page
  // can never list a template the generator does not have.
  useEffect(() => {
    let live = true;
    void (async () => {
      const response = await runListing<{ templates?: TemplateMeta[] }>('label-designer', { action: 'templates' });
      if (live && response.data?.templates?.length) setTemplates(response.data.templates);
    })();
    return () => {
      live = false;
    };
  }, []);

  const run = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    const response = await runStudio(
      'label-designer',
      { action: 'preview', templateId, values, singlePage: !sheet, pdf: true, ...(savedDocument ? { document: savedDocument } : {}) },
      controller.signal
    );
    if (controller.signal.aborted) return;
    setBusy(false);
    if (!response.ok || !response.data) {
      setError(response.error ?? { code: 'UNKNOWN', message: 'The label could not be generated.' });
      return;
    }
    setError(null);
    setResult(response.data);
    // The element list comes from the response's meta, not from a copy kept in the page and not from
    // the response `document` (which is a page of draw ops): what the table shows is exactly what the
    // renderer laid out.
    const servedElements = (response.data.meta as { elements?: ElementSpec[] }).elements;
    if (servedElements) setElements(servedElements);
  }, [templateId, values, sheet, savedDocument]);

  useEffect(() => {
    const timer = setTimeout(() => void run(), 250);
    return () => clearTimeout(timer);
  }, [run]);

  useEffect(() => () => abort.current?.abort(), []);

  const fields = useMemo(() => TEMPLATE_FIELDS[templateId] ?? [], [templateId]);

  const runBatch = async () => {
    setBatchBusy(true);
    const response = await runStudio('label-designer', { action: 'csv', templateId, csv, mapping });
    setBatchBusy(false);
    if (!response.ok || !response.data) {
      setBatchError(response.error ?? { code: 'UNKNOWN', message: 'The CSV could not be read.' });
      setReport(null);
      return;
    }
    setBatchError(null);
    // The `csv` action answers with its own report rather than the document envelope.
    const reportData = response.data as unknown as CsvReport;
    setReport(reportData);
    if (reportData.mapping) setMapping(reportData.mapping);
  };

  return (
    <StudioFrame
      title="Label Designer"
      lede="Address labels, product labels, asset tags and parcel labels from templates that have been printed and checked at their stated size — one label or a whole CSV batch."
      config={
        <>
          <h2>Template</h2>
          <div className="ch247-studio__templates">
            {(templates.length > 0 ? templates : Object.keys(TEMPLATE_FIELDS).map((id) => ({ id, name: id, category: '', blurb: '' }))).map((template) => (
              <button
                key={template.id}
                type="button"
                className="ch247-studio__template"
                aria-pressed={template.id === templateId}
                onClick={() => {
                  setTemplateId(template.id);
                  setValues({});
                  setSavedDocument(null);
                }}
              >
                <strong>{template.name}</strong>
                {template.blurb ? <span>{template.blurb}</span> : null}
              </button>
            ))}
          </div>

          <div className="ch247-studio__tabs" role="tablist" aria-label="Label data source" style={{ marginTop: '1rem' }}>
            <button type="button" role="tab" aria-selected={tab === 'preview'} className="ch247-studio__tab" onClick={() => setTab('preview')}>
              Preview one label
            </button>
            <button type="button" role="tab" aria-selected={tab === 'batch'} className="ch247-studio__tab" onClick={() => setTab('batch')}>
              CSV batch
            </button>
          </div>

          {tab === 'preview' ? (
            fields.length === 0 ? (
              <p className="ch247-studio__hint">This template has no bound fields — change its dimensions or elements in the saved-document format. Pick another template to fill fields here.</p>
            ) : (
              <div className="ch247-studio__fields ch247-studio__fields--single">
                {fields.map((field) =>
                  field.multiline ? (
                    <StudioTextarea
                      key={field.key}
                      label={field.label}
                      value={values[field.key] ?? ''}
                      onChange={(value) => setValues((previous) => ({ ...previous, [field.key]: value }))}
                      maxLength={400}
                    />
                  ) : (
                    <StudioInput
                      key={field.key}
                      label={field.label}
                      value={values[field.key] ?? ''}
                      onChange={(value) => setValues((previous) => ({ ...previous, [field.key]: value }))}
                      maxLength={200}
                    />
                  )
                )}
                <p className="ch247-studio__hint">Leave a field blank to print the template&rsquo;s own example value. Clear the result panel to see which elements are bound.</p>
              </div>
            )
          ) : (
            <>
              <div className="ch247-studio__fields ch247-studio__fields--single">
                <StudioTextarea
                  label="CSV"
                  hint="The first row is the header. One label per row; a UTF-8 BOM, a semicolon delimiter and quoted fields with embedded line breaks are all handled."
                  value={csv}
                  onChange={setCsv}
                  rows={8}
                  maxLength={2 * 1024 * 1024}
                  placeholder={'sku,price,gtin\nCH-1001,12.50,4006381333931'}
                />
                <button
                  type="button"
                  className="ch247-button ch247-button--ghost ch247-button--small"
                  onClick={async () => {
                    const response = await runStudio('label-designer', { action: 'csv', templateId, csv: 'placeholder\n' });
                    const template = (response.data as unknown as { templateCsv?: string } | undefined)?.templateCsv;
                    if (template) setCsv(template);
                  }}
                >
                  Insert this template&rsquo;s columns
                </button>
              </div>
              <div className="ch247-studio__actions">
                <button type="button" className="ch247-button" onClick={() => void runBatch()} disabled={batchBusy || csv.trim() === ''}>
                  {batchBusy ? 'Checking…' : 'Check the batch'}
                </button>
                {report?.rejectedCsv ? (
                  <button type="button" className="ch247-button ch247-button--outline" onClick={() => downloadFile(report.rejectedCsv as string, 'text/csv', 'rejected-rows.csv')}>
                    Download rejected rows
                  </button>
                ) : null}
              </div>
              {batchError ? (
                <p className="ch247-studio__issue ch247-studio__issue--error" role="alert" style={{ marginTop: '0.75rem' }}>
                  <span aria-hidden="true">✕</span>
                  <span>
                    <strong>{batchError.code}: </strong>
                    {batchError.message}
                  </span>
                </p>
              ) : null}
              {report ? (
                <>
                  <p className="ch247-studio__hint" style={{ marginTop: '0.75rem' }}>
                    {report.accepted} label(s) will print, {report.rejected} row(s) rejected. No row is silently dropped — a rejected row is
                    listed with its original line number.
                  </p>
                  <div className="ch247-studio__table-wrap">
                    <table className="ch247-studio__table ch247-studio__table--compact">
                      <thead>
                        <tr>
                          <th>Line</th>
                          <th>Status</th>
                          <th>Problem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.rows.map((row) => (
                          <tr key={row.line}>
                            <td>{row.line}</td>
                            <td>{row.accepted ? 'Will print' : 'Rejected'}</td>
                            <td>{row.issues.map((issue) => issue.message).join(' ') || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </>
          )}

          <div className="ch247-studio__actions">
            <button type="button" className="ch247-button" onClick={() => void run()} disabled={busy}>
              {busy ? 'Generating…' : 'Regenerate preview'}
            </button>
            <button type="button" className="ch247-button ch247-button--outline" aria-pressed={sheet} onClick={() => setSheet((previous) => !previous)}>
              {sheet ? 'Show one label' : 'Show the full sheet'}
            </button>
          </div>
        </>
      }
      extra={
        <SavedTemplatesPanel
          kind="label"
          document={savedDocument ? { ...savedDocument, templateId, values } : { templateId, values }}
          defaultName={templates.find((template) => template.id === templateId)?.name ?? templateId}
          summary={templateId}
          validateLoad={(document) => {
            const saved = document.templateId;
            if (typeof saved !== 'string') return 'That template has no layout name stored, so it cannot be placed on this page.';
            const known = templates.length > 0 ? templates.some((template) => template.id === saved) : saved in TEMPLATE_FIELDS;
            return known ? null : `That template was saved from the “${saved}” layout, which this build no longer offers. Nothing was changed — pick a template and set it up again.`;
          }}
          onLoad={(document) => {
            // A saved label restores the template it was built on and the values that were typed. Any
            // other keys in the document (a changed size, extra elements) travel with the preview.
            if (typeof document.templateId === 'string') setTemplateId(document.templateId);
            const loadedValues = document.values;
            setValues(loadedValues && typeof loadedValues === 'object' && !Array.isArray(loadedValues) ? (loadedValues as Record<string, string>) : {});
            setSavedDocument(document);
          }}
        />
      }
      result={result}
      busy={busy}
      error={error}
      exports={{ stem: templateId, pdf: true, svg: true, png: true, print: true }}
      resultDetail={
        elements.length > 0 ? (
          <div style={{ marginTop: '0.75rem' }}>
            <h3 className="ch247-studio__label">Elements on this template</h3>
            <div className="ch247-studio__table-wrap">
              <table className="ch247-studio__table ch247-studio__table--compact">
                <thead>
                  <tr>
                    <th>Element</th>
                    <th>Kind</th>
                    <th>Bound to</th>
                  </tr>
                </thead>
                <tbody>
                  {elements.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.name}</td>
                      <td>{entry.kind}</td>
                      <td>{entry.binding?.key ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null
      }
      usage={
        <>
          <h2>What the templates are, and what they are not</h2>
          <p>
            Each template is a checked starting point: a real label size (70 × 40 mm thermal stock, a 50 × 30 mm product label, a
            100 × 150 mm parcel label), a fitted barcode module width and a field list. They are described by what they contain, not by
            a standard number, because they have not been certified against one. The VDA 4902 tool is the only page here that claims a
            specification, and it documents its limits on its own page.
          </p>
          <h2>Printing</h2>
          <ul>
            <li>Download the PDF and print at 100% — not &ldquo;fit to page&rdquo;. Every dimension on the document is in millimetres, so a scaled print is a wrong-size label.</li>
            <li>The sheet grid in the template is a suggestion for A4 stock. If your label stock has different gaps, the PDF for a single label is the reliable route.</li>
            <li>Thermal printers generally want the PDF, not the PNG: the PDF keeps the bars as vector geometry.</li>
          </ul>
          <h2>Batch CSV</h2>
          <p>
            The batch check maps your columns to the template&rsquo;s bindings, reports every row with its original line number and gives you
            the rejected rows back as a CSV you can fix. A missing value is a warning (the element prints empty); a value the symbol cannot
            encode is an error for that row only.
          </p>
        </>
      }
      faq={[
        {
          q: 'Can I design a label from scratch?',
          a: 'Not yet — the page fills a checked template. The document format (elements, sizes, bindings) is a JSON model, so a saved document can be posted to the same endpoint, and the editor for it is the natural next step. Building a free-form canvas without the print checks would produce confidently wrong labels, which is why the templates come first.',
        },
        {
          q: 'Why does a blank field print the example value?',
          a: 'Templates carry sample values so the preview shows a complete label. An empty field falls back to the template value; a CSV row that lacks a value prints the element empty and warns about it.',
        },
        {
          q: 'Is the CSV uploaded anywhere?',
          a: 'It is posted to this server for the duration of the request and is not stored: no cache, no history, no report. The row report you see is the response.',
        },
        {
          q: 'Which symbology does each template use?',
          a: 'Address: Code 128 for the reference and a QR code for the tracking URL. Product: EAN-13. Asset: Code 39. Parcel: Code 128. All at module widths chosen to fit the stated label size without rescaling the symbol.',
        },
      ]}
      related={[
        { title: 'Barcode Generator', href: '/tools/barcode-generator', blurb: 'One symbol, any of 17 formats, with exact module control.' },
        { title: 'Shipping Label Generator', href: '/tools/shipping-label-generator', blurb: 'Carrier-neutral parcel labels with GS1-128 option.' },
        { title: 'VDA 4902 Label Generator', href: '/tools/vda-4902-label-generator', blurb: 'German automotive goods tags at the two version-4 sizes.' },
        { title: 'Business Card Designer', href: '/tools/qr-business-card-designer', blurb: 'A card whose QR imports as a contact.' },
      ]}
    />
  );
}
