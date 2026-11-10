/**
 * Design Studio — the "Saved templates" panel.
 *
 * One component for every studio, because the operation is the same everywhere: list what this account
 * has saved, load one back into the editor, save the current one, delete one. Three deliberate
 * choices:
 *
 *   · It reports the sign-in state instead of offering a button that can only fail. A visitor who has
 *     not signed in reads why, and what to do about it.
 *   · The server's own message is shown verbatim. "You already have a label template called
 *     'Despatch'. Rename this one or update the existing template." is advice; "Request failed" is not.
 *   · Deleting asks first, in place, and names the template. A one-click delete beside a list of things
 *     a customer built is a way to lose work.
 *
 * The panel does not decide what a template contains — the page hands it a `document` and gets one
 * back. That keeps "what is saved" a property of each studio (a label restores its template and values)
 * rather than a rule hidden in a shared component.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { savedTemplates, signedIn, type TemplateKind, type TemplateSummary } from '../../lib/design-studio-templates';
import { StudioInput } from './StudioFrame';

export interface SavedTemplatesPanelProps {
  kind: TemplateKind;
  /** The document to save. `null` disables saving — there is nothing to save yet. */
  document: Record<string, unknown> | null;
  /** A sensible default name, e.g. the active template's name. */
  defaultName?: string;
  /** Called with the stored document when the operator loads a template back. */
  onLoad: (document: Record<string, unknown>) => void;
  /** Optional one-line description stored beside the name. */
  summary?: string;
}

/** What a save will contain, stated plainly. Owned by the page, not guessed by the panel. */
export const SAVE_NOTE = 'A saved label keeps its template and the values you typed, so reopening it restores the label exactly as it was.';

export default function SavedTemplatesPanel({ kind, document, defaultName, onLoad, summary }: SavedTemplatesPanelProps) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [needsAuth, setNeedsAuth] = useState(false);
  const [name, setName] = useState(defaultName ?? '');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const authed = signedIn();

  const refresh = useCallback(async () => {
    if (!authed) return;
    setBusy(true);
    const result = await savedTemplates.list(kind);
    setBusy(false);
    if (!result.ok) {
      setNeedsAuth(Boolean(result.needsAuth));
      setError(result.error ?? 'The saved templates could not be loaded.');
      return;
    }
    setTemplates(result.data?.templates ?? []);
    setError('');
  }, [authed, kind]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The name field follows the chosen template until the operator types something of their own.
  useEffect(() => {
    if (defaultName && name === '') setName(defaultName);
  }, [defaultName, name]);

  const save = async () => {
    if (!document) return;
    setBusy(true);
    setError('');
    setNotice('');
    const result = await savedTemplates.create({
      kind,
      name: name.trim() || defaultName || 'Untitled template',
      ...(summary ? { summary } : {}),
      document,
    });
    setBusy(false);
    if (!result.ok) {
      setNeedsAuth(Boolean(result.needsAuth));
      setError(result.error ?? 'The template could not be saved.');
      return;
    }
    setNotice(`Saved “${result.data?.template.name}”.`);
    setName('');
    await refresh();
  };

  const load = async (id: string) => {
    setBusy(true);
    setError('');
    const result = await savedTemplates.get(id);
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? 'That template could not be loaded.');
      return;
    }
    onLoad(result.data.template.document);
    setNotice(`Loaded “${result.data.template.name}”.`);
  };

  const remove = async (id: string) => {
    setBusy(true);
    const result = await savedTemplates.remove(id);
    setBusy(false);
    setConfirmId(null);
    if (!result.ok) {
      setError(result.error ?? 'That template could not be deleted.');
      return;
    }
    setNotice('Template deleted.');
    await refresh();
  };

  if (!authed) {
    return (
      <div className="ch247-studio__panel">
        <h2>Saved templates</h2>
        <p className="ch247-studio__hint">
          Saving a layout needs an account, because the template has to live somewhere. Everything on this page works without one —{' '}
          <Link to="/login">sign in</Link> only to keep a template for next time.
        </p>
      </div>
    );
  }

  return (
    <div className="ch247-studio__panel">
      <h2>Saved templates</h2>
      <p className="ch247-studio__hint">{SAVE_NOTE}</p>

      <div style={{ marginTop: '0.6rem' }}>
        <StudioInput
          label="Name"
          value={name}
          maxLength={120}
          placeholder={defaultName ?? 'My template'}
          onChange={setName}
          hint="Names are unique per studio. Reusing a name tells you so rather than overwriting the old template."
        />
      </div>

      <div className="ch247-studio__actions">
        <button type="button" className="ch247-button" onClick={() => void save()} disabled={!document || busy}>
          {busy ? 'Working…' : 'Save this template'}
        </button>
        <button type="button" className="ch247-button ch247-button--ghost" onClick={() => void refresh()} disabled={busy}>
          Refresh
        </button>
      </div>

      {!document ? <p className="ch247-studio__hint">Generate a document first — there is nothing to save yet.</p> : null}

      {error ? (
        <p className="ch247-studio__issue ch247-studio__issue--error" role="alert">
          <span aria-hidden="true">✕</span>
          <span>
            {error}
            {needsAuth ? (
              <>
                {' '}
                <Link to="/login">Sign in</Link>.
              </>
            ) : null}
          </span>
        </p>
      ) : null}
      {notice ? (
        <p className="ch247-studio__hint" role="status">
          {notice}
        </p>
      ) : null}

      {templates.length === 0 ? (
        <p className="ch247-studio__hint">{busy ? 'Loading…' : 'No saved templates yet.'}</p>
      ) : (
        <div className="ch247-studio__table-wrap" style={{ marginTop: '0.6rem' }}>
          <table className="ch247-studio__table ch247-studio__table--compact">
            <thead>
              <tr>
                <th>Name</th>
                <th>Saved</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id}>
                  <td>
                    <strong>{template.name}</strong>
                    {template.summary ? <div className="ch247-studio__hint">{template.summary}</div> : null}
                  </td>
                  <td>{new Date(template.updatedAt).toLocaleDateString()}</td>
                  <td>
                    {confirmId === template.id ? (
                      <span className="ch247-studio__actions ch247-studio__actions--inline">
                        <button type="button" className="ch247-button ch247-button--danger ch247-button--small" onClick={() => void remove(template.id)}>
                          Delete “{template.name}”
                        </button>
                        <button type="button" className="ch247-button ch247-button--ghost ch247-button--small" onClick={() => setConfirmId(null)}>
                          Keep it
                        </button>
                      </span>
                    ) : (
                      <span className="ch247-studio__actions ch247-studio__actions--inline">
                        <button type="button" className="ch247-button ch247-button--outline ch247-button--small" onClick={() => void load(template.id)} disabled={busy}>
                          Load
                        </button>
                        <button type="button" className="ch247-button ch247-button--ghost ch247-button--small" onClick={() => setConfirmId(template.id)}>
                          Delete
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
