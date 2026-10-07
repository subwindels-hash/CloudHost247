import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { measureBrowserConnection } from '../lib/tools-speed';
import QrResult from '../components/tools/QrResult';
import ToolResult from '../components/tools/ToolResult';
import ToolSeo from '../components/tools/ToolSeo';
import { toolsHost } from '../lib/tools-runtime';
import { useAuthState } from '../layout/useAuthState';
import { usePageMeta } from '../lib/usePageMeta';
import { ApiRequestError } from '../lib/api';
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
  const { token } = useAuthState();
  const pending = useRef<AbortController | null>(null);
  const formNode = useRef<HTMLFormElement | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('{}');
  const [envelope, setEnvelope] = useState<ToolEnvelope<unknown> | null>(null);
  const [explanation, setExplanation] = useState<ToolExplanation | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 'NOT_JSON' means the API was never reached (an SPA fallback or static server answered the
  // path with index.html). That is a deployment fact, not a tool state, and it must not be
  // reported as "this tool is unavailable" — the tool is fine.
  const [errorCode, setErrorCode] = useState<string | null>(null);

  /**
   * The catalogue is the source of truth for tool URLs: a tool is addressed by its own `path`
   * (e.g. /tools/dns/propagation). The last path segment is accepted as a slug fallback so
   * /tools/dns-propagation keeps working too.
   */
  const requestedSlug =
    location.pathname.split('/').filter(Boolean).pop() ?? '';
  const tool = useMemo(
    () =>
      tools.find(
        (entry) =>
          entry.path === location.pathname ||
          entry.legacyPaths?.includes(location.pathname)
      ) ?? null,
    [tools, location.pathname, requestedSlug]
  );
  const slug = tool?.slug ?? requestedSlug;
  const form = useMemo(() => toolForm(slug), [slug]);

  usePageMeta(tool ? tool.name : 'Tools', tool?.summary);
  const signInRequired = Boolean(
    tool?.authRequired && (!token || toolsHost().embedded)
  );
  const unavailable = !tool || tool.status !== 'ACTIVE' || signInRequired;
  useEffect(() => {
    if (tool && tool.path !== location.pathname && !tool.path.includes(':'))
      navigate(tool.path, { replace: true });
  }, [tool, location.pathname, navigate]);

  useEffect(() => {
    let cancelled = false;
    toolsApi
      .catalog()
      .then((catalog) => {
        if (!cancelled) setTools(catalog.tools);
      })
      .catch((loadError: Error) => {
        if (cancelled) return;
        setError(loadError.message);
        setErrorCode(loadError instanceof ApiRequestError ? loadError.code : null);
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
      pending.current?.abort();
    };
  }, []);

  useEffect(() => {
    pending.current?.abort();
    setBusy(null);
    setError(null);
    setErrorCode(null);
    const initial: Record<string, string | boolean> = {};
    for (const field of form.fields) {
      if (field.defaultValue !== undefined)
        initial[field.name] =
          typeof field.defaultValue === 'number'
            ? String(field.defaultValue)
            : field.defaultValue;
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
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error(
          'The advanced input must be a JSON object, for example {"domain":"example.com"}.'
        );
      }
      return parsed as Record<string, unknown>;
    }
    return buildToolInput(slug, values);
  }

  async function run(options: { refresh?: boolean } = {}) {
    if (
      !tool ||
      unavailable ||
      (!jsonMode && formNode.current && !formNode.current.reportValidity())
    )
      return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setEnvelope(null);
    setBusy('run');
    setError(null);
    setNote(null);
    setExplanation(null);
    try {
      const input = {
        ...currentInput(),
        ...(options.refresh ? { refresh: true } : {}),
      };
      const result = await toolsApi.run<unknown>(
        slug,
        input,
        controller.signal
      );
      if (result.success && slug === 'speed-test')
        result.data = {
          configuration: result.data,
          browserMeasurement: await measureBrowserConnection(
            result.data,
            controller.signal
          ),
        };
      if (controller.signal.aborted) return;
      setEnvelope(result);
      if (result.success) {
        try {
          const stored = JSON.parse(
            localStorage.getItem('ch247_recent_tools') ?? '[]'
          );
          const recent = Array.isArray(stored)
            ? stored.filter(
                (value) => typeof value === 'string' && value !== slug
              )
            : [];
          localStorage.setItem(
            'ch247_recent_tools',
            JSON.stringify([slug, ...recent].slice(0, 8))
          );
        } catch {
          /* Storage is optional; never persist query inputs or result values. */
        }
      }
    } catch (runError) {
      if (controller.signal.aborted) return;
      setError(
        runError instanceof Error ? runError.message : 'The request failed.'
      );
      setErrorCode(
        runError instanceof ApiRequestError ? runError.code : null
      );
    } finally {
      if (!controller.signal.aborted) setBusy(null);
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
        setNote(
          `Saved as a report (${result.report.target}). Open Saved reports to export or attach it to a ticket.`
        );
      } else {
        const result = await toolsApi.openTicket(
          slug,
          input,
          note ?? undefined
        );
        setNote(`Support ticket opened: ${result.ticket.subject}`);
      }
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'The action failed.'
      );
      setErrorCode(
        actionError instanceof ApiRequestError ? actionError.code : null
      );
    } finally {
      setBusy(null);
    }
  }

  function downloadJson() {
    if (!envelope) return;
    const blob = new Blob([JSON.stringify(envelope, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `cloudhost247-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!catalogLoading && !tool) {
    if (!error) {
      return (
        <div className="tools-center">
          <h1>Tool not found</h1>
          <p>
            There is no tool registered under “{location.pathname}”.{' '}
            <Link to="/tools">Back to the Tools Center</Link>.
          </p>
        </div>
      );
    }
    // The catalogue could not be loaded at all. When the API was never reached, say that — the
    // old copy blamed the tool ("Tools temporarily unavailable") and then added "There is no tool
    // registered under …", which is a second, false claim about a page nobody was able to read.
    const unreachable = errorCode === 'NOT_JSON';
    return (
      <div className="tools-center">
        <h1>{unreachable ? 'The tool catalogue could not be loaded' : 'Tools temporarily unavailable'}</h1>
        <p role="alert">{error}</p>
        {unreachable ? (
          <p>
            Every tool on this site lives on this page, so none of them can be opened until the
            API answers again. This is a problem with the server, not with your account or this
            tool.{' '}
            <Link to="/tools">Back to the Tools Center</Link>.
          </p>
        ) : (
          <p>
            The catalogue did not load, so this page cannot tell you whether “{location.pathname}”
            exists. <Link to="/tools">Back to the Tools Center</Link>.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="tools-center tools-tool">
      {tool && (
        <ToolSeo
          title={tool.seoTitle ?? `${tool.name} | CloudHost247`}
          description={tool.summary}
          path={tool.path}
        />
      )}
      {signInRequired && (
        <p role="status" className="tools-notice">
          This operation requires a platform account.{' '}
          {toolsHost().embedded ? (
            toolsHost().platform ? (
              <a href={`${toolsHost().platform}${tool?.path}`}>
                Open in the platform to sign in
              </a>
            ) : (
              'Ask support to configure platform access.'
            )
          ) : (
            <Link to="/login">Sign in to continue</Link>
          )}
        </p>
      )}
      <nav className="tools-breadcrumb" aria-label="Breadcrumb">
        <Link to="/tools">Tools Center</Link>
        {tool ? (
          <Link to={`/tools?category=${tool.category}`}>{tool.category}</Link>
        ) : null}
        <span aria-current="page">{tool?.name ?? slug}</span>
      </nav>

      <header className="tools-tool__head">
        <h1>{tool?.name ?? 'Loading…'}</h1>
        {tool ? <p>{tool.description}</p> : null}
        {tool ? (
          <div className="tools-card__meta">
            <span
              className={`tools-badge tools-badge--${tool.status.toLowerCase()}`}
            >
              {tool.status.replace(/_/g, ' ')}
            </span>
            {tool.authRequired ? (
              <span className="tools-badge tools-badge--auth">
                Sign-in required
              </span>
            ) : null}
            {tool.cacheSeconds > 0 ? (
              <span className="tools-badge">
                Cached up to {tool.cacheSeconds}s
              </span>
            ) : null}
            {tool.providerKind ? (
              <span className="tools-badge tools-badge--provider">
                {tool.providerKind}
              </span>
            ) : null}
          </div>
        ) : null}
        {tool && tool.status !== 'ACTIVE' && tool.statusMessage ? (
          <div className="tools-notice tools-notice--warning" role="status">
            {tool.statusMessage}
          </div>
        ) : null}
      </header>

      <div className="tools-tool__grid">
        <form
          ref={formNode}
          className="tools-runner"
          aria-labelledby="tools-input"
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <div className="tools-runner__head">
            <h2 id="tools-input">Input</h2>
            <label className="tools-toggle">
              <input
                type="checkbox"
                checked={jsonMode}
                onChange={(event) => setJsonMode(event.target.checked)}
              />
              Advanced JSON input
            </label>
          </div>

          {slug === 'speed-test' && (
            <p className="tools-notice">
              Running this test transfers up to 2 MiB in each direction, subject
              to the operator’s lower limits. Results describe this browser’s
              connection to CloudHost247, not your ISP’s advertised speed.
            </p>
          )}
          {jsonMode ? (
            <label className="tools-field">
              <span>Request body</span>
              <textarea
                rows={10}
                value={jsonText}
                onChange={(event) => setJsonText(event.target.value)}
                spellCheck={false}
              />
            </label>
          ) : (
            <div className="tools-fields">
              {form.fields
                .filter(
                  (field) =>
                    !field.showWhen ||
                    field.showWhen.equals.includes(
                      String(values[field.showWhen.field] ?? '')
                    )
                )
                .map((field) => (
                  <label key={field.name} className="tools-field">
                    <span>
                      {field.label}
                      {field.required ? <abbr title="required"> *</abbr> : null}
                    </span>
                    {field.type === 'textarea' ? (
                      <textarea
                        rows={6}
                        required={field.required}
                        value={String(values[field.name] ?? '')}
                        placeholder={field.placeholder}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [field.name]: event.target.value,
                          }))
                        }
                      />
                    ) : field.type === 'select' ? (
                      <select
                        required={field.required}
                        value={String(values[field.name] ?? '')}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [field.name]: event.target.value,
                          }))
                        }
                      >
                        {(field.options ?? []).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : field.type === 'checkbox' ? (
                      <input
                        type="checkbox"
                        checked={values[field.name] === true}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [field.name]: event.target.checked,
                          }))
                        }
                      />
                    ) : (
                      <input
                        type={
                          field.type === 'number'
                            ? 'number'
                            : /password/i.test(field.name)
                              ? 'password'
                              : 'text'
                        }
                        required={field.required}
                        value={String(values[field.name] ?? '')}
                        placeholder={field.placeholder}
                        min={field.min}
                        max={field.max}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [field.name]: event.target.value,
                          }))
                        }
                      />
                    )}
                    {field.help ? <small>{field.help}</small> : null}
                  </label>
                ))}
              {form.fields.length === 0 ? (
                <p className="tools-muted">
                  This tool takes no input
                  {form.intro ? ` — ${form.intro}` : '.'} Switch to the advanced
                  JSON editor if you need to send extra options.
                </p>
              ) : null}
            </div>
          )}

          <div className="tools-runner__actions">
            <button
              type="submit"
              className="ch247-button"
              disabled={busy !== null || unavailable}
            >
              {busy === 'run' ? 'Running…' : 'Run tool'}
            </button>
            <button
              type="button"
              className="ch247-button ch247-button--ghost"
              disabled={busy !== null || unavailable}
              onClick={() => void run({ refresh: true })}
            >
              Run without cache
            </button>
          </div>

          {error ? (
            <div className="tools-notice tools-notice--error" role="alert">
              {error}
            </div>
          ) : null}
          {note ? (
            <div className="tools-notice" role="status">
              {note}
            </div>
          ) : null}
        </form>

        <section
          aria-busy={busy === 'run'}
          className="tools-result"
          aria-labelledby="tools-output"
        >
          <div className="tools-runner__head">
            <h2 id="tools-output">Result</h2>
            {envelope?.success ? (
              <div className="tools-result__actions">
                {envelope.meta.cached ? (
                  <span className="tools-badge">cached</span>
                ) : (
                  <span className="tools-badge">
                    {tool?.resultMode === 'static'
                      ? 'Static reference / configuration'
                      : tool?.resultMode === 'calculated'
                        ? 'Calculated / generated'
                        : 'Live lookup / measurement'}
                  </span>
                )}
                <span className="tools-badge">
                  {envelope.meta.durationMs} ms
                </span>
                <button
                  type="button"
                  className="ch247-button ch247-button--ghost"
                  onClick={downloadJson}
                >
                  Download JSON
                </button>
                <button
                  type="button"
                  className="ch247-button ch247-button--ghost"
                  onClick={() => window.print()}
                >
                  Print / PDF
                </button>
              </div>
            ) : null}
          </div>

          {busy === 'run' && (
            <p role="status">
              Checking… Results will appear when the backend responds.
            </p>
          )}
          {!envelope ? (
            <p className="tools-empty">
              Run the tool to see its output here. The result panel shows the
              raw API envelope, including timings, sources and warnings.
            </p>
          ) : envelope.success ? (
            <>
              {envelope.meta.warnings.length > 0 ? (
                <ul className="tools-warnings">
                  {envelope.meta.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              {envelope.meta.sources.length > 0 ? (
                <p className="tools-muted">
                  Sources: {envelope.meta.sources.join(', ')}
                </p>
              ) : null}
              {['qr-generator', 'wifi-qr'].includes(slug) && (
                <QrResult value={envelope.data} />
              )}
              <ToolResult value={envelope.data} />
              <details>
                <summary>Raw response data</summary>
                <pre className="tools-json">
                  {JSON.stringify(envelope.data, null, 2)}
                </pre>
              </details>
              <button
                type="button"
                className="ch247-button ch247-button--ghost"
                onClick={() => {
                  void (
                    navigator.clipboard
                      ? navigator.clipboard.writeText(
                          JSON.stringify(envelope.data, null, 2)
                        )
                      : Promise.reject(new Error('Clipboard unavailable'))
                  )
                    .then(() => setNote('Result copied.'))
                    .catch(() =>
                      setNote('Copy unavailable. Use Download JSON instead.')
                    );
                }}
              >
                Copy result
              </button>
              {!toolsHost().embedded && (
                <div className="tools-runner__actions">
                  <button
                    type="button"
                    className="ch247-button ch247-button--ghost"
                    disabled={busy !== null}
                    onClick={() => void withResult('explain')}
                  >
                    {busy === 'explain' ? 'Explaining…' : 'Explain this result'}
                  </button>
                  <button
                    type="button"
                    className="ch247-button ch247-button--ghost"
                    disabled={busy !== null}
                    onClick={() => void withResult('report')}
                  >
                    Save as report
                  </button>
                  <button
                    type="button"
                    className="ch247-button ch247-button--ghost"
                    disabled={busy !== null}
                    onClick={() => void withResult('ticket')}
                  >
                    Open a support ticket with this result
                  </button>
                </div>
              )}
              {explanation ? (
                <div className="tools-explanation">
                  <h3>{explanation.headline}</h3>
                  <p className="tools-muted">
                    Confidence: {explanation.confidence}. {explanation.note}
                  </p>
                  <h4>What this means</h4>
                  <ul>
                    {explanation.whatThisMeans.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <h4>What to check next</h4>
                  <ul>
                    {explanation.whatToCheckNext.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <h4>Limits of this answer</h4>
                  <ul>
                    {explanation.limitations.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <div className="tools-notice tools-notice--error" role="alert">
              <strong>{envelope.code}</strong>
              <p>{envelope.message}</p>
              {envelope.retryable ? <p>Trying again later may work.</p> : null}
              {envelope.detail ? (
                <pre className="tools-json tools-json--small">
                  {JSON.stringify(envelope.detail, null, 2)}
                </pre>
              ) : null}
            </div>
          )}
        </section>
      </div>

      {tool && tool.notes.length > 0 ? (
        <section className="tools-notes" aria-labelledby="tools-notes">
          <h2 id="tools-notes">How this tool behaves</h2>
          <ul>
            {tool.notes.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {tool && (
        <section className="tools-notes">
          <h2>Understanding this check</h2>
          <p>{tool.description}</p>
          <details>
            <summary>Where does the result come from?</summary>
            <p>
              {tool.resultMode === 'calculated'
                ? 'This utility computes or generates the output on the CloudHost247 backend. It does not claim to measure a live network.'
                : 'The backend uses the configured resolver, registry or network service. The response identifies returned sources when available.'}
            </p>
          </details>
          <details>
            <summary>Why might a check fail?</summary>
            <p>
              Invalid inputs, rate limits, a timeout or an unavailable provider
              can prevent a result. An error is not evidence that a domain or
              service is healthy or unhealthy.
            </p>
          </details>
          <details>
            <summary>Can I rely on a cached result?</summary>
            <p>
              Cached results are labelled with their original time in the
              response warnings. Use “Run without cache” to request a new check,
              subject to the same abuse limits.
            </p>
          </details>
        </section>
      )}
      {tool && (
        <section>
          <h2>Related tools</h2>
          <div className="tools-chips">
            {tools
              .filter(
                (entry) =>
                  entry.slug !== slug &&
                  entry.status === 'ACTIVE' &&
                  (tool.relatedTools?.includes(entry.slug) ??
                    entry.category === tool.category)
              )
              .slice(0, 4)
              .map((entry) => (
                <Link key={entry.slug} className="tools-chip" to={entry.path}>
                  {entry.name}
                </Link>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
