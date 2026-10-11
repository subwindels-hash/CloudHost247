import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../../components/ui/Icon';
import { usePageMeta } from '../../lib/usePageMeta';
import {
  copyTextToClipboard,
  downloadDocument,
  printResult,
  resultToPlainText,
} from '../../lib/business-tools-export';
import {
  BUSINESS_TOOL_CATEGORY_LABELS,
  BUSINESS_TOOLS_ROOT,
  businessToolsByCategory,
  defaultInputFor,
  findBusinessTool,
} from '../../../../src/tools/business';
import type {
  BusinessField,
  BusinessTool,
  BusinessToolResult,
  ResultDocument,
} from '../../../../src/tools/business';

/**
 * Business Tools — one consistent workspace for all 21 tools.
 *
 * The tools differ enormously in what they produce (a tax computation, a contract, an SVG badge, a
 * weighted provider ranking) but not in how they are used: fill a form, run it, read a result, take
 * it away. So one component renders all of them from the registry's declarative schema. That is
 * what keeps the inputs, the validation, the reset behaviour, the export actions and the advisory
 * and provenance panels identical from tool to tool, instead of twenty-one slightly different
 * interpretations of the same idea.
 *
 * The compute function runs here, in the browser. There is no request to await, so the "running"
 * state is driven by `useTransition` — it is real (the net-to-gross solve iterates, the org chart
 * walks a tree) rather than a decorative spinner, and it never claims work that did not happen.
 */

type FormValues = Record<string, string | number | boolean>;
type Status = 'idle' | 'running' | 'success' | 'error';

const ACTION_LABEL: Record<BusinessTool['category'], string> = {
  calculators: 'Calculate',
  generators: 'Generate',
  comparisons: 'Compare',
};

const EMPTY_STATE_COPY: Record<BusinessTool['category'], { title: string; body: string }> = {
  calculators: {
    title: 'No calculation yet',
    body: 'Fill in the inputs and press Calculate. The figures are computed in your browser and the working is shown beside the result, so you can check every step against your own records.',
  },
  generators: {
    title: 'Nothing generated yet',
    body: 'Fill in the fields you have and press Generate. Fields you leave blank are either omitted from the document or shown as not supplied — the generator will tell you which.',
  },
  comparisons: {
    title: 'No comparison yet',
    body: 'Press Compare to rank the options by the criteria weights shown. You can reweight any criterion, restrict the comparison to a subset, and override any score with your own assessment.',
  },
};

export default function BusinessToolWorkspacePage() {
  const { tool: toolSlug } = useParams<{ tool: string }>();
  const tool = useMemo(() => findBusinessTool(toolSlug ?? ''), [toolSlug]);

  if (!tool) return <UnknownTool slug={toolSlug ?? ''} />;
  return <Workspace key={tool.slug} tool={tool} />;
}

function UnknownTool({ slug }: { slug: string }) {
  usePageMeta('Tool not found — Business Tools | CloudHost247', 'That Business Tool does not exist.', {
    noIndex: true,
  });
  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <nav aria-label="Breadcrumb">
            <ol className="bt247-breadcrumbs">
              <li>
                <Link to="/">Home</Link>
              </li>
              <li>
                <Link to="/tools">Tools</Link>
              </li>
              <li>
                <Link to={BUSINESS_TOOLS_ROOT}>Business Tools</Link>
              </li>
              <li aria-current="page">Not found</li>
            </ol>
          </nav>
          <h1>That tool is not in Business Tools</h1>
          <p>
            {slug ? <>Nothing is registered at the slug “{slug}”. </> : null}
            Business Tools has 21 tools across three categories: 5 calculators, 12 generators and 4
            comparisons.
          </p>
        </div>
      </section>
      <section className="ch247-section">
        <div className="ch247-page ch247-stack">
          <div className="bt247-state bt247-state--error" role="alert">
            <h2 className="bt247-state__title">Check the address</h2>
            <p>
              If you followed a link here, it points at a tool that does not exist. The directory
              lists every tool with its working address.
            </p>
            <div className="bt247-actions">
              <Link className="ch247-button" to={BUSINESS_TOOLS_ROOT}>
                Back to Business Tools
              </Link>
              <Link className="ch247-button ch247-button--ghost" to="/tools">
                Browse the full Tools Center
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Workspace({ tool }: { tool: BusinessTool }) {
  const categoryLabel = BUSINESS_TOOL_CATEGORY_LABELS[tool.category];

  usePageMeta(
    `${tool.name} — Business Tools | CloudHost247`,
    `${tool.summary} Runs entirely in your browser; nothing you enter is uploaded or stored.`,
    {
      canonical: tool.path,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: tool.name,
        description: tool.summary,
        url: tool.path,
        applicationCategory: 'BusinessApplication',
        applicationSuite: 'CloudHost247 Business Tools',
        operatingSystem: 'Any modern browser',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
    }
  );

  const defaults = useMemo(() => defaultInputFor(tool), [tool]);
  const [values, setValues] = useState<FormValues>(defaults);
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<BusinessToolResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Array<{ key: string; message: string }>>([]);
  const [isPending, startTransition] = useTransition();
  const [flash, setFlash] = useState('');
  const resultRef = useRef<HTMLDivElement | null>(null);

  // Moving between tools must not carry the previous tool's inputs or result across.
  useEffect(() => {
    setValues(defaultInputFor(tool));
    setStatus('idle');
    setResult(null);
    setErrorMessage('');
    setFieldErrors([]);
    setFlash('');
  }, [tool]);

  const errorFor = useCallback(
    (key: string): string | undefined => fieldErrors.find((entry) => entry.key === key)?.message,
    [fieldErrors]
  );

  const run = useCallback(() => {
    setFlash('');
    setStatus('running');
    startTransition(() => {
      const outcome = tool.compute(values);
      if (outcome.ok) {
        setResult(outcome.result);
        setErrorMessage('');
        setFieldErrors([]);
        setStatus('success');
      } else {
        setResult(null);
        setErrorMessage(outcome.error.message);
        setFieldErrors(outcome.error.fieldErrors ?? []);
        setStatus('error');
      }
    });
  }, [tool, values]);

  const reset = useCallback(() => {
    setValues(defaultInputFor(tool));
    setResult(null);
    setErrorMessage('');
    setFieldErrors([]);
    setStatus('idle');
    setFlash('Form reset to its defaults.');
  }, [tool]);

  function setValue(key: string, value: string | number | boolean): void {
    setValues((current) => ({ ...current, [key]: value }));
    // Clearing a field's error as soon as it is edited keeps the form from arguing with the visitor.
    setFieldErrors((current) => (current.some((entry) => entry.key === key) ? current.filter((entry) => entry.key !== key) : current));
  }

  async function onCopyResult(): Promise<void> {
    if (!result) return;
    // Always the result the visitor is looking at. A generated document has its own "Copy <label>"
    // button inside its panel, so preferring the document here would hand over a CSV nobody asked
    // for and leave the metrics, tables and working on screen with no copy affordance at all.
    const text = resultToPlainText(result);
    const ok = await copyTextToClipboard(text);
    setFlash(ok ? 'Copied to your clipboard.' : 'Your browser blocked the clipboard write. Select the text in the preview and copy it manually.');
  }

  async function onCopyDocument(document: ResultDocument): Promise<void> {
    const ok = await copyTextToClipboard(document.content);
    setFlash(ok ? `${document.label} copied to your clipboard.` : 'Your browser blocked the clipboard write. Select the text in the preview and copy it manually.');
  }

  function onDownload(document: ResultDocument): void {
    const ok = downloadDocument(document);
    setFlash(ok ? `Downloading ${document.filename}.` : 'Your browser blocked the download. Copy the text from the preview instead.');
  }

  function onPrint(): void {
    const ok = printResult();
    if (!ok) setFlash('This browser has no print dialog available. Use your browser\u2019s own Print command.');
  }

  const sections = useMemo(() => groupFields(tool.fields), [tool]);
  const related = useMemo(
    () => businessToolsByCategory(tool.category).filter((other) => other.slug !== tool.slug).slice(0, 4),
    [tool]
  );
  const documents: ResultDocument[] = result
    ? [...(result.document ? [result.document] : []), ...(result.extraDocuments ?? [])]
    : [];

  const invalidFieldIds = fieldErrors.map((entry) => `bt247-field-${entry.key}`).filter((id, index, all) => all.indexOf(id) === index);

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <nav aria-label="Breadcrumb">
            <ol className="bt247-breadcrumbs">
              <li>
                <Link to="/">Home</Link>
              </li>
              <li>
                <Link to="/tools">Tools</Link>
              </li>
              <li>
                <Link to={BUSINESS_TOOLS_ROOT}>Business Tools</Link>
              </li>
              <li>
                <Link to={`${BUSINESS_TOOLS_ROOT}?category=${tool.category}`}>{categoryLabel}</Link>
              </li>
              <li aria-current="page">{tool.name}</li>
            </ol>
          </nav>
          <h1>{tool.name}</h1>
          <p>{tool.summary}</p>
          <p className="ch247-page__hint" style={{ margin: '0.5rem 0 0' }}>
            Business Tools → {categoryLabel} · Units: {tool.units}
          </p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--wide ch247-stack">
          <div className="bt247-workspace">
            {/* ---------- Inputs ---------- */}
            <div className="bt247-panel bt247-panel--inputs">
              <h2 className="bt247-panel__title">Inputs</h2>
              <form
                className="ch247-form"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  run();
                }}
                aria-describedby={status === 'error' ? 'bt247-error-summary' : undefined}
              >
                {sections.map((section) => (
                  <fieldset className="bt247-fieldset" key={section.name}>
                    {section.name ? <legend>{section.name}</legend> : null}
                    <div className="bt247-fields">
                      {section.fields.map((field) => (
                        <Field
                          key={field.key}
                          field={field}
                          value={values[field.key]}
                          error={errorFor(field.key)}
                          onChange={(next) => setValue(field.key, next)}
                        />
                      ))}
                    </div>
                  </fieldset>
                ))}

                <div className="bt247-actions">
                  <button type="submit" className="ch247-button" disabled={isPending}>
                    {isPending ? 'Working…' : ACTION_LABEL[tool.category]}
                  </button>
                  <button type="button" className="ch247-button ch247-button--ghost" onClick={reset}>
                    Reset form
                  </button>
                </div>
                <p className="ch247-page__hint" style={{ margin: '0.6rem 0 0' }}>
                  Fields marked <span className="bt247-field__required">*</span> are required.
                  Everything runs in your browser; nothing you enter is uploaded or stored.
                </p>
              </form>
            </div>

            {/* ---------- Result ---------- */}
            <div ref={resultRef}>
              <div className="bt247-panel" aria-busy={status === 'running'}>
                <h2 className="bt247-panel__title">Result</h2>

                {flash ? (
                  <p className="bt247-flash" role="status">
                    {flash}
                  </p>
                ) : null}

                {status === 'running' ? (
                  <div className="bt247-state" role="status" aria-live="polite">
                    <h3 className="bt247-state__title">Working…</h3>
                    <p style={{ margin: 0 }}>Running the calculation locally in your browser.</p>
                  </div>
                ) : null}

                {status === 'idle' ? (
                  <div className="bt247-state">
                    <h3 className="bt247-state__title">{EMPTY_STATE_COPY[tool.category].title}</h3>
                    <p style={{ margin: '0 auto', maxWidth: '34rem' }}>{EMPTY_STATE_COPY[tool.category].body}</p>
                  </div>
                ) : null}

                {status === 'error' ? (
                  <div className="bt247-state bt247-state--error" role="alert" id="bt247-error-summary">
                    <h3 className="bt247-state__title">This could not be run yet</h3>
                    <p style={{ margin: 0 }}>{errorMessage}</p>
                    {fieldErrors.length > 0 ? (
                      <ul className="bt247-state__fields">
                        {fieldErrors.map((entry, index) => (
                          <li key={`${entry.key}-${index}`}>
                            <a href={`#bt247-field-${entry.key}`}>{entry.message}</a>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                {status === 'success' && result ? (
                  <>
                    <div className="bt247-metrics">
                      {result.metrics.map((metric) => (
                        <div
                          key={metric.label}
                          className={`bt247-metric${metric.emphasis === 'primary' ? ' bt247-metric--primary' : ''}${metric.emphasis === 'muted' ? ' bt247-metric--muted' : ''}`}
                        >
                          <p className="bt247-metric__label">{metric.label}</p>
                          <p className="bt247-metric__value">{metric.value}</p>
                          {metric.hint ? <p className="bt247-metric__hint">{metric.hint}</p> : null}
                        </div>
                      ))}
                    </div>

                    {result.warnings && result.warnings.length > 0 ? (
                      <ul className="bt247-advisories" aria-label="Advisories">
                        {result.warnings.map((warning, index) => (
                          <li className="bt247-advisory" key={index}>
                            {warning}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {documents.map((document) => (
                      <DocumentPanel
                        key={document.filename}
                        document={document}
                        onCopy={() => void onCopyDocument(document)}
                        onDownload={() => onDownload(document)}
                      />
                    ))}

                    {result.tables?.map((table) => (
                      <div className="bt247-table-wrap" key={table.title}>
                        <table className="bt247-table">
                          <caption>{table.caption ?? table.title}</caption>
                          <thead>
                            <tr>
                              <th scope="col">{table.title}</th>
                              {table.columns.map((column) => (
                                <th scope="col" key={column}>
                                  {column}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {table.rows.map((row, rowIndex) => (
                              <tr
                                key={`${row.label}-${rowIndex}`}
                                className={row.emphasis === 'total' ? 'bt247-row--total' : row.emphasis === 'muted' ? 'bt247-row--muted' : undefined}
                              >
                                <th scope="row">
                                  {row.label}
                                  {row.hint ? <span className="bt247-row__hint">{row.hint}</span> : null}
                                </th>
                                {row.cells.map((cell, cellIndex) => (
                                  <td key={cellIndex} className={/₦|%|x$|[\d,]+\.\d\d/.test(cell) ? 'bt247-num' : undefined}>
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}

                    {result.explanation && result.explanation.length > 0 ? (
                      <>
                        <h3 className="bt247-panel__title">How this was calculated</h3>
                        <ul className="bt247-notes">
                          {result.explanation.map((item, index) => (
                            <li key={index}>{item}</li>
                          ))}
                        </ul>
                      </>
                    ) : null}

                    {result.jurisdiction ? (
                      <dl className="bt247-provenance">
                        <dt>Jurisdiction</dt>
                        <dd>{result.jurisdiction.jurisdiction}</dd>
                        <dt>Source</dt>
                        <dd>{result.jurisdiction.source}</dd>
                        <dt>{result.jurisdiction.estimate ? 'Verified (planning estimate)' : 'Effective / verified'}</dt>
                        <dd>{result.jurisdiction.effectiveDate}</dd>
                        {result.jurisdiction.disclaimer ? (
                          <dd className="bt247-provenance__disclaimer">{result.jurisdiction.disclaimer}</dd>
                        ) : null}
                      </dl>
                    ) : null}

                    <div className="bt247-export">
                      <button type="button" className="ch247-button ch247-button--small" onClick={() => void onCopyResult()}>
                        Copy result
                      </button>
                      {tool.printable ? (
                        <button type="button" className="ch247-button ch247-button--small ch247-button--ghost" onClick={onPrint}>
                          Print result
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>

              <div className="bt247-panel">
                <h3 className="bt247-panel__title">About this tool</h3>
                <p style={{ margin: 0, lineHeight: 1.65 }}>{tool.description}</p>
                {related.length > 0 ? (
                  <>
                    <h4 className="bt247-panel__title" style={{ marginTop: '1rem' }}>
                      More {categoryLabel}
                    </h4>
                    <div className="bt247-related">
                      {related.map((other) => (
                        <Link className="ch247-button ch247-button--small ch247-button--outline" key={other.slug} to={other.path}>
                          {other.name}
                        </Link>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="ch247-card">
            <h3>All Business Tools</h3>
            <p className="ch247-page__hint">
              <Link to={BUSINESS_TOOLS_ROOT}>Back to the directory</Link> — 21 tools: 5 calculators,
              12 generators and 4 comparisons.
            </p>
          </div>
        </div>
      </section>

      {/* Announced to screen readers when the result appears or the form is reset. */}
      <span className="ch247-skip" style={{ position: 'absolute', left: '-9999px' }} aria-live="polite">
        {status === 'success' ? `${tool.name} produced a result.` : ''}
        {status === 'error' ? `${tool.name} could not run: ${errorMessage}` : ''}
      </span>
    </div>
  );
}

function DocumentPanel({
  document,
  onCopy,
  onDownload,
}: {
  document: ResultDocument;
  onCopy: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="bt247-document">
      <div className="bt247-document__head">
        <span className="bt247-document__label">
          {document.label} <span className="ch247-badge">{document.format.toUpperCase()}</span>
        </span>
        <span className="ch247-page__hint" style={{ margin: 0 }}>
          {document.filename}
        </span>
      </div>
      {document.format === 'svg' ? (
        <div
          className="bt247-document__body bt247-document__body--svg"
          // The SVG is generated locally from the visitor's own inputs and escaped field by field
          // (see escapeXml in the engine), so it contains no markup they did not type.
          dangerouslySetInnerHTML={{ __html: document.content }}
        />
      ) : (
        <pre className="bt247-document__body">
          <code>{document.content}</code>
        </pre>
      )}
      <div className="bt247-export">
        <button type="button" className="ch247-button ch247-button--small" onClick={onCopy}>
          Copy {document.label}
        </button>
        <button type="button" className="ch247-button ch247-button--small ch247-button--outline" onClick={onDownload}>
          Download {document.filename}
        </button>
      </div>
    </div>
  );
}

/** Group fields by their declared section, preserving declaration order. */
function groupFields(fields: readonly BusinessField[]): Array<{ name: string; fields: BusinessField[] }> {
  const groups: Array<{ name: string; fields: BusinessField[] }> = [];
  for (const field of fields) {
    const name = field.section ?? '';
    const existing = groups.find((group) => group.name === name);
    if (existing) existing.fields.push(field);
    else groups.push({ name, fields: [field] });
  }
  return groups;
}

function Field({
  field,
  value,
  error,
  onChange,
}: {
  field: BusinessField;
  value: string | number | boolean | undefined;
  error?: string;
  onChange: (next: string | number | boolean) => void;
}) {
  const id = `bt247-field-${field.key}`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [field.help || field.note ? helpId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const stringValue = typeof value === 'boolean' ? '' : value === undefined || value === null ? '' : String(value);

  if (field.type === 'boolean') {
    return (
      <div className="bt247-field bt247-field--checkbox">
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          aria-describedby={describedBy}
        />
        <div>
          <label className="bt247-field__label" htmlFor={id}>
            {field.label}
          </label>
          {field.help ? (
            <span className="bt247-field__help" id={helpId}>
              {field.help}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  const inputProps = {
    id,
    name: field.key,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
  };

  let control: ReactNode;
  if (field.type === 'select') {
    control = (
      <select
        {...inputProps}
        value={stringValue}
        onChange={(event) => onChange(event.target.value)}
      >
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  } else if (field.type === 'textarea' || field.type === 'lines') {
    control = (
      <textarea
        {...inputProps}
        value={stringValue}
        rows={field.type === 'lines' ? Math.min(10, Math.max(3, stringValue.split('\n').length + 1)) : 4}
        maxLength={field.maxLength}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  } else if (field.type === 'number' || field.type === 'integer' || field.type === 'percent' || field.type === 'money') {
    control = (
      <>
        {field.prefix ? <span className="bt247-field__affix" aria-hidden="true">{field.prefix}</span> : null}
        <input
          {...inputProps}
          type="number"
          inputMode={field.type === 'integer' ? 'numeric' : 'decimal'}
          value={stringValue}
          min={field.min}
          max={field.max}
          step={field.step ?? (field.type === 'integer' ? 1 : 'any')}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        {field.suffix ? <span className="bt247-field__affix" aria-hidden="true">{field.suffix}</span> : null}
      </>
    );
  } else {
    control = (
      <input
        {...inputProps}
        type={field.type === 'date' ? 'date' : field.type === 'month' ? 'month' : 'text'}
        value={stringValue}
        maxLength={field.maxLength}
        placeholder={field.placeholder}
        required={field.required}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <div className="bt247-field">
      <label className="bt247-field__label" htmlFor={id}>
        {field.label}
        {field.required ? (
          <span className="bt247-field__required" aria-hidden="true">
            *
          </span>
        ) : null}
        {field.required ? <span className="ch247-skip" style={{ position: 'absolute', left: '-9999px' }}> (required)</span> : null}
      </label>
      <div className="bt247-field__input">{control}</div>
      {field.help || field.note ? (
        <span className="bt247-field__help" id={helpId}>
          {field.help ?? field.note}
        </span>
      ) : null}
      {error ? (
        <span className="bt247-field__error" id={errorId} role="alert">
          <Icon name="alert" size={13} /> {error}
        </span>
      ) : null}
    </div>
  );
}
