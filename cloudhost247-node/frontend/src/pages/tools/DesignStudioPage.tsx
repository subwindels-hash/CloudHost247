import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import StudioResult, { isStudioResult, type StudioResultView } from '../../components/tools/StudioResult';
import ToolSeo from '../../components/tools/ToolSeo';
import { toolsApi, type ToolSummary } from '../../lib/tools-api';
import { usePageMeta } from '../../lib/usePageMeta';
import {
  STUDIO_FORMS,
  applyStudioChange,
  buildStudioInput,
  studioDefaults,
  studioExample,
  visibleStudioFields,
  type StudioField,
  type StudioForm,
  type StudioOption,
  type StudioValues,
} from '../../../../src/tools/design-studio/forms';
import { STUDIO_TOOL_SLUGS, type StudioSlug } from '../../../../src/tools/design-studio/definitions';
import './design-studio.css';

/**
 * One page for the five Design Studio tools: Barcode Generator, Online Label Printing, VDA 4902
 * labels, Shipping Labels and QR Code Business Cards.
 *
 * The form is rendered from the shared description in src/tools/design-studio/forms.ts, which is
 * built from the registries the API validates against, so every field here is a field the server
 * reads. The artwork itself is always produced by the API: the preview shown is the SVG of the same
 * drawing the PDF contains, not a second rendering made in the browser.
 *
 * Nothing runs until the visitor asks for it. An automatic run on page load would be recorded as a
 * tool execution for every page view and distort the catalogue's usage ranking.
 */

const SWITCHER: ReadonlyArray<{ slug: StudioSlug; path: string }> = STUDIO_TOOL_SLUGS.map((slug) => ({ slug, path: `/tools/${slug}` }));

const RESULT_NOUN: Record<StudioSlug, string> = {
  'barcode-generator': 'barcode',
  'label-designer': 'labels',
  'vda-4902-label-generator': 'label',
  'shipping-label-generator': 'labels',
  'qr-business-card-designer': 'card',
  'qr-code-maker': 'code',
};

/** Options gathered under their group headings, in the order each heading first appears. */
function groupedOptions(options: StudioOption[]): Array<{ group: string | null; options: StudioOption[] }> {
  const groups: Array<{ group: string | null; options: StudioOption[] }> = [];
  for (const entry of options) {
    const group = entry.group ?? null;
    const existing = groups.find((candidate) => candidate.group === group);
    if (existing) existing.options.push(entry);
    else groups.push({ group, options: [entry] });
  }
  return groups;
}

interface FieldProps {
  id: string;
  field: StudioField;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
}

function FieldControl({ id, field, value, onChange }: FieldProps) {
  const describedBy = field.help ? `${id}-help` : undefined;
  const text = typeof value === 'string' ? value : '';

  if (field.type === 'checkbox') {
    return (
      <div className="studio-field studio-field--check">
        <label htmlFor={id}>
          <input id={id} type="checkbox" checked={value === true} aria-describedby={describedBy} onChange={(event) => onChange(event.target.checked)} />
          <span>{field.label}</span>
        </label>
        {field.help ? <small id={describedBy}>{field.help}</small> : null}
      </div>
    );
  }

  let control;
  if (field.type === 'select') {
    const groups = groupedOptions(field.options ?? []);
    control = (
      <select id={id} value={text} aria-describedby={describedBy} onChange={(event) => onChange(event.target.value)}>
        {groups.map((group) =>
          group.group ? (
            <optgroup key={group.group} label={group.group}>
              {group.options.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </optgroup>
          ) : (
            group.options.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))
          )
        )}
      </select>
    );
  } else if (field.type === 'textarea') {
    control = (
      <textarea
        id={id}
        rows={field.rows ?? 3}
        value={text}
        required={field.required}
        maxLength={field.maxLength}
        placeholder={field.placeholder}
        aria-describedby={describedBy}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  } else if (field.type === 'color') {
    const hex = /^#[0-9a-fA-F]{6}$/.test(text) ? text : String(field.defaultValue ?? '#000000');
    control = (
      <div className="studio-colour">
        <input type="color" aria-label={`${field.label} picker`} value={hex} onChange={(event) => onChange(event.target.value)} />
        <input id={id} type="text" value={text} maxLength={7} pattern="#[0-9a-fA-F]{6}" placeholder="#000000" aria-describedby={describedBy} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
      </div>
    );
  } else if (field.type === 'date' || field.type === 'time') {
    // The browser's own picker, which a phone shows as a wheel or a calendar. The value is the same
    // text either way: year-month-day, or hours:minutes on the 24-hour clock.
    control = (
      <input id={id} type={field.type} value={text} required={field.required} placeholder={field.placeholder} aria-describedby={describedBy} onChange={(event) => onChange(event.target.value)} />
    );
  } else if (field.type === 'number' || field.type === 'decimal') {
    control = (
      <input
        id={id}
        type="number"
        inputMode={field.type === 'decimal' ? 'decimal' : 'numeric'}
        value={text}
        required={field.required}
        min={field.min}
        max={field.max}
        step={field.type === 'decimal' ? (field.step ?? 'any') : 1}
        placeholder={field.placeholder}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  } else {
    control = (
      <input
        id={id}
        type="text"
        value={text}
        required={field.required}
        maxLength={field.maxLength}
        placeholder={field.placeholder}
        aria-describedby={describedBy}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <div className="studio-field">
      <label htmlFor={id}>
        {field.label}
        {field.required ? <abbr title="required"> *</abbr> : null}
      </label>
      {control}
      {field.help ? <small id={describedBy}>{field.help}</small> : null}
    </div>
  );
}

export default function DesignStudioPage({ slug }: { slug: StudioSlug }) {
  const form: StudioForm = STUDIO_FORMS[slug];
  const [values, setValues] = useState<StudioValues>(() => studioDefaults(form));
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [result, setResult] = useState<StudioResultView | null>(null);
  /** The request the artwork on screen was drawn from, to tell when the form has moved on. */
  const [drawnFrom, setDrawnFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const formNode = useRef<HTMLFormElement | null>(null);
  const resultNode = useRef<HTMLElement | null>(null);
  const rootNode = useRef<HTMLDivElement | null>(null);
  /** Counts finished requests, drawn or refused, so the page can bring each outcome into view. */
  const [outcome, setOutcome] = useState(0);

  const tool = useMemo(() => tools.find((entry) => entry.slug === slug) ?? null, [tools, slug]);
  const name = tool?.name ?? form.shortName;
  const unavailable = tool !== null && tool.status !== 'ACTIVE';
  usePageMeta(name, tool?.summary ?? form.intro);

  useEffect(() => {
    let cancelled = false;
    toolsApi
      .catalog()
      .then((catalog) => {
        if (!cancelled) setTools(catalog.tools);
      })
      .catch((reason: Error) => {
        if (!cancelled) setCatalogError(reason.message);
      });
    return () => {
      cancelled = true;
      pending.current?.abort();
    };
  }, []);

  // Each tool starts from its own defaults; a result or error from one tool never carries to the next.
  useEffect(() => {
    pending.current?.abort();
    setValues(studioDefaults(form));
    setResult(null);
    setDrawnFrom(null);
    setError(null);
    setBusy(false);
  }, [form]);

  // The site header stays on screen on wide layouts and scrolls away on narrow ones, and its height
  // changes with the announcement bar. The preview column sticks below it, and an outcome is
  // scrolled into view below it, so its height is measured here rather than assumed in the CSS.
  useEffect(() => {
    const root = rootNode.current;
    if (!root || typeof window === 'undefined') return undefined;
    const header = document.querySelector<HTMLElement>('.hg-header, .ch247-header');
    const apply = (): void => {
      const pinned = header !== null && ['sticky', 'fixed'].includes(window.getComputedStyle(header).position);
      const height = pinned && header ? Math.ceil(header.getBoundingClientRect().height) : 0;
      root.style.setProperty('--studio-top', `${height + 16}px`);
    };
    apply();
    window.addEventListener('resize', apply);
    const observer = header && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    if (observer && header) observer.observe(header);
    return () => {
      window.removeEventListener('resize', apply);
      observer?.disconnect();
    };
  }, []);

  // After each request, drawn or refused, the top of the output panel is brought into view: the
  // button that was pressed sits at the end of a long form, and the preview or the refusal is the
  // first thing in the panel. A panel that already starts near the top of the screen is left alone.
  useEffect(() => {
    const node = resultNode.current;
    if (outcome === 0 || !node || typeof window === 'undefined' || typeof node.scrollIntoView !== 'function') return;
    const offset = Number.parseFloat(window.getComputedStyle(node).scrollMarginTop) || 16;
    const top = node.getBoundingClientRect().top;
    if (top >= offset - 2 && top <= offset + (window.innerHeight - offset) / 3) return;
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    node.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  }, [outcome]);

  async function generate(input: StudioValues): Promise<void> {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    const request = buildStudioInput(form, input);
    // Files drawn from an earlier entry must never sit under a message about this one, so a
    // request that fails leaves no artwork on screen.
    const refuse = (message: string): void => {
      setResult(null);
      setDrawnFrom(null);
      setError(message);
      setOutcome((count) => count + 1);
    };
    try {
      const envelope = await toolsApi.run<unknown>(slug, request, controller.signal);
      if (controller.signal.aborted) return;
      if (envelope.success && isStudioResult(envelope.data)) {
        setResult(envelope.data);
        setDrawnFrom(JSON.stringify(request));
        try {
          const stored = JSON.parse(localStorage.getItem('ch247_recent_tools') ?? '[]') as unknown;
          const recent = Array.isArray(stored) ? stored.filter((entry) => typeof entry === 'string' && entry !== slug) : [];
          localStorage.setItem('ch247_recent_tools', JSON.stringify([slug, ...recent].slice(0, 8)));
        } catch {
          /* Storage is optional. Only the tool's name is remembered, never what was entered. */
        }
        setOutcome((count) => count + 1);
      } else if (envelope.success) {
        refuse('The server answered, but not with artwork this page can show. Please try again.');
      } else {
        refuse(envelope.code === 'RATE_LIMITED' ? `${envelope.message} Wait a moment and try again.` : envelope.message);
      }
    } catch (reason) {
      if (controller.signal.aborted) return;
      // When a request never arrives, fetch rejects with a TypeError worded by the browser
      // ("Failed to fetch", "Load failed"). Say what happened and what to do instead.
      refuse(reason instanceof TypeError ? 'The request did not reach our server. Check your connection and try again.' : reason instanceof Error ? reason.message : 'The request failed.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (unavailable || busy) return;
    void generate(values);
  }

  function showExample(): void {
    const example = studioExample(form, values);
    setValues(example);
    if (!unavailable) void generate(example);
  }

  function clearForm(): void {
    pending.current?.abort();
    setValues((current) => {
      // Keep the choices that shape the form (template, barcode type, sizes); clear what was typed.
      const cleared = studioDefaults(form);
      for (const section of form.sections) {
        for (const field of section.fields) {
          if (field.type === 'select' && current[field.name] !== undefined) cleared[field.name] = current[field.name] as string;
        }
      }
      return cleared;
    });
    setResult(null);
    setDrawnFrom(null);
    setError(null);
    setBusy(false);
  }

  // The artwork on screen is either what the form now says, or it is marked as older than the form.
  const changedSinceDrawn = result !== null && drawnFrom !== null && !busy && drawnFrom !== JSON.stringify(buildStudioInput(form, values));

  const related = tool ? tools.filter((entry) => entry.status === 'ACTIVE' && tool.relatedTools?.includes(entry.slug) && !STUDIO_TOOL_SLUGS.includes(entry.slug as StudioSlug)) : [];

  return (
    <div ref={rootNode} className="tools-center studio">
      <ToolSeo title={tool?.seoTitle ?? `${name} | CloudHost247`} description={tool?.summary ?? form.intro} path={`/tools/${slug}`} />

      <nav className="tools-breadcrumb" aria-label="Breadcrumb">
        <Link to="/tools">Tools Center</Link>
        <Link to="/tools/category/utilities">Utilities</Link>
        <span aria-current="page">{name}</span>
      </nav>

      <header className="studio-head">
        <p className="tools-eyebrow">BARCODES, LABELS AND CARDS</p>
        <h1>{name}</h1>
        <p className="studio-head__intro">{form.intro}</p>
        <nav className="studio-switcher" aria-label="Barcode and label tools">
          {SWITCHER.map((entry) => (
            <Link key={entry.slug} to={entry.path} className={`tools-chip${entry.slug === slug ? ' is-active' : ''}`} aria-current={entry.slug === slug ? 'page' : undefined}>
              {tools.find((candidate) => candidate.slug === entry.slug)?.name ?? STUDIO_FORMS[entry.slug].shortName}
            </Link>
          ))}
        </nav>
      </header>

      {unavailable ? (
        <div className="tools-notice tools-notice--warning" role="status">
          {tool?.statusMessage ?? 'This tool is not available at the moment.'}
        </div>
      ) : null}
      {catalogError ? (
        <div className="tools-notice tools-notice--warning" role="status">
          The tool catalogue could not be loaded ({catalogError}). You can still try the tool.
        </div>
      ) : null}

      <div className="studio-grid">
        <form ref={formNode} className="studio-form" aria-label={`${name} input`} onSubmit={onSubmit}>
          <div className="studio-form__top">
            <h2>Enter your details</h2>
            <div className="studio-form__tools">
              <button type="button" className="studio-link" onClick={showExample} disabled={busy}>
                Fill with an example
              </button>
              <button type="button" className="studio-link" onClick={clearForm}>
                Clear
              </button>
            </div>
          </div>

          {form.sections.map((section) => {
            const fields = visibleStudioFields(form, section, values);
            if (fields.length === 0) return null;
            return (
              <fieldset key={section.id} className="studio-section">
                <legend>{section.title}</legend>
                {section.description ? <p className="studio-section__note">{section.description}</p> : null}
                <div className="studio-fields">
                  {fields.map((field) => (
                    <div key={field.name} className={`studio-fields__cell${field.half ? ' studio-fields__cell--half' : ''}`}>
                      <FieldControl
                        id={`studio-${slug}-${field.name}`}
                        field={field}
                        value={values[field.name] ?? (field.type === 'checkbox' ? false : '')}
                        onChange={(next) => setValues((current) => applyStudioChange(form, current, field.name, next))}
                      />
                    </div>
                  ))}
                </div>
              </fieldset>
            );
          })}

          <div className="studio-form__actions">
            <button type="submit" className="ch247-button studio-submit" disabled={busy || unavailable}>
              {busy ? 'Generating…' : form.submitLabel}
            </button>
            <p className="studio-form__privacy">Processed on our server to draw the artwork, then discarded. Nothing you enter is stored.</p>
          </div>
        </form>

        <section ref={resultNode} className="studio-output" aria-labelledby="studio-output-title" aria-busy={busy}>
          <h2 id="studio-output-title">Preview and downloads</h2>
          <div aria-live="polite">
            {error ? (
              <div className="tools-notice tools-notice--error studio-error" role="alert">
                <strong>That could not be generated.</strong>
                <p>{error}</p>
              </div>
            ) : null}
            {busy && !result ? <p className="studio-muted">Drawing your {RESULT_NOUN[slug]}…</p> : null}
          </div>
          {changedSinceDrawn ? (
            <p className="tools-notice tools-notice--warning studio-changed" role="status">
              You have changed the details since this was drawn. Press <strong>{form.submitLabel}</strong> to update the preview and the files.
            </p>
          ) : null}
          {result ? (
            <div className={busy ? 'studio-output__stale' : undefined}>
              <StudioResult value={result} />
            </div>
          ) : !busy && !error ? (
            <div className="studio-empty">
              <p>
                Your {RESULT_NOUN[slug]} will appear here with the download buttons once you press <strong>{form.submitLabel}</strong>.
              </p>
              <button type="button" className="ch247-button ch247-button--ghost" onClick={showExample} disabled={unavailable}>
                Show me an example
              </button>
            </div>
          ) : null}
        </section>
      </div>

      {tool && tool.notes.length > 0 ? (
        <section className="tools-notes" aria-labelledby="studio-notes">
          <h2 id="studio-notes">What to know before you rely on it</h2>
          <p>{tool.description}</p>
          <ul>
            {tool.notes.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {related.length > 0 ? (
        <section aria-labelledby="studio-related">
          <h2 id="studio-related">Related tools</h2>
          <div className="tools-chips">
            {related.map((entry) => (
              <Link key={entry.slug} className="tools-chip" to={entry.path}>
                {entry.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
