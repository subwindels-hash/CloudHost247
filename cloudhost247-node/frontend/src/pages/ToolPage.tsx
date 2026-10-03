import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import {
  buildToolInput,
  toolForm,
  toolsApi,
  type ToolEnvelope,
  type ToolExplanation,
  type ToolSummary,
} from '../lib/tools-api';

/**
 * One page for every tool. The form is generated from the schema in lib/tools-api.ts; a JSON editor
 * is always available for full control, and the raw envelope is rendered verbatim so the operator
 * can see exactly what the API returned (including warnings and sources).
 */
export default function ToolPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('{}');
  const [envelope, setEnvelope] = useState<ToolEnvelope<unknown> | null>(null);
  const [explanation, setExplanation] = useState<ToolExplanation | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The catalogue is the source of truth for tool URLs: a tool is addressed by its own `path`
   * (e.g. /tools/dns/propagation). The last path segment is accepted as a slug fallback so
   * /tools/dns-propagation keeps working too.
   */
  const requestedSlug = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const tool = useMemo(
    () => tools.find((entry) => entry.path === location.pathname) ?? tools.find((entry) => entry.slug === requestedSlug) ?? null,
    [tools, location.pathname, requestedSlug]
  );
  const slug = tool?.slug ?? requestedSlug;
  const form = useMemo(() => toolForm(slug), [slug]);

  usePageMeta(tool ? `${tool.name} · Tools Center` : 'Tool · Tools Center', tool?.summary);

  useEffect(() => {
    let cancelled = false;
    toolsApi
      .catalog()
      .then((catalog) => {
        if (!cancelled) setTools(catalog.tools);
      })
      .catch((loadError: Error) => {
        if (!cancelled) setError(loadError.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const initial: Record<string, string | boolean> = {};
    for (const field of form.fields) {
      if (field.defaultValue !== undefined) initial[field.name] = typeof field.defaultValue === 'number' ? String(field.defaultValue) : field.defaultValue;
      else if (field.type === 'checkbox') initial[field.name] = false;
      else initial[field.name] = '';
    }
    setValues(initial);
    setEnvelope(null);
    setExplanation(null);
    setNote(null);
  }, [form]);

  function currentInput(): Record<string, unknown> {
    if (jsonMode) {
      const parsed = JSON.parse(jsonText || '{}') as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('The advanced input must be a JSON object, for example {"domain":"example.com"}.');
      }
      return parsed as Record<string, unknown>;
    }
    return buildToolInput(slug, values);
  }

  async function run(options: { refresh?: boolean } = {}) {
    if (!tool) return;
    setBusy('run');
    setError(null);
    setNote(null);
    setExplanation(null);
    try {
      const input = { ...currentInput(), ...(options.refresh ? { refresh: true } : {}) };
      const result = await toolsApi.run<unknown>(slug, input);
      setEnvelope(result);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'The request failed.');
    } finally {
      setBusy(null);
    }
  }

  async function withResult(action: 'explain' | 'report' | 'ticket') {
    if (!tool) return;
    setBusy(action);
    setError(null);
    setNote(null);
    try {
      const input = currentInput();
      if (action === 'explain') {
        const result = await toolsApi.explain<unknown>(slug, input);
        setExplanation(result.explanation);
      } else if (action === 'report') {
        const result = await toolsApi.saveReport(slug, input);
        setNote(`Saved as a report (${result.report.target}). Open Saved reports to export or attach it to a ticket.`);
      } else {
        const result = await toolsApi.openTicket(slug, input, note ?? undefined);
        setNote(`Support ticket opened: ${result.ticket.subject}`);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The action failed.');
    } finally {
      setBusy(null);
    }
  }

  function downloadJson() {
    if (!envelope) return;
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `cloudhost247-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  // The Domain Health Center is addressed by the domain it describes, so this entry point asks for
  // one and then hands over to /domains/:domain/health (the catalogue stores that literal path).
  if (slug === 'domain-health') {
    return (
      <div className="tools-center">
        <nav className="tools-breadcrumb" aria-label="Breadcrumb">
          <Link to="/tools">Tools Center</Link>
          <span aria-current="page">Domain Health Center</span>
        </nav>
        <h1>Domain Health Center</h1>
        <p>
          Checks DNS records, e-mail authentication, DNSSEC, TLS and — for domains hosted here — the CloudHost247 site and zone behind
          them, then reports one verdict per section with the evidence it was based on.
        </p>
        <form
          className="tools-fields tools-fields--inline"
          onSubmit={(event) => {
            event.preventDefault();
            const field = new FormData(event.currentTarget).get('domain');
            const value = typeof field === 'string' ? field.trim() : '';
            if (value) navigate(`/domains/${encodeURIComponent(value)}/health`);
          }}
        >
          <label className="tools-field">
            <span>Domain</span>
            <input name="domain" type="text" required placeholder="example.com" />
          </label>
          <button type="submit" className="ch247-button">Check domain health</button>
        </form>
      </div>
    );
  }

  if (!tool && tools.length > 0) {
    return (
      <div className="tools-center">
        <h1>Tool not found</h1>
        <p>
          There is no tool registered under “{location.pathname}”. <Link to="/tools">Back to the Tools Center</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="tools-center tools-tool">
      <nav className="tools-breadcrumb" aria-label="Breadcrumb">
        <Link to="/tools">Tools Center</Link>
        {tool ? <Link to={`/tools?category=${tool.category}`}>{tool.category}</Link> : null}
        <span aria-current="page">{tool?.name ?? slug}</span>
      </nav>

      <header className="tools-tool__head">
        <h1>{tool?.name ?? 'Loading…'}</h1>
        {tool ? <p>{tool.description}</p> : null}
        {tool ? (
          <div className="tools-card__meta">
            <span className={`tools-badge tools-badge--${tool.status.toLowerCase()}`}>{tool.status.replace(/_/g, ' ')}</span>
            {tool.authRequired ? <span className="tools-badge tools-badge--auth">Sign-in required</span> : null}
            {tool.cacheSeconds > 0 ? <span className="tools-badge">Cached up to {tool.cacheSeconds}s</span> : null}
            {tool.providerKind ? <span className="tools-badge tools-badge--provider">{tool.providerKind}</span> : null}
          </div>
        ) : null}
        {tool && tool.status !== 'ACTIVE' && tool.statusMessage ? (
          <div className="tools-notice tools-notice--warning" role="status">{tool.statusMessage}</div>
        ) : null}
      </header>

      <div className="tools-tool__grid">
        <section className="tools-runner" aria-labelledby="tools-input">
          <div className="tools-runner__head">
            <h2 id="tools-input">Input</h2>
            <label className="tools-toggle">
              <input type="checkbox" checked={jsonMode} onChange={(event) => setJsonMode(event.target.checked)} />
              Advanced JSON input
            </label>
          </div>

          {jsonMode ? (
            <label className="tools-field">
              <span>Request body</span>
              <textarea rows={10} value={jsonText} onChange={(event) => setJsonText(event.target.value)} spellCheck={false} />
            </label>
          ) : (
            <div className="tools-fields">
              {form.fields.filter((field) => !field.showWhen || field.showWhen.equals.includes(String(values[field.showWhen.field] ?? ''))).map((field) => (
                <label key={field.name} className="tools-field">
                  <span>
                    {field.label}
                    {field.required ? <abbr title="required"> *</abbr> : null}
                  </span>
                  {field.type === 'textarea' ? (
                    <textarea
                      rows={6}
                      value={String(values[field.name] ?? '')}
                      placeholder={field.placeholder}
                      onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                    />
                  ) : field.type === 'select' ? (
                    <select
                      value={String(values[field.name] ?? '')}
                      onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                    >
                      {(field.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  ) : field.type === 'checkbox' ? (
                    <input
                      type="checkbox"
                      checked={values[field.name] === true}
                      onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.checked }))}
                    />
                  ) : (
                    <input
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={String(values[field.name] ?? '')}
                      placeholder={field.placeholder}
                      min={field.min}
                      max={field.max}
                      onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                    />
                  )}
                  {field.help ? <small>{field.help}</small> : null}
                </label>
              ))}
              {form.fields.length === 0 ? (
                <p className="tools-muted">
                  This tool takes no input{form.intro ? ` — ${form.intro}` : '.'} Switch to the advanced JSON editor if you need to
                  send extra options.
                </p>
              ) : null}
            </div>
          )}

          <div className="tools-runner__actions">
            <button type="button" className="ch247-button" disabled={busy !== null} onClick={() => void run()}>
              {busy === 'run' ? 'Running…' : 'Run tool'}
            </button>
            <button type="button" className="ch247-button ch247-button--ghost" disabled={busy !== null} onClick={() => void run({ refresh: true })}>
              Run without cache
            </button>
          </div>

          {error ? <div className="tools-notice tools-notice--error" role="alert">{error}</div> : null}
          {note ? <div className="tools-notice" role="status">{note}</div> : null}
        </section>

        <section className="tools-result" aria-labelledby="tools-output">
          <div className="tools-runner__head">
            <h2 id="tools-output">Result</h2>
            {envelope?.success ? (
              <div className="tools-result__actions">
                {envelope.meta.cached ? <span className="tools-badge">cached</span> : <span className="tools-badge">live</span>}
                <span className="tools-badge">{envelope.meta.durationMs} ms</span>
                <button type="button" className="ch247-button ch247-button--ghost" onClick={downloadJson}>Download JSON</button>
                <button type="button" className="ch247-button ch247-button--ghost" onClick={() => window.print()}>Print / PDF</button>
              </div>
            ) : null}
          </div>

          {!envelope ? (
            <p className="tools-empty">Run the tool to see its output here. The result panel shows the raw API envelope, including timings, sources and warnings.</p>
          ) : envelope.success ? (
            <>
              {envelope.meta.warnings.length > 0 ? (
                <ul className="tools-warnings">
                  {envelope.meta.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              {envelope.meta.sources.length > 0 ? <p className="tools-muted">Sources: {envelope.meta.sources.join(', ')}</p> : null}
              <pre className="tools-json">{JSON.stringify(envelope.data, null, 2)}</pre>
              <div className="tools-runner__actions">
                <button type="button" className="ch247-button ch247-button--ghost" disabled={busy !== null} onClick={() => void withResult('explain')}>
                  {busy === 'explain' ? 'Explaining…' : 'Explain this result'}
                </button>
                <button type="button" className="ch247-button ch247-button--ghost" disabled={busy !== null} onClick={() => void withResult('report')}>
                  Save as report
                </button>
                <button type="button" className="ch247-button ch247-button--ghost" disabled={busy !== null} onClick={() => void withResult('ticket')}>
                  Open a support ticket with this result
                </button>
              </div>
              {explanation ? (
                <div className="tools-explanation">
                  <h3>{explanation.headline}</h3>
                  <p className="tools-muted">Confidence: {explanation.confidence}. {explanation.note}</p>
                  <h4>What this means</h4>
                  <ul>{explanation.whatThisMeans.map((line) => <li key={line}>{line}</li>)}</ul>
                  <h4>What to check next</h4>
                  <ul>{explanation.whatToCheckNext.map((line) => <li key={line}>{line}</li>)}</ul>
                  <h4>Limits of this answer</h4>
                  <ul>{explanation.limitations.map((line) => <li key={line}>{line}</li>)}</ul>
                </div>
              ) : null}
            </>
          ) : (
            <div className="tools-notice tools-notice--error" role="alert">
              <strong>{envelope.code}</strong>
              <p>{envelope.message}</p>
              {envelope.retryable ? <p>Trying again later may work.</p> : null}
              {envelope.detail ? <pre className="tools-json tools-json--small">{JSON.stringify(envelope.detail, null, 2)}</pre> : null}
            </div>
          )}
        </section>
      </div>

      {tool && tool.notes.length > 0 ? (
        <section className="tools-notes" aria-labelledby="tools-notes">
          <h2 id="tools-notes">How this tool behaves</h2>
          <ul>{tool.notes.map((entry) => <li key={entry}>{entry}</li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}
