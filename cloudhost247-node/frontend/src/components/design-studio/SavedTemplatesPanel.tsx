/**
 * Design Studio — the "Saved templates" panel.
 *
 * One component for every studio, because the operation is the same everywhere: list what this account
 * has saved, load one back into the editor, keep the current layout, and maintain (rename, overwrite,
 * delete) what is already there. Five deliberate choices:
 *
 *   · **It reports the sign-in state instead of offering a button that can only fail.** A visitor who
 *     has not signed in reads why, and what to do about it.
 *   · **"Save as new" and "Save over" are different buttons, not a mode.** Creating a variant and
 *     replacing a template are the two things customers actually want, and the difference is
 *     destructive, so it is visible on the surface rather than hidden behind a checkbox.
 *   · **An overwrite names the template and its version before it happens.** "Replace 'Despatch' (v3)"
 *     is a decision an operator can make; "Are you sure?" is not.
 *   · **Every overwrite carries the revision that was loaded.** If another tab saved in between, the
 *     server refuses and this panel says so and reloads, rather than discarding that tab's work.
 *   · **The server's own message is shown verbatim.** "You already have a label template called
 *     'Despatch'…" is advice; "Request failed" is not.
 *
 * The panel does not decide what a template contains — the page hands it a `document` and gets one
 * back. That keeps "what is saved" a property of each studio (a label restores its template and
 * values) rather than a rule hidden in a shared component.
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
  /**
   * Decides whether a stored document can be applied to this page.
   *
   * Return a message to refuse the load, or `null` to accept it. The case this exists for: a template
   * saved when the studio offered a layout that a later release removed. Applying it anyway would put
   * the stored elements onto a different layout, so the label would look finished and be wrong. The
   * page knows which layouts it still offers; the panel does not, so the check belongs to the page and
   * the message is shown here, where the operator clicked.
   */
  validateLoad?: (document: Record<string, unknown>) => string | null;
}

/** What a save will contain, stated plainly. Owned by the page, not guessed by the panel. */
export const SAVE_NOTE =
  'A saved template keeps its layout and the values you typed, so reopening it restores the studio exactly as it was. Saving over an existing template replaces those contents and keeps its place in this list.';

/** The template this panel has open, and the version it saw — the basis for a safe overwrite. */
interface Loaded {
  id: string;
  name: string;
  revision: number;
}

export default function SavedTemplatesPanel({ kind, document, defaultName, onLoad, summary, validateLoad }: SavedTemplatesPanelProps) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [needsAuth, setNeedsAuth] = useState(false);

  // Save-as-new
  const [name, setName] = useState(defaultName ?? '');

  // Update-in-place: what is loaded, and which row is awaiting confirmation.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  // Rename: which row is being renamed, and the draft text.
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  // Delete: which row is awaiting confirmation.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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

  const report = (result: { ok: boolean; error?: string; needsAuth?: boolean }, fallback: string): boolean => {
    if (result.ok) return true;
    setNeedsAuth(Boolean(result.needsAuth));
    setError(result.error ?? fallback);
    return false;
  };

  /** Keep the current layout under a new name, leaving the original untouched. */
  const saveAsNew = async () => {
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
    if (!report(result, 'The template could not be saved.')) return;
    const created = result.data?.template;
    setNotice(`Saved as a new template${created ? ` “${created.name}”` : ''}.`);
    setName('');
    await refresh();
  };

  /**
   * Replace the loaded template's contents.
   *
   * `expectedRevision` is the revision this panel loaded. The server refuses the write if the stored
   * template has moved on, so an open tab cannot quietly undo a save made in another one.
   */
  const overwrite = async () => {
    if (!document || !loaded) return;
    setBusy(true);
    setError('');
    setNotice('');
    const result = await savedTemplates.overwrite(loaded.id, { document, expectedRevision: loaded.revision });
    setBusy(false);
    setConfirmOverwrite(false);
    if (!result.ok) {
      if (result.status === 409) {
        // A conflict is recoverable and worth explaining precisely: nothing was lost, and the fix is
        // to load the newer copy. Refresh so the list shows the version that won.
        setError(result.error ?? 'That template changed elsewhere. Reload it and try again.');
        setLoaded(null);
        await refresh();
        return;
      }
      report(result, 'The template could not be updated.');
      return;
    }
    const updated = result.data?.template;
    if (updated) {
      setLoaded({ id: updated.id, name: updated.name, revision: updated.revision });
      setNotice(`Updated “${updated.name}” — now version ${updated.revision}. The template kept its id and its place in the list.`);
    }
    await refresh();
  };

  const rename = async () => {
    if (!renaming) return;
    const next = renaming.name.trim();
    if (next === '') {
      setError('Give the template a name.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    const result = await savedTemplates.rename(renaming.id, { name: next });
    setBusy(false);
    if (!report(result, 'The template could not be renamed.')) return;
    const renamed = result.data?.template;
    setRenaming(null);
    // A rename never touches the document, so a loaded template stays loaded — but its name is part of
    // what the overwrite confirmation shows, so it has to follow.
    if (renamed && loaded?.id === renamed.id) setLoaded({ ...loaded, name: renamed.name });
    setNotice(`Renamed to “${renamed?.name ?? next}”. Its layout was not changed.`);
    await refresh();
  };

  const load = async (id: string) => {
    setBusy(true);
    setError('');
    const result = await savedTemplates.get(id);
    setBusy(false);
    if (!result.ok || !result.data) {
      report(result, 'That template could not be loaded.');
      return;
    }
    const template = result.data.template;
    const refusal = validateLoad?.(template.document) ?? null;
    if (refusal) {
      // Nothing was applied: the editor is exactly as the operator left it.
      setError(refusal);
      return;
    }
    onLoad(template.document);
    setLoaded({ id: template.id, name: template.name, revision: template.revision });
    setNotice(`Loaded “${template.name}” (version ${template.revision}).`);
  };

  const remove = async (id: string) => {
    setBusy(true);
    const result = await savedTemplates.remove(id);
    setBusy(false);
    setConfirmDelete(null);
    if (!report(result, 'That template could not be deleted.')) return;
    // Deleting the template that is loaded means there is nothing left to save over.
    if (loaded?.id === id) setLoaded(null);
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

  const managedRow = (template: TemplateSummary) => {
    if (renaming?.id === template.id) {
      return (
        <span className="ch247-studio__actions ch247-studio__actions--inline">
          <input
            type="text"
            aria-label={`New name for ${template.name}`}
            value={renaming.name}
            maxLength={120}
            onChange={(event) => setRenaming({ id: template.id, name: event.target.value })}
            style={{ minWidth: '10rem' }}
          />
          <button type="button" className="ch247-button ch247-button--small" onClick={() => void rename()} disabled={busy}>
            Save name
          </button>
          <button type="button" className="ch247-button ch247-button--ghost ch247-button--small" onClick={() => setRenaming(null)}>
            Cancel
          </button>
        </span>
      );
    }
    if (confirmDelete === template.id) {
      return (
        <span className="ch247-studio__actions ch247-studio__actions--inline">
          <button type="button" className="ch247-button ch247-button--danger ch247-button--small" onClick={() => void remove(template.id)}>
            Delete “{template.name}”
          </button>
          <button
            type="button"
            className="ch247-button ch247-button--ghost ch247-button--small"
            onClick={() => setConfirmDelete(null)}
          >
            Keep it
          </button>
        </span>
      );
    }
    return (
      <span className="ch247-studio__actions ch247-studio__actions--inline">
        <button
          type="button"
          className="ch247-button ch247-button--outline ch247-button--small"
          onClick={() => void load(template.id)}
          disabled={busy}
        >
          Load
        </button>
        <button
          type="button"
          className="ch247-button ch247-button--ghost ch247-button--small"
          onClick={() => setRenaming({ id: template.id, name: template.name })}
          disabled={busy}
        >
          Rename
        </button>
        <button
          type="button"
          className="ch247-button ch247-button--ghost ch247-button--small"
          onClick={() => setConfirmDelete(template.id)}
          disabled={busy}
        >
          Delete
        </button>
      </span>
    );
  };

  return (
    <div className="ch247-studio__panel">
      <h2>Saved templates</h2>
      <p className="ch247-studio__hint">{SAVE_NOTE}</p>

      <div style={{ marginTop: '0.6rem' }}>
        <StudioInput
          label="Name for a new template"
          value={name}
          maxLength={120}
          placeholder={defaultName ?? 'My template'}
          onChange={setName}
          hint="This only names a new copy. To change an existing template's name, use Rename in the list below."
        />
      </div>

      <div className="ch247-studio__actions">
        <button type="button" className="ch247-button" onClick={() => void saveAsNew()} disabled={!document || busy}>
          {busy ? 'Working…' : 'Save as new'}
        </button>
        <button type="button" className="ch247-button ch247-button--ghost" onClick={() => void refresh()} disabled={busy}>
          Refresh
        </button>
      </div>

      {!document ? <p className="ch247-studio__hint">Generate a document first — there is nothing to save yet.</p> : null}

      {/* Overwrite lives next to the loaded template, not in the list: it acts on what is open. */}
      {loaded ? (
        <div className="ch247-studio__notice" style={{ marginTop: '0.75rem' }}>
          <p>
            <strong>Editing “{loaded.name}”</strong> (version {loaded.revision}).
          </p>
          {confirmOverwrite ? (
            <>
              <p>
                Replace the saved contents of <strong>“{loaded.name}”</strong> with what is on this page? It keeps its id and its place in
                the list, the previous version is not kept, and the template will become version {loaded.revision + 1}.
              </p>
              <div className="ch247-studio__actions">
                <button type="button" className="ch247-button ch247-button--danger" onClick={() => void overwrite()} disabled={!document || busy}>
                  Replace “{loaded.name}”
                </button>
                <button type="button" className="ch247-button ch247-button--ghost" onClick={() => setConfirmOverwrite(false)}>
                  Keep the saved version
                </button>
              </div>
            </>
          ) : (
            <div className="ch247-studio__actions">
              <button type="button" className="ch247-button ch247-button--outline" onClick={() => setConfirmOverwrite(true)} disabled={!document || busy}>
                Save over “{loaded.name}”
              </button>
              <button type="button" className="ch247-button ch247-button--ghost" onClick={() => setLoaded(null)}>
                Stop editing it
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="ch247-studio__hint">
          Load a template from the list to edit it in place. Loading one is also what makes “save over” available — this page will not
          overwrite a template it has not shown you.
        </p>
      )}

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
                <th>Version</th>
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
                  <td>{template.revision ?? 1}</td>
                  <td>{new Date(template.updatedAt).toLocaleDateString()}</td>
                  <td>{managedRow(template)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
