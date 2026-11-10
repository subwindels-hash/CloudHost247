/**
 * Design Studio — the page frame every tool shares.
 *
 * The five tools have the same anatomy (breadcrumb, heading, explanation, configuration column,
 * live preview column, exports, usage, FAQ, related tools), so the anatomy lives here once. A tool
 * supplies its own form and result panel; the frame owns the layout, the preview scaling, the export
 * row and the long-form sections.
 *
 * Keeping this in one component is also what keeps the five pages visually identical as they evolve:
 * a change to the preview frame or the issue list applies to all of them at once.
 */
import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { StudioIssue, StudioResponse } from '../../lib/design-studio';
import { downloadPdf, downloadPng, downloadSvg, fileStem, printSvg } from '../../lib/design-studio';

export interface StudioExportOptions {
  /** Show the PDF button (default true: every tool has a PDF). */
  pdf?: boolean;
  png?: boolean;
  svg?: boolean;
  print?: boolean;
  /** Filename stem, e.g. "address-70x40". */
  stem: string;
  dpi?: number;
}

export interface StudioFrameProps {
  title: string;
  lede: string;
  /** Long explanation rendered under the heading, before the workbench. */
  intro?: ReactNode;
  /** The configuration column. */
  config: ReactNode;
  /** The current result, or null before the first run. */
  result: StudioResponse | null;
  /** A message shown in the preview area when there is no result yet. */
  emptyMessage?: string;
  busy?: boolean;
  error?: { code: string; message: string } | null;
  exports?: StudioExportOptions;
  /** Tool-specific result detail rendered under the preview (a payload, a field table…). */
  resultDetail?: ReactNode;
  /** Long-form sections under the workbench. */
  usage?: ReactNode;
  faq?: Array<{ q: string; a: string }>;
  related?: Array<{ title: string; href: string; blurb: string }>;
  /** Extra content under the intro — warnings, notices. */
  notice?: ReactNode;
}

/**
 * The issue list.
 *
 * Errors first, then warnings: an operator who has broken the export should not have to scroll past
 * three hints to find out why the Download button is disabled.
 */
export function StudioIssues({ issues }: { issues: StudioIssue[] }) {
  if (issues.length === 0) return null;
  const ordered = [...issues].sort((left, right) => {
    const rank = { error: 0, warn: 1, info: 2 } as const;
    return rank[left.level] - rank[right.level];
  });
  return (
    <ul className="ch247-studio__issues">
      {ordered.map((issue, index) => (
        <li key={`${issue.level}-${issue.field ?? ''}-${index}`} className={`ch247-studio__issue ch247-studio__issue--${issue.level}`}>
          <span aria-hidden="true">{issue.level === 'error' ? '✕' : issue.level === 'warn' ? '!' : 'i'}</span>
          <span>
            <strong>{issue.level === 'error' ? 'Error: ' : issue.level === 'warn' ? 'Check: ' : ''}</strong>
            {issue.message}
            {issue.hint ? <> <em>{issue.hint}</em></> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A labelled field with a hint and, when the tool reports one, its own error. */
export function StudioField({
  label,
  hint,
  htmlFor,
  children,
  required,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <div className="ch247-studio__field">
      <label htmlFor={htmlFor}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {hint ? <p className="ch247-studio__hint">{hint}</p> : null}
    </div>
  );
}

/** A text input wired to the StudioField conventions. */
export function StudioInput({
  label,
  hint,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
  maxLength,
  invalid,
  autoComplete,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'url' | 'tel' | 'number' | 'date';
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  invalid?: boolean;
  autoComplete?: string;
}) {
  const id = useId();
  return (
    <StudioField label={label} hint={hint} htmlFor={id} required={required}>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={invalid ? 'true' : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </StudioField>
  );
}

/** A textarea for multi-line values such as addresses. */
export function StudioTextarea({
  label,
  hint,
  value,
  onChange,
  rows = 3,
  maxLength,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <StudioField label={label} hint={hint} htmlFor={id}>
      <textarea id={id} value={value} rows={rows} maxLength={maxLength} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </StudioField>
  );
}

/** A select whose options come from the tool. */
export function StudioSelect<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <StudioField label={label} hint={hint} htmlFor={id}>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </StudioField>
  );
}

/** A slider paired with an exact number box: coarse and precise control of one value. */
export function StudioRange({
  label,
  value,
  min,
  max,
  step,
  onChange,
  unit,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  unit?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <StudioField label={label} hint={hint} htmlFor={id}>
      <div className="ch247-studio__range">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={`${label}${unit ? ` (${unit})` : ''}`}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
          }}
        />
      </div>
    </StudioField>
  );
}

/** A checkbox row. */
export function StudioCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="ch247-studio__check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

export default function StudioFrame({
  title,
  lede,
  intro,
  config,
  result,
  emptyMessage = 'Fill in the form and the preview appears here.',
  busy,
  error,
  exports,
  resultDetail,
  usage,
  faq,
  related,
  notice,
}: StudioFrameProps) {
  const exportsEnabled = exports && result && !result.blocked;

  return (
    <div className="ch247-studio">
      <nav className="ch247-studio__breadcrumb" aria-label="Breadcrumb">
        <Link to="/tools">Tools</Link> <span aria-hidden="true">/</span> {title}
      </nav>
      <h1 className="ch247-studio__title">{title}</h1>
      <p className="ch247-studio__lede">{lede}</p>
      {intro}
      {notice}

      <div className="ch247-studio__workbench">
        <div className="ch247-studio__column">
          <div className="ch247-studio__panel">{config}</div>
        </div>

        <div className="ch247-studio__column ch247-studio__column--preview">
          <div className="ch247-studio__panel">
            <h2>Live preview</h2>
            <div className="ch247-studio__preview" aria-busy={busy ? 'true' : undefined} aria-live="polite">
              {error ? (
                <p className="ch247-studio__issue ch247-studio__issue--error" role="alert">
                  <span aria-hidden="true">✕</span>
                  <span>
                    <strong>{error.code}: </strong>
                    {error.message}
                  </span>
                </p>
              ) : result ? (
                <div
                  className="ch247-studio__paper"
                  // The SVG is produced by our own renderer from validated data: every text node is
                  // escaped by `svg-renderer.ts` and no `<image>` may carry an SVG data URL, so this
                  // is our own markup rather than untrusted input.
                  dangerouslySetInnerHTML={{ __html: result.preview }}
                />
              ) : (
                <p className="ch247-studio__hint">{busy ? 'Generating…' : emptyMessage}</p>
              )}
            </div>

            {result ? (
              <div className="ch247-studio__meta">
                <span>
                  {result.sizeMm.width} × {result.sizeMm.height} mm
                </span>
                <span>{result.document.pages.length} page(s)</span>
                {result.meta?.xDimensionMm ? <span>module {String(result.meta.xDimensionMm)} mm</span> : null}
              </div>
            ) : null}

            {result && result.summary.length > 0 ? (
              <ul className="ch247-studio__hint" style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem' }}>
                {result.summary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}

            {result ? <StudioIssues issues={result.issues} /> : null}

            {exports && result ? (
              <div className="ch247-studio__actions">
                {exports.pdf !== false ? (
                  <button
                    type="button"
                    className="ch247-button"
                    disabled={!exportsEnabled || !result.pdf}
                    onClick={() => result.pdf && downloadPdf(result.pdf, `${fileStem(title)}-${exports.stem}.pdf`)}
                  >
                    Download PDF
                  </button>
                ) : null}
                {exports.svg !== false ? (
                  <button type="button" className="ch247-button ch247-button--outline" disabled={!exportsEnabled} onClick={() => downloadSvg(result.svg, `${fileStem(title)}-${exports.stem}.svg`)}>
                    Download SVG
                  </button>
                ) : null}
                {exports.png ? (
                  <button
                    type="button"
                    className="ch247-button ch247-button--outline"
                    disabled={!exportsEnabled}
                    onClick={() => void downloadPng(result.svg, result.sizeMm, `${fileStem(title)}-${exports.stem}.png`, exports.dpi ?? 300)}
                  >
                    Download PNG
                  </button>
                ) : null}
                {exports.print ? (
                  <button
                    type="button"
                    className="ch247-button ch247-button--ghost"
                    disabled={!exportsEnabled}
                    onClick={() => printSvg(result.svg, title, result.sizeMm)}
                  >
                    Print
                  </button>
                ) : null}
              </div>
            ) : null}

            {result?.blocked ? (
              <p className="ch247-studio__notice ch247-studio__notice--strong" role="status">
                Export is disabled while an error is listed above — printing a document built from invalid data is how a wrong label
                reaches a parcel.
              </p>
            ) : null}

            {resultDetail}
          </div>
        </div>
      </div>

      {usage ? <section className="ch247-studio__panel ch247-studio__prose">{usage}</section> : null}

      {faq && faq.length > 0 ? (
        <section className="ch247-studio__panel">
          <h2>Questions</h2>
          <div className="ch247-studio__faq">
            {faq.map((entry) => (
              <details key={entry.q}>
                <summary>{entry.q}</summary>
                <p>{entry.a}</p>
              </details>
            ))}
          </div>
        </section>
      ) : null}

      {related && related.length > 0 ? (
        <section className="ch247-studio__panel">
          <h2>Related tools</h2>
          <div className="ch247-studio__related">
            {related.map((entry) => (
              <Link key={entry.href} to={entry.href}>
                <strong>{entry.title}</strong>
                <span>{entry.blurb}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
