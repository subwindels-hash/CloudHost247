import { useRef, useState, type ChangeEvent } from 'react';
import { toolsApi } from '../../lib/tools-api';
import {
  EMPTY_LISTS,
  PRO_MAX_FILES,
  PRO_MAX_TOTAL_BYTES,
  addToList,
  chunkTexts,
  fileNameMatcher,
  isTopLevel,
  normalizeLists,
  type ProListKey,
  type ProLists,
} from './extractor-pro-lib';
import './email-extractor.css';

/**
 * Extractor Pro — its own tool page (`/tools/email-extractor-pro`): list management on top of the
 * shared extraction handler.
 *
 * Extract from the clipboard, from chosen files, or from a whole folder (optionally including
 * sub-folders) into one of three lists: Subscription, UnSubscription and Excluding Email Address
 * Pattern. Files are read in the browser; only their text is sent to the extractor, in batches.
 * The lists live in this page's memory only — nothing is stored on the server or in the browser.
 */
const LIST_TITLES: Record<ProListKey, string> = {
  subscription: 'Subscription',
  unsubscription: 'UnSubscription',
  excluding: 'Excluding Email Address Pattern',
};
const LIST_KEYS: ProListKey[] = ['subscription', 'unsubscription', 'excluding'];

export default function ExtractorProPanel({ unavailable }: { unavailable: boolean }) {
  const filesInput = useRef<HTMLInputElement | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const [lists, setLists] = useState<ProLists>(EMPTY_LISTS);
  // Latest lists for the async extraction, so edits made while a batch is running are not lost.
  const latest = useRef(lists);
  latest.current = lists;
  const [target, setTarget] = useState<ProListKey>('subscription');
  const [pattern, setPattern] = useState('*.htm; *.html; *.txt; *.csv');
  const [folderName, setFolderName] = useState('');
  const [subFolders, setSubFolders] = useState(false);
  const [selected, setSelected] = useState<Record<ProListKey, string[]>>({ subscription: [], unsubscription: [], excluding: [] });
  const [manual, setManual] = useState<Record<ProListKey, string>>({ subscription: '', unsubscription: '', excluding: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState('Ready.');
  const [error, setError] = useState<string | null>(null);

  /** Runs the texts through the extractor API and files the addresses into the target list. */
  async function extractInto(texts: string[], source: string) {
    const chunks = chunkTexts(texts);
    if (chunks.length === 0) {
      setStatus(`${source}: nothing to extract.`);
      return;
    }
    const found: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      setStatus(`${source}: extracting${chunks.length > 1 ? ` (batch ${index + 1} of ${chunks.length})` : ''}…`);
      const envelope = await toolsApi.run<{ addresses: string[] }>('email-extractor-pro', {
        text: chunks[index],
        type: 'email',
        separator: 'new-line',
      });
      if (!envelope.success) {
        setError(`${envelope.message}${found.length ? ' Addresses found before the failure were kept.' : ''}`);
        break;
      }
      found.push(...envelope.data.addresses);
    }
    const result = addToList(latest.current, target, found);
    setLists(result.lists);
    const skipped = new Set(found.map((address) => address.toLowerCase())).size - result.added;
    setStatus(
      `${source}: ${result.added} address${result.added === 1 ? '' : 'es'} added to ${LIST_TITLES[target]}` +
        (skipped > 0 ? `, ${skipped} skipped (already listed, unsubscribed or excluded).` : '.')
    );
  }

  async function guarded(label: string, work: () => Promise<void>) {
    if (busy || unavailable) return;
    setBusy(label);
    setError(null);
    try {
      await work();
    } catch {
      setError('The extraction could not be completed. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  function fromClipboard() {
    void guarded('clipboard', async () => {
      let text: string;
      try {
        if (!navigator.clipboard?.readText) throw new Error('Clipboard unavailable');
        text = await navigator.clipboard.readText();
      } catch {
        setError('Your browser blocked clipboard access. Allow clipboard permission for this site, or use Extract From File(s) instead.');
        return;
      }
      await extractInto([text], 'Clipboard');
    });
  }

  function readFiles(event: ChangeEvent<HTMLInputElement>, fromFolder: boolean) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (picked.length === 0) return;
    if (fromFolder) setFolderName(picked[0]?.webkitRelativePath.split('/')[0] ?? '');
    void guarded('files', async () => {
      const matches = fileNameMatcher(pattern);
      const files = picked.filter((file) => matches(file.name) && (!fromFolder || subFolders || isTopLevel(file.webkitRelativePath)));
      if (files.length === 0) {
        setStatus(`No files match “${pattern || '*'}”${fromFolder && !subFolders ? ' in the top level of that folder' : ''}.`);
        return;
      }
      if (files.length > PRO_MAX_FILES) {
        setError(`That selection has ${files.length} matching files; the limit is ${PRO_MAX_FILES} per run. Narrow the pattern or pick a smaller folder.`);
        return;
      }
      const bytes = files.reduce((sum, file) => sum + file.size, 0);
      if (bytes > PRO_MAX_TOTAL_BYTES) {
        setError(`Those files total ${(bytes / 1024 / 1024).toFixed(1)} MB; the limit is ${PRO_MAX_TOTAL_BYTES / 1024 / 1024} MB per run.`);
        return;
      }
      setStatus(`Reading ${files.length} file${files.length === 1 ? '' : 's'}…`);
      const texts = await Promise.all(files.map((file) => file.text()));
      await extractInto(texts, `${files.length} file${files.length === 1 ? '' : 's'}`);
    });
  }

  function update(next: ProLists, message: string) {
    setLists(normalizeLists(next));
    setSelected({ subscription: [], unsubscription: [], excluding: [] });
    setError(null);
    setStatus(message);
  }

  function addManual(key: ProListKey) {
    const entries = manual[key].split(/[\s,;]+/).filter(Boolean);
    if (entries.length === 0) return;
    const result = addToList(lists, key, entries);
    setLists(result.lists);
    setManual({ ...manual, [key]: '' });
    setError(null);
    setStatus(`${result.added} entr${result.added === 1 ? 'y' : 'ies'} added to ${LIST_TITLES[key]}.`);
  }

  async function copyList(key: ProListKey) {
    if (lists[key].length === 0) return setStatus(`${LIST_TITLES[key]} is empty.`);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(lists[key].join('\n'));
      setStatus(`${lists[key].length} entries copied from ${LIST_TITLES[key]}.`);
    } catch {
      setError('Your browser blocked clipboard access. Use Save to download the list instead.');
    }
  }

  function saveList(key: ProListKey) {
    if (lists[key].length === 0) return setStatus(`${LIST_TITLES[key]} is empty.`);
    const url = URL.createObjectURL(new Blob([lists[key].join('\r\n') + '\r\n'], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${key}-list.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(`${LIST_TITLES[key]} saved as ${key}-list.txt.`);
  }

  const working = busy !== null;

  return (
    <section className="ch247-extractor ch247-extractor-pro" aria-labelledby="ch247-extractor-pro-title">
      <div className="ch247-extractor__titlebar">
        <h2 id="ch247-extractor-pro-title">Extractor Pro</h2>
        <span>CloudHost247</span>
      </div>

      <div className="ch247-extractor-pro__top">
        <fieldset>
          <legend>Start Extraction</legend>
          <button type="button" className="ch247-extractor__btn" disabled={working || unavailable} onClick={fromClipboard}>
            Extract From Clipboard
          </button>
          <button type="button" className="ch247-extractor__btn" disabled={working || unavailable} onClick={() => filesInput.current?.click()}>
            Extract From File(s)
          </button>
          <select aria-label="List to extract into" value={target} onChange={(event) => setTarget(event.target.value as ProListKey)}>
            {LIST_KEYS.map((key) => (
              <option key={key} value={key}>
                {LIST_TITLES[key]}
              </option>
            ))}
          </select>
        </fieldset>

        <fieldset>
          <legend>Look into</legend>
          <div className="ch247-extractor__row">
            <label htmlFor="ch247-pro-pattern" className="ch247-extractor-pro__tag">
              Files
            </label>
            <input id="ch247-pro-pattern" type="text" value={pattern} maxLength={200} spellCheck={false} onChange={(event) => setPattern(event.target.value)} />
          </div>
          <div className="ch247-extractor__row">
            <button type="button" className="ch247-extractor__btn ch247-extractor-pro__tag" disabled={working || unavailable} onClick={() => folderInput.current?.click()}>
              Folder
            </button>
            <input type="text" aria-label="Chosen folder" value={folderName} readOnly placeholder="Press Folder to choose one" />
          </div>
          <label className="ch247-extractor__check">
            <input type="checkbox" checked={subFolders} onChange={(event) => setSubFolders(event.target.checked)} />
            Go into sub-folders
          </label>
          <input ref={filesInput} type="file" multiple hidden aria-label="Files to extract from" onChange={(event) => readFiles(event, false)} />
          <input
            ref={(node) => {
              folderInput.current = node;
              // `webkitdirectory` is not in React's typings; it is what turns the picker into a folder chooser.
              if (node) node.setAttribute('webkitdirectory', '');
            }}
            type="file"
            multiple
            hidden
            aria-label="Folder to extract from"
            onChange={(event) => readFiles(event, true)}
          />
        </fieldset>
      </div>

      <div className="ch247-extractor-pro__lists">
        {LIST_KEYS.map((key) => (
          <div className="ch247-extractor-pro__list" key={key}>
            <div className="ch247-extractor-pro__listhead">
              <label htmlFor={`ch247-pro-list-${key}`}>{LIST_TITLES[key]}</label>
              <output aria-label={`${LIST_TITLES[key]} count`}>{lists[key].length}</output>
            </div>
            <select
              id={`ch247-pro-list-${key}`}
              multiple
              size={10}
              value={selected[key]}
              onChange={(event) => setSelected({ ...selected, [key]: Array.from(event.target.selectedOptions, (option) => option.value) })}
            >
              {lists[key].map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
            <div className="ch247-extractor-pro__add">
              <input
                type="text"
                aria-label={`Add to ${LIST_TITLES[key]}`}
                placeholder={key === 'excluding' ? '*@example.com' : 'name@example.com'}
                value={manual[key]}
                spellCheck={false}
                onChange={(event) => setManual({ ...manual, [key]: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addManual(key);
                  }
                }}
              />
              <button type="button" className="ch247-extractor__btn" onClick={() => addManual(key)}>
                Add
              </button>
            </div>
            <div className="ch247-extractor-pro__tools">
              <button type="button" className="ch247-extractor__btn" onClick={() => void copyList(key)}>
                Copy
              </button>
              <button
                type="button"
                className="ch247-extractor__btn"
                onClick={() => {
                  if (selected[key].length === 0) return setStatus('Select one or more entries in the list first.');
                  const drop = new Set(selected[key]);
                  update({ ...lists, [key]: lists[key].filter((entry) => !drop.has(entry)) }, `${drop.size} entr${drop.size === 1 ? 'y' : 'ies'} deleted from ${LIST_TITLES[key]}.`);
                }}
              >
                Delete
              </button>
              <button
                type="button"
                className="ch247-extractor__btn"
                onClick={() => update({ ...lists, [key]: [...lists[key]].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en')) }, `${LIST_TITLES[key]} sorted.`)}
              >
                Sort
              </button>
              <button type="button" className="ch247-extractor__btn" onClick={() => update({ ...lists, [key]: [] }, `${LIST_TITLES[key]} cleared.`)}>
                Clear
              </button>
              <button type="button" className="ch247-extractor__btn" onClick={() => saveList(key)}>
                Save
              </button>
            </div>
          </div>
        ))}
      </div>

      {error ? (
        <p className="ch247-extractor__message ch247-extractor__message--error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="ch247-extractor-pro__statusbar">
        <span role="status">{status}</span>
        <span>{LIST_TITLES[target]}</span>
      </div>
    </section>
  );
}
