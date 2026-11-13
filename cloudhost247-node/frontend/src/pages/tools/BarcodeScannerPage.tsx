import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import ToolSeo from '../../components/tools/ToolSeo';
import { toolsApi, type ToolSummary } from '../../lib/tools-api';
import { usePageMeta } from '../../lib/usePageMeta';
import { loadScanEngine, webAssemblyAllowed, type ScanEngine, type ScanEngineKind } from '../../lib/scan-engine';
import { addScan, scanTotal, scansToCsv, scansToText, type ScanRecord, type ScanSource } from '../../lib/scan-session';
import { BASIC_SCAN_FORMATS, SCAN_FORMATS, visibleText, type ScanHit, type ScanPixels } from '../../../../src/tools/scanner/formats';
import './barcode-scanner.css';

/**
 * Barcode Scanner: read barcodes with the device's camera or from a picture, and keep a list.
 *
 * Everything is decoded in this browser. The camera picture is drawn to a canvas that never leaves
 * the page and a chosen image is read from the file directly, so nothing is uploaded; the page makes
 * no request at all once it has loaded (the tool catalogue, for the page's name and status, aside).
 *
 * The decoder is about a megabyte, so it is fetched when the visitor first asks to scan and not with
 * the page. There are two (`scan-engine.ts` picks): the full one needs WebAssembly, and a browser
 * that will not run it gets a smaller one that reads fewer types. The page then says which types
 * are not read in that browser, so the list it shows is the list it can read.
 *
 * What a barcode holds is shown as text and nothing more is done with it: the page never opens an
 * address, dials a number or joins a network that it reads from a code.
 */

const SLUG = 'barcode-scanner';
const INTRO = 'Point your camera at a barcode or QR code, or choose a picture of one. Each code you scan is added to a list you can copy or download.';

/** Camera frames are searched at this size at most: enough for a barcode held to the camera, and quick. */
const FRAME_SIDE = 960;
/** A chosen picture is searched at up to this size; the decoder reduces it further where that helps. It also bounds the time a search takes. */
const IMAGE_SIDE = 2000;
const FRAME_INTERVAL_MS = 180;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

type CameraState = 'off' | 'starting' | 'on';

const LOAD_PROBLEM = 'The scanner could not be loaded. Check your connection, then refresh the page and try again.';
/** The decoder was loaded and then failed at its work, which a picture or a camera cannot cause. */
const DECODER_PROBLEM = 'The scanner stopped working. Refresh the page and try again.';

const FULL_ONLY_FORMATS = SCAN_FORMATS.filter((format) => format.fullOnly);

/** Why the camera could not be used, in words that say what to do next. */
function cameraProblem(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The camera is blocked for this page. Allow camera access in your browser’s address bar and try again. If this page is shown inside another page, open it in its own tab. You can also choose a picture instead.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device. Choose a picture of the barcode instead.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The camera is in use by another app or tab. Close it there and try again, or choose a picture instead.';
  return 'The camera could not be started. Choose a picture of the barcode instead.';
}

function scaledSize(width: number, height: number, side: number): { width: number; height: number } {
  const scale = Math.min(1, side / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Let the browser paint and handle input before the next piece of work. */
const breathe = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 0));

/** A picture file as pixels, reduced to a size the decoder can search in reasonable time. */
async function pixelsOfFile(file: File): Promise<ScanPixels> {
  let source: ImageBitmap | HTMLImageElement;
  if (typeof createImageBitmap === 'function') {
    source = await createImageBitmap(file);
  } else {
    // Older browsers: read the file as a data URL, which the page's image policy allows.
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('The file could not be read.'));
      reader.readAsDataURL(file);
    });
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('The file is not a picture this browser can open.'));
      image.src = url;
    });
  }
  const size = scaledSize(source.width, source.height, IMAGE_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser cannot read the picture.');
  // White underneath, so a transparent picture is a barcode on paper and not on black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(source, 0, 0, size.width, size.height);
  if ('close' in source) source.close();
  const data = context.getImageData(0, 0, size.width, size.height);
  return { data: data.data, width: data.width, height: data.height };
}

function download(name: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default function BarcodeScannerPage() {
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [camera, setCamera] = useState<CameraState>('off');
  const [busyImage, setBusyImage] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sound, setSound] = useState(true);
  const [flash, setFlash] = useState(0);
  // Which decoder this browser has: unknown until one is fetched, unless WebAssembly is ruled out already.
  const [engineKind, setEngineKind] = useState<ScanEngineKind | null>(null);

  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const frame = useRef<HTMLCanvasElement | null>(null);
  const timer = useRef<number | null>(null);
  const sideways = useRef(false);
  const audio = useRef<AudioContext | null>(null);
  const recordsRef = useRef<ScanRecord[]>([]);
  const soundRef = useRef(true);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const tool = useMemo(() => tools.find((entry) => entry.slug === SLUG) ?? null, [tools]);
  const name = tool?.name ?? 'Barcode Scanner';
  const unavailable = tool !== null && tool.status !== 'ACTIVE';
  usePageMeta(name, tool?.summary ?? INTRO);

  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  // A browser that will not run WebAssembly is known before anything is fetched, so the list of
  // types is right from the start and not only after a first scan.
  useEffect(() => {
    if (!webAssemblyAllowed()) setEngineKind('basic');
  }, []);

  useEffect(() => {
    let cancelled = false;
    toolsApi
      .catalog()
      .then((catalog) => {
        if (!cancelled) setTools(catalog.tools);
      })
      .catch(() => {
        /* The scanner needs nothing from the server; without the catalogue it keeps its built-in name. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const confirm = useCallback(() => {
    setFlash((value) => value + 1);
    navigator.vibrate?.(60);
    if (!soundRef.current || !audio.current) return;
    try {
      const context = audio.current;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 1320;
      gain.gain.setValueAtTime(0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.12);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.13);
    } catch {
      /* A beep is a courtesy; a browser that will not play one changes nothing else. */
    }
  }, []);

  const accept = useCallback(
    (hit: ScanHit, source: ScanSource) => {
      const outcome = addScan(recordsRef.current, hit, Date.now(), source);
      recordsRef.current = outcome.records;
      if (outcome.change === 'same') return;
      setRecords(outcome.records);
      setProblem(null);
      setMessage(outcome.change === 'new' ? `Scanned: ${outcome.record.formatName}.` : `Scanned again: ${outcome.record.formatName}, now ${outcome.record.count} times.`);
      confirm();
    },
    [confirm]
  );

  const stopCamera = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setCamera('off');
  }, []);

  // The camera is released when the page is left, and when the tab goes into the background.
  useEffect(() => {
    const onHidden = (): void => {
      if (document.hidden && stream.current) {
        stopCamera();
        setMessage('The camera was stopped because this tab is in the background.');
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      if (timer.current !== null) window.clearTimeout(timer.current);
      for (const track of stream.current?.getTracks() ?? []) track.stop();
      stream.current = null;
      void audio.current?.close().catch(() => undefined);
    };
  }, [stopCamera]);

  async function startCamera(): Promise<void> {
    setProblem(null);
    setMessage(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setProblem('This browser does not give this page a camera: that needs a secure (https) address and a browser with camera support. Choose a picture of the barcode instead.');
      return;
    }
    setCamera('starting');
    // Created on this click, because browsers only let a page make sound after the visitor has acted.
    try {
      audio.current ??= new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      void audio.current.resume().catch(() => undefined);
    } catch {
      audio.current = null;
    }
    // Held here from the moment the browser grants it, so that every way out of this function that
    // is not a running scanner switches it off again.
    let media: MediaStream | null = null;
    let decoderFailed = false;
    try {
      // Both are waited for to the end, whichever fails. A camera granted after the decoder has
      // failed to load still has to be received here, or it would stay on with nothing to stop it.
      const [loaded, granted] = await Promise.allSettled([
        loadScanEngine(),
        navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }),
      ]);
      if (granted.status === 'rejected') throw granted.reason;
      media = granted.value;
      if (loaded.status === 'rejected') {
        decoderFailed = true;
        throw loaded.reason;
      }
      const engine: ScanEngine = loaded.value;
      setEngineKind(engine.kind);
      // A tab that went into the background while the camera was starting gets none: nobody is
      // looking at it, and the event that stops a camera in a background tab has already passed.
      if (document.hidden) {
        for (const track of media.getTracks()) track.stop();
        setCamera('off');
        setMessage('The camera was not started because this tab is in the background. Press Start camera when you are back.');
        return;
      }
      stream.current = media;
      const element = video.current;
      if (!element) throw new Error('The video element is missing.');
      element.srcObject = media;
      await element.play().catch(() => undefined);
      setCamera('on');
      setMessage('Camera on. Hold a barcode steady in the picture.');

      const running = media;
      const tick = async (): Promise<void> => {
        timer.current = null;
        // Reading a frame takes time, and the camera can be stopped, or stopped and started again,
        // while it is being read. A frame belongs to the camera it came from and to no other.
        if (stream.current !== running) return;
        const source = video.current;
        if (source && source.readyState >= 2 && source.videoWidth > 0) {
          const size = scaledSize(source.videoWidth, source.videoHeight, FRAME_SIDE);
          const canvas = (frame.current ??= document.createElement('canvas'));
          if (canvas.width !== size.width || canvas.height !== size.height) {
            canvas.width = size.width;
            canvas.height = size.height;
          }
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (context) {
            context.drawImage(source, 0, 0, size.width, size.height);
            const data = context.getImageData(0, 0, size.width, size.height);
            let hit: ScanHit | null;
            try {
              // Alternate frames are searched on their side, so a barcode held upright is found too.
              hit = await engine.frame({ data: data.data, width: data.width, height: data.height }, sideways.current);
            } catch {
              // A camera left on with nothing reading it would look as if it were scanning.
              if (stream.current === running) {
                stopCamera();
                setMessage(null);
                setProblem(DECODER_PROBLEM);
              }
              return;
            }
            sideways.current = !sideways.current;
            if (stream.current !== running) return;
            if (hit) accept(hit, 'camera');
          }
        }
        timer.current = window.setTimeout(() => void tick(), FRAME_INTERVAL_MS);
      };
      timer.current = window.setTimeout(() => void tick(), FRAME_INTERVAL_MS);
    } catch (error) {
      for (const track of media?.getTracks() ?? []) track.stop();
      stream.current = null;
      if (video.current) video.current.srcObject = null;
      setCamera('off');
      setProblem(decoderFailed ? LOAD_PROBLEM : cameraProblem(error));
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    // Cleared so that choosing the same picture again is a new event.
    event.target.value = '';
    if (!file) return;
    setProblem(null);
    if (file.size > MAX_IMAGE_BYTES) {
      setProblem('That picture is larger than 25 MB. Choose a smaller one, or crop it to the barcode.');
      return;
    }
    setBusyImage(true);
    setMessage('Looking for a barcode in the picture…');
    let engine: ScanEngine;
    try {
      engine = await loadScanEngine();
      setEngineKind(engine.kind);
    } catch {
      // The picture is not at fault here, so the message must not say that it is.
      setMessage(null);
      setProblem(LOAD_PROBLEM);
      setBusyImage(false);
      return;
    }
    let pixels: ScanPixels;
    try {
      pixels = await pixelsOfFile(file);
    } catch {
      setMessage(null);
      setProblem('That file could not be opened as a picture. Choose a PNG, JPEG or WebP image.');
      setBusyImage(false);
      return;
    }
    try {
      // The screen is free to update before the search and between its passes: a picture that
      // holds no barcode is searched to the end, which can take a second or two.
      await breathe();
      const hit = await engine.still(pixels, breathe);
      if (hit) {
        accept(hit, 'image');
      } else {
        setMessage(null);
        setProblem('No barcode was read from that picture. Try a sharper, closer shot with the whole code and the clear space around it in view, in even light. See below for the barcode types this scanner reads.');
      }
    } catch {
      // The picture opened; it is the decoder that failed.
      setMessage(null);
      setProblem(DECODER_PROBLEM);
    } finally {
      setBusyImage(false);
    }
  }

  async function copy(text: string, what: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`${what} copied.`);
      setProblem(null);
    } catch {
      setProblem('This browser did not allow copying. Select the text and copy it by hand, or download the CSV file.');
    }
  }

  function clear(): void {
    recordsRef.current = [];
    setRecords([]);
    setMessage('The list is empty.');
    setProblem(null);
  }

  const total = scanTotal(records);
  const related = tool ? tools.filter((entry) => entry.status === 'ACTIVE' && tool.relatedTools?.includes(entry.slug)) : [];

  return (
    <div className="tools-center scanner">
      <ToolSeo title={tool?.seoTitle ?? `${name} | CloudHost247`} description={tool?.summary ?? INTRO} path={`/tools/${SLUG}`} />

      <nav className="tools-breadcrumb" aria-label="Breadcrumb">
        <Link to="/tools">Tools Center</Link>
        <Link to="/tools/category/utilities">Utilities</Link>
        <span aria-current="page">{name}</span>
      </nav>

      <header className="scanner-head">
        <p className="tools-eyebrow">BARCODES, LABELS AND CARDS</p>
        <h1>{name}</h1>
        <p className="scanner-head__intro">{INTRO}</p>
      </header>

      {unavailable ? (
        <div className="tools-notice tools-notice--warning" role="status">
          {tool?.statusMessage ?? 'This tool is not available at the moment.'}
        </div>
      ) : null}

      <div className="scanner-grid">
        <section className="scanner-panel" aria-labelledby="scanner-scan">
          <h2 id="scanner-scan">Scan</h2>

          <div className={`scanner-view${camera === 'on' ? ' is-on' : ''}`}>
            {/* Muted and inline, so a phone plays it in the page instead of full screen. */}
            <video ref={video} muted playsInline aria-label="Camera picture" />
            {/* A new key each scan restarts the animation that confirms it. */}
            {flash > 0 && camera === 'on' ? <span key={flash} className="scanner-view__flash" aria-hidden="true" /> : null}
            {camera !== 'on' ? (
              <p className="scanner-view__idle">{camera === 'starting' ? 'Starting the camera…' : 'The camera picture appears here.'}</p>
            ) : (
              <span className="scanner-view__guide" aria-hidden="true" />
            )}
          </div>

          <div className="scanner-actions">
            {camera === 'on' ? (
              <button type="button" className="ch247-button" onClick={stopCamera}>
                Stop camera
              </button>
            ) : (
              <button type="button" className="ch247-button" onClick={() => void startCamera()} disabled={camera === 'starting' || unavailable}>
                {camera === 'starting' ? 'Starting…' : 'Start camera'}
              </button>
            )}
            <button type="button" className="ch247-button ch247-button--ghost" onClick={() => fileInput.current?.click()} disabled={busyImage || unavailable}>
              {busyImage ? 'Reading the picture…' : 'Choose a picture'}
            </button>
            {/* On a phone this offers the camera as well as the gallery. */}
            <input ref={fileInput} className="scanner-file" type="file" accept="image/*" aria-label="Picture of a barcode" onChange={(event) => void onFile(event)} tabIndex={-1} />
          </div>

          <label className="scanner-check">
            <input type="checkbox" checked={sound} onChange={(event) => setSound(event.target.checked)} />
            <span>Beep when a barcode is scanned</span>
          </label>

          <div aria-live="polite" className="scanner-status">
            {problem ? (
              <div className="tools-notice tools-notice--error" role="alert">
                {problem}
              </div>
            ) : null}
            {message && !problem ? <p role="status">{message}</p> : null}
          </div>

          <p className="scanner-privacy">Decoded in your browser. The camera picture and your pictures are not uploaded, and nothing a barcode contains is opened or followed.</p>
        </section>

        <section className="scanner-panel" aria-labelledby="scanner-list">
          <div className="scanner-list__head">
            <h2 id="scanner-list">Scanned</h2>
            <p className="scanner-count">
              {records.length === 0 ? 'Nothing yet' : `${records.length} ${records.length === 1 ? 'barcode' : 'barcodes'}${total !== records.length ? `, ${total} scans` : ''}`}
            </p>
          </div>

          {records.length === 0 ? (
            <p className="scanner-empty">Each barcode you scan is listed here with its type and content. A barcode is listed once; showing it again after taking it away adds to its count.</p>
          ) : (
            <>
              <ol className="scanner-records">
                {/* Newest first, so the code just scanned is where the eye already is. */}
                {[...records].reverse().map((record) => (
                  <li key={record.id}>
                    <div className="scanner-record__meta">
                      <span className="scanner-record__number">{record.id}</span>
                      <strong>{record.formatName}</strong>
                      <span>{record.kindLabel}</span>
                      {record.count > 1 ? <span className="scanner-record__times">× {record.count}</span> : null}
                    </div>
                    <code className="scanner-record__text">{visibleText(record.text)}</code>
                    {record.caution ? <small>{record.caution}</small> : null}
                    <button type="button" className="scanner-link" onClick={() => void copy(record.text, 'Content')} aria-label={`Copy the content of barcode ${record.id}`}>
                      Copy
                    </button>
                  </li>
                ))}
              </ol>
              <div className="scanner-actions">
                <button type="button" className="ch247-button" onClick={() => download('scanned-barcodes.csv', 'text/csv;charset=utf-8', scansToCsv(records))}>
                  Download CSV
                </button>
                <button type="button" className="ch247-button ch247-button--ghost" onClick={() => void copy(scansToText(records), 'The list')}>
                  Copy all
                </button>
                <button type="button" className="ch247-button ch247-button--ghost" onClick={clear}>
                  Clear list
                </button>
              </div>
              <small className="scanner-csv-note">
                The CSV file opens in a spreadsheet. A value that begins with =, +, - or @ is written with a leading apostrophe, so the spreadsheet shows it as text instead of running it as a formula. “Copy all” copies the contents exactly as scanned, one barcode per line.
              </small>
            </>
          )}
        </section>
      </div>

      <section className="tools-notes" aria-labelledby="scanner-reads">
        <h2 id="scanner-reads">What it reads</h2>
        {engineKind === 'basic' ? (
          <p className="scanner-basic" role="status">
            This browser did not start the scanner’s full decoder, which needs WebAssembly, so a smaller one is in use. It reads the first {BASIC_SCAN_FORMATS.length} types below and not the {FULL_ONLY_FORMATS.length} marked “not in this browser”.
          </p>
        ) : null}
        <ul className="scanner-formats">
          {SCAN_FORMATS.map((format) => {
            const missing = engineKind === 'basic' && format.fullOnly === true;
            return (
              <li key={format.id} className={missing ? 'is-missing' : undefined}>
                <strong>{format.name}</strong>
                {missing ? <em> not in this browser</em> : format.covers ? <span> {format.covers}</span> : null}
              </li>
            );
          })}
        </ul>
        {tool && tool.notes.length > 0 ? (
          <ul>
            {tool.notes.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        ) : (
          <p>Postal barcodes, Code 11, MSI, Pharmacode, DotCode, Han Xin and Codablock F are not read.</p>
        )}
      </section>

      {related.length > 0 ? (
        <section aria-labelledby="scanner-related">
          <h2 id="scanner-related">Related tools</h2>
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
