import { useRef, useState, type FormEvent } from 'react';
import { toolsApi } from '../../lib/tools-api';
import './email-extractor.css';

/**
 * Classic two-window extractor layout for the `email-extractor` tool: an Input Window and an
 * Output Window side by side, Paste / Copy under each, the output and filter options beneath, and
 * a counter. The extraction itself is the same server handler every other surface uses
 * (`POST /api/tools/email-extractor`); this component only arranges it.
 */
interface ExtractData {
  count: number;
  found: number;
  duplicatesRemoved: number;
  filteredOut: number;
  output: string;
  notes: string[];
}

type Separator = 'comma' | 'pipe' | 'colon' | 'new-line' | 'other';

export default function EmailExtractorPanel({ unavailable }: { unavailable: boolean }) {
  const pending = useRef<AbortController | null>(null);
  const outputNode = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState('');
  const [output, setOutput] = useState('');
  const [separator, setSeparator] = useState<Separator>('comma');
  const [customSeparator, setCustomSeparator] = useState('');
  const [groupSize, setGroupSize] = useState('');
  const [sort, setSort] = useState(false);
  const [filterMode, setFilterMode] = useState<'only' | 'exclude'>('only');
  const [filter, setFilter] = useState('');
  const [type, setType] = useState<'email' | 'web'>('email');
  const [result, setResult] = useState<ExtractData | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function extract(event?: FormEvent) {
    event?.preventDefault();
    if (unavailable || busy) return;
    if (!text.trim()) {
      setError('Paste some text into the Input Window first.');
      return;
    }
    if (separator === 'other' && !customSeparator) {
      setError('Enter the separator to use, or choose one of the listed separators.');
      return;
    }
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const group = Number(groupSize);
      const envelope = await toolsApi.run<ExtractData>(
        'email-extractor',
        {
          text,
          type,
          separator,
          ...(separator === 'other' ? { customSeparator } : {}),
          ...(Number.isFinite(group) && group >= 1 ? { groupSize: Math.floor(group) } : {}),
          sort,
          ...(filter.trim() ? { filter: filter.trim(), filterMode } : {}),
        },
        controller.signal
      );
      if (controller.signal.aborted) return;
      if (envelope.success) {
        setResult(envelope.data);
        setOutput(envelope.data.output);
      } else {
        setResult(null);
        setOutput('');
        setError(envelope.message);
      }
    } catch {
      if (!controller.signal.aborted) setError('The extractor could not be reached. Check your connection and try again.');
    } finally {
      if (pending.current === controller) setBusy(false);
    }
  }

  async function pasteInput() {
    setError(null);
    try {
      if (!navigator.clipboard?.readText) throw new Error('Clipboard unavailable');
      setText(await navigator.clipboard.readText());
      setNote('Clipboard pasted into the Input Window.');
    } catch {
      setNote('Your browser blocked clipboard access. Click in the Input Window and press Ctrl+V (⌘V on Mac).');
    }
  }

  async function copyOutput() {
    setError(null);
    if (!output) {
      setNote('There is nothing to copy yet. Press Extract first.');
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(output);
      setNote('Output copied to the clipboard.');
    } catch {
      outputNode.current?.select();
      setNote('Your browser blocked clipboard access. The output is selected — press Ctrl+C (⌘C on Mac).');
    }
  }

  function reset() {
    pending.current?.abort();
    setText('');
    setOutput('');
    setResult(null);
    setError(null);
    setNote(null);
    setBusy(false);
  }

  return (
    <form className="ch247-extractor" onSubmit={(event) => void extract(event)} aria-labelledby="ch247-extractor-title">
      <div className="ch247-extractor__titlebar">
        <h2 id="ch247-extractor-title">Email &amp; Link Extractor</h2>
        <span>CloudHost247</span>
      </div>

      <div className="ch247-extractor__windows">
        <div className="ch247-extractor__window">
          <label htmlFor="ch247-extractor-input">Input Window</label>
          <textarea
            id="ch247-extractor-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={500_000}
            spellCheck={false}
            placeholder="Paste text containing email addresses or links…"
          />
          <button type="button" className="ch247-extractor__btn" onClick={() => void pasteInput()}>
            Paste Input
          </button>
        </div>
        <div className="ch247-extractor__window">
          <label htmlFor="ch247-extractor-output">Output Window</label>
          <textarea
            id="ch247-extractor-output"
            ref={outputNode}
            value={output}
            readOnly
            spellCheck={false}
            aria-busy={busy}
            placeholder="Extracted addresses appear here."
          />
          <button type="button" className="ch247-extractor__btn" onClick={() => void copyOutput()}>
            Copy Output
          </button>
        </div>
      </div>

      <div className="ch247-extractor__options">
        <fieldset>
          <legend>Output Option</legend>
          <div className="ch247-extractor__row">
            <label htmlFor="ch247-extractor-separator">Separator:</label>
            <select id="ch247-extractor-separator" value={separator} onChange={(event) => setSeparator(event.target.value as Separator)}>
              <option value="comma">Comma</option>
              <option value="pipe">Pipe</option>
              <option value="colon">Colon</option>
              <option value="new-line">New Line</option>
              <option value="other">Other</option>
            </select>
            <input
              type="text"
              className="ch247-extractor__short"
              aria-label="Other separator"
              value={customSeparator}
              maxLength={20}
              disabled={separator !== 'other'}
              onChange={(event) => setCustomSeparator(event.target.value)}
            />
          </div>
          <div className="ch247-extractor__row">
            <label htmlFor="ch247-extractor-group">Group:</label>
            <input
              id="ch247-extractor-group"
              type="number"
              className="ch247-extractor__short"
              min={1}
              max={10000}
              inputMode="numeric"
              value={groupSize}
              onChange={(event) => setGroupSize(event.target.value)}
            />
            <span>Addresses</span>
          </div>
          <label className="ch247-extractor__check">
            <input type="checkbox" checked={sort} onChange={(event) => setSort(event.target.checked)} />
            Sort Alphabetically
          </label>
        </fieldset>

        <fieldset>
          <legend>Filter Option</legend>
          <div className="ch247-extractor__row">
            <select aria-label="Filter mode" value={filterMode} onChange={(event) => setFilterMode(event.target.value as 'only' | 'exclude')}>
              <option value="only">Only</option>
              <option value="exclude">Do not</option>
            </select>
            <label htmlFor="ch247-extractor-filter">extract address containing this string:</label>
          </div>
          <input id="ch247-extractor-filter" type="text" value={filter} maxLength={200} onChange={(event) => setFilter(event.target.value)} />
          <div className="ch247-extractor__row">
            <label htmlFor="ch247-extractor-type">Type of address to extract:</label>
            <select id="ch247-extractor-type" value={type} onChange={(event) => setType(event.target.value as 'email' | 'web')}>
              <option value="email">Email</option>
              <option value="web">Web</option>
            </select>
          </div>
        </fieldset>
      </div>

      <div className="ch247-extractor__actions">
        <button type="submit" className="ch247-extractor__btn ch247-extractor__btn--primary" disabled={busy || unavailable}>
          {busy ? 'Extracting…' : 'Extract'}
        </button>
        <button type="button" className="ch247-extractor__btn" onClick={reset}>
          Reset
        </button>
        <label className="ch247-extractor__counter">
          Counter:
          <output aria-live="polite">{result ? result.count : 0}</output>
        </label>
      </div>

      {error ? (
        <p className="ch247-extractor__message ch247-extractor__message--error" role="alert">
          {error}
        </p>
      ) : null}
      {note ? (
        <p className="ch247-extractor__message" role="status">
          {note}
        </p>
      ) : null}
      {result ? (
        <p className="ch247-extractor__message" role="status">
          {result.found} found · {result.duplicatesRemoved} duplicate{result.duplicatesRemoved === 1 ? '' : 's'} removed
          {result.filteredOut ? ` · ${result.filteredOut} filtered out` : ''}. {result.notes.join(' ')}
        </p>
      ) : null}
    </form>
  );
}
