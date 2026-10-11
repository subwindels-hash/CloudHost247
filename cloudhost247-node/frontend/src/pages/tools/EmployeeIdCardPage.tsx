/**
 * Employee ID Card Generator — the badge maker workspace.
 *
 * Why this tool has its own page instead of the generic Business Tool workspace: a badge maker is a
 * *design* tool. It needs a live card preview that redraws as you type, image uploads with real
 * previews, a template gallery, colour pickers, two-sided output and a 400-row bulk import. The
 * generic workspace renders a schema-driven form and a result table, which is exactly right for the
 * other twenty tools and wrong for this one.
 *
 * Everything runs in the browser. The card is laid out by the shared engine in
 * `src/tools/business/id-card/`, drawn into a canvas (the preview and every download are the same
 * canvas, so what you see is what you get), and exported as PNG, JPG or PDF. Employee details and
 * uploaded images are kept in this browser's local storage only, and there is one button that
 * erases them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import { readImageFile } from '../../lib/id-card/read-image';
import { canvasToBlob, blobToBytes, drawFace, imageHrefs, loadImages } from '../../lib/id-card/canvas';
import {
  BULK_COLUMNS,
  BULK_MAX_ROWS,
  BLOOD_GROUPS,
  CARD_PRESETS,
  CARD_TEMPLATES,
  CARD_MM,
  batchManifestCsv,
  buildCardsPdf,
  buildCardsPdfPair,
  buildSpec,
  buildCardLayout,
  buildZip,
  cardPixelSize,
  chunkRows,
  csvTemplate,
  defaultFormState,
  faceToSvg,
  paletteFor,
  parseWorkbookFile,
  rejectedRowsCsv,
  summariseReport,
  validateRows,
  type BulkReport,
  type CardFormState,
  type CardTemplateId,
} from '../../../../src/tools/business/id-card';
import './employee-id-card.css';

const FORM_KEY = 'ch247.employeeIdCard.form.v1';
const IMAGES_KEY = 'ch247.employeeIdCard.images.v1';
/** Local storage is small (about 5 MB per origin) — images are only kept while they fit comfortably. */
const IMAGE_BUDGET_BYTES = 1_500_000;

type Message = { kind: 'ok' | 'error' | 'info'; text: string };

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick so Safari has started the download before the URL disappears.
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function loadStoredState(): CardFormState {
  const base = defaultFormState();
  try {
    const storedForm = window.localStorage.getItem(FORM_KEY);
    const storedImages = window.localStorage.getItem(IMAGES_KEY);
    const parsed = storedForm ? (JSON.parse(storedForm) as Partial<CardFormState>) : {};
    const images = storedImages ? (JSON.parse(storedImages) as Partial<CardFormState>) : {};
    return { ...base, ...parsed, ...images };
  } catch {
    // A corrupt or unavailable store must never stop the tool working.
    return base;
  }
}

export default function EmployeeIdCardPage() {
  usePageMeta(
    'Employee ID Card Generator — free printable staff badge maker | CloudHost247',
    'Design a print-ready employee ID card in your browser: 12 templates, colour presets, live front and back preview, scannable QR and Code 128 barcode, PNG, JPG and PDF downloads, and bulk import from CSV or Excel. Employee details never leave your browser.',
    { canonical: '/tools/business-tools/employee-id-card-generator' }
  );

  const [state, setState] = useState<CardFormState>(() => loadStoredState());
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [renderIssue, setRenderIssue] = useState<string | null>(null);
  const frontRef = useRef<HTMLCanvasElement | null>(null);
  const backRef = useRef<HTMLCanvasElement | null>(null);

  // Strict: a card that would be invalid on the day it is printed, or that advertises a barcode
  // it does not carry, is refused here rather than downloaded.
  const built = useMemo(() => buildSpec(state, { strict: true }), [state]);
  const layout = useMemo(() => buildCardLayout(built.spec), [built.spec]);
  const size = cardPixelSize(state.orientation === 'portrait' ? 'portrait' : 'landscape');

  const set = useCallback(<K extends keyof CardFormState>(key: K, value: CardFormState[K]): void => {
    setState((current) => ({ ...current, [key]: value }));
  }, []);

  /* ---------- persist locally (privacy-first: this browser only) ---------- */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const { photo: _photo, logo: _logo, signature: _signature, ...formOnly } = state;
        window.localStorage.setItem(FORM_KEY, JSON.stringify(formOnly));
        const images = { photo: state.photo, logo: state.logo, signature: state.signature };
        const imageBytes = (state.photo.length + state.logo.length + state.signature.length) * 0.75;
        if (imageBytes > 0 && imageBytes < IMAGE_BUDGET_BYTES) {
          window.localStorage.setItem(IMAGES_KEY, JSON.stringify(images));
        } else if (imageBytes === 0) {
          window.localStorage.removeItem(IMAGES_KEY);
        }
      } catch {
        /* storage full or blocked — the tool still works in memory */
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [state]);

  /* ---------- live preview: the export canvas, scaled down by CSS ---------- */
  useEffect(() => {
    let cancelled = false;
    const render = async (): Promise<void> => {
      const hrefs = imageHrefs([layout.front, layout.back]);
      const { sources, failed } = await loadImages(hrefs);
      if (cancelled) return;
      const problems: string[] = [];
      if (failed.length > 0) problems.push('An uploaded image could not be decoded, so its placeholder is shown instead.');
      for (const face of [layout.front, layout.back]) {
        const canvas = face.side === 'front' ? frontRef.current : backRef.current;
        if (!canvas) continue;
        canvas.width = face.width;
        canvas.height = face.height;
        const context = canvas.getContext('2d');
        if (!context) {
          problems.push('This browser refused a 2D drawing context, so the preview cannot be drawn.');
          continue;
        }
        const warnings = drawFace(context, face, sources, { background: '#FFFFFF' });
        for (const warning of warnings) if (!problems.includes(warning)) problems.push(warning);
      }
      setRenderIssue(problems[0] ?? null);
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [layout]);

  /* ---------- exports ---------- */
  const slug = `${built.spec.employee.employeeId || built.spec.employee.fullName || 'employee'}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'employee';

  const exportImage = useCallback(
    async (face: 'front' | 'back' | 'both', format: 'png' | 'jpeg'): Promise<void> => {
      setBusy(`Preparing the ${format === 'png' ? 'PNG' : 'JPG'}…`);
      setMessage(null);
      try {
        const targets: Array<{ ref: React.RefObject<HTMLCanvasElement | null>; name: string }> =
          face === 'both'
            ? [
                { ref: frontRef, name: 'front' },
                { ref: backRef, name: 'back' },
              ]
            : [{ ref: face === 'front' ? frontRef : backRef, name: face }];
        for (const target of targets) {
          const canvas = target.ref.current;
          if (!canvas || canvas.width === 0) throw new Error('The preview is not ready yet. Wait a moment and try again.');
          const blob = await canvasToBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg', format === 'jpeg' ? 0.95 : undefined);
          download(blob, `id-card-${slug}-${target.name}.${format === 'png' ? 'png' : 'jpg'}`);
        }
        setMessage({
          kind: 'ok',
          text:
            format === 'png'
              ? `${face === 'both' ? 'Both sides' : `The ${face}`} saved as PNG at ${size.width} × ${size.height} px (300 dpi).`
              : `${face === 'both' ? 'Both sides' : `The ${face}`} saved as JPG at ${size.width} × ${size.height} px, quality 95 %.`,
        });
      } catch (error) {
        setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'The image could not be saved.' });
      } finally {
        setBusy(null);
      }
    },
    [size.height, size.width, slug]
  );

  const exportPdf = useCallback(
    async (arrangement: 'pages' | 'sheet'): Promise<void> => {
      setBusy('Building the print-ready PDF…');
      setMessage(null);
      try {
        const front = frontRef.current;
        const back = backRef.current;
        if (!front || !back || front.width === 0) throw new Error('The preview is not ready yet. Wait a moment and try again.');
        const toJpeg = async (canvas: HTMLCanvasElement) => ({
          data: await blobToBytes(await canvasToBlob(canvas, 'image/jpeg', 0.95)),
          width: canvas.width,
          height: canvas.height,
        });
        const frontImage = await toJpeg(front);
        const backImage = await toJpeg(back);
        const info = {
          title: `${built.spec.employee.fullName || 'Employee'} — employee ID card`,
          subject: `${built.spec.company.name || 'Company'} staff badge, ${state.orientation} ID-1 card at 300 dpi`,
          creator: 'CloudHost247 Employee ID Card Generator',
        };
        const bytes =
          arrangement === 'sheet'
            ? buildCardsPdfPair(frontImage, backImage, info)
            : buildCardsPdf(
                [
                  { image: frontImage, label: 'front' },
                  { image: backImage, label: 'back' },
                ],
                info
              );
        const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
        download(blob, `id-card-${slug}-${arrangement === 'sheet' ? 'print-sheet' : 'front-back'}.pdf`);
        setMessage({
          kind: 'ok',
          text:
            arrangement === 'sheet'
              ? `Saved a one-page print sheet with both sides stacked (${CARD_MM.width} × ${(CARD_MM.height * 2 + 6.35).toFixed(2)} mm) — print at 100 % and cut.`
              : `Saved a two-page PDF, one side per page, each exactly ${CARD_MM.width} × ${CARD_MM.height} mm.`,
        });
      } catch (error) {
        setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'The PDF could not be built.' });
      } finally {
        setBusy(null);
      }
    },
    [built.spec.company.name, built.spec.employee.fullName, slug, state.orientation]
  );

  const downloadSvg = useCallback((): void => {
    const blob = new Blob([faceToSvg(layout.front, { title: 'Employee ID card — front' })], { type: 'image/svg+xml' });
    download(blob, `id-card-${slug}-front.svg`);
    setMessage({ kind: 'ok', text: 'Front saved as SVG — a vector copy for a designer or a print bureau.' });
  }, [layout.front, slug]);

  /* ---------- uploads ---------- */
  const onUpload = useCallback(
    async (kind: 'photo' | 'logo' | 'signature', file: File | undefined): Promise<void> => {
      if (!file) return;
      setMessage(null);
      const result = await readImageFile(kind === 'logo' ? 'logo' : kind === 'signature' ? 'signature' : 'photo', file);
      if (!result.ok) {
        setMessage({ kind: 'error', text: result.message });
        return;
      }
      set(kind, result.dataUrl);
      setMessage({ kind: 'ok', text: `${file.name} added (${result.width} × ${result.height} px).${result.warning ? ` ${result.warning}` : ''}` });
    },
    [set]
  );

  const reset = useCallback((): void => {
    setState(defaultFormState());
    setMessage({ kind: 'info', text: 'Form, colours, template and uploaded images reset to the defaults. Nothing was saved to a server.' });
  }, []);

  const clearStored = useCallback((): void => {
    try {
      window.localStorage.removeItem(FORM_KEY);
      window.localStorage.removeItem(IMAGES_KEY);
    } catch {
      /* ignore */
    }
    setState(defaultFormState());
    setMessage({ kind: 'ok', text: 'Everything this browser stored for the badge maker has been erased, including uploaded images.' });
  }, []);

  /* ---------- bulk import ---------- */
  const [bulkFileName, setBulkFileName] = useState<string | null>(null);
  const [report, setReport] = useState<BulkReport | null>(null);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  const [photoFailures, setPhotoFailures] = useState<string[]>([]);

  const importRows = useCallback(
    async (file: File | undefined): Promise<void> => {
      if (!file) return;
      setMessage(null);
      setReport(null);
      setPhotoFailures([]);
      setBulkFileName(file.name);
      try {
        const rows = await parseWorkbookFile(file);
        const result = validateRows(rows, { base: state });
        if (result.accepted.length > BULK_MAX_ROWS) {
          result.warnings.push(
            `This file has ${result.accepted.length} valid rows. Up to ${BULK_MAX_ROWS} can be generated in one pass; the rest are kept in the report so you can generate them next.`
          );
        }
        setReport(result);
        const message =
          result.accepted.length === 0
            ? summariseReport(result)
            : `${summariseReport(result)} Nothing has been generated yet — check the preview and press Generate cards.`;
        setMessage({ kind: result.accepted.length === 0 ? 'error' : 'ok', text: message });
      } catch (error) {
        setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'That file could not be read.' });
      }
    },
    [state]
  );

  const fetchPhoto = useCallback(async (url: string): Promise<string | null> => {
    try {
      const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!response.ok) return null;
      const blob = await response.blob();
      if (!/^image\/(png|jpeg|webp)$/.test(blob.type)) return null;
      if (blob.size > 6 * 1024 * 1024) return null;
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }, []);

  const generateBatch = useCallback(async (): Promise<void> => {
    if (!report) return;
    const accepted = chunkRows(report)[0] ?? [];
    if (accepted.length === 0) {
      setMessage({ kind: 'error', text: 'There are no valid rows to generate.' });
      return;
    }
    setBusy(`Generating ${accepted.length} badge${accepted.length === 1 ? '' : 's'}…`);
    setPhotoFailures([]);
    try {
      const entries: Array<{ name: string; data: Uint8Array }> = [];
      const generated: Array<{ rowNumber: number; file: string }> = [];
      const photoProblems: string[] = [];
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser refused a 2D drawing context, so cards cannot be rendered.');

      for (const entry of accepted) {
        let photo = entry.spec.spec.images.photo ?? '';
        if (entry.photoUrl !== '') {
          const fetched = await fetchPhoto(entry.photoUrl);
          if (!fetched) {
            photoProblems.push(
              `Row ${entry.rowNumber}: the photograph at ${entry.photoUrl} could not be loaded from this page. The usual reason is that the image host does not allow cross-site use, or the URL is not a PNG/JPEG/WebP image. That employee's card was generated without a photograph.`
            );
          } else {
            photo = fetched;
          }
        }
        const spec = { ...entry.spec.spec, images: { ...entry.spec.spec.images, photo } };
        const cardLayout = buildCardLayout(spec);
        const hrefs = imageHrefs([cardLayout.front, cardLayout.back]);
        const { sources } = await loadImages(hrefs);
        const id = (spec.employee.employeeId || `row-${entry.rowNumber}`).toLowerCase().replace(/[^a-z0-9]+/g, '-');
        for (const face of [cardLayout.front, cardLayout.back]) {
          canvas.width = face.width;
          canvas.height = face.height;
          drawFace(context, face, sources, { background: '#FFFFFF' });
          const blob = await canvasToBlob(canvas, 'image/png');
          entries.push({ name: `cards/${id}-${face.side}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
        }
        generated.push({ rowNumber: entry.rowNumber, file: `cards/${id}-front.png` });
      }

      const manifest = batchManifestCsv(report, generated);
      entries.push({ name: 'batch-manifest.csv', data: new TextEncoder().encode(manifest) });
      if (report.rejected.length > 0) {
        entries.push({ name: 'rejected-rows.csv', data: new TextEncoder().encode(rejectedRowsCsv(report)) });
      }
      const zip = buildZip(entries);
      download(new Blob([zip as unknown as BlobPart], { type: 'application/zip' }), `employee-id-cards-${new Date().toISOString().slice(0, 10)}.zip`);
      setPhotoFailures(photoProblems);
      setMessage({
        kind: 'ok',
        text: `ZIP saved with ${accepted.length ? accepted.length * 2 : 0} PNG files (front and back for each employee), the batch manifest${report.rejected.length > 0 ? ' and the rejected-rows report' : ''}.${report.accepted.length > accepted.length ? ` ${report.accepted.length - accepted.length} further valid rows are still in the report — import the file again and generate them next.` : ''}`,
      });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'The batch could not be generated.' });
    } finally {
      setBusy(null);
    }
  }, [fetchPhoto, report]);

  const downloadTemplate = useCallback((): void => {
    download(new Blob([csvTemplate()], { type: 'text/csv;charset=utf-8' }), 'cloudhost247-employee-id-cards-template.csv');
    setMessage({ kind: 'ok', text: 'CSV template downloaded — three example rows are labelled and can be deleted.' });
  }, []);

  /* ---------- render ---------- */
  const palette = paletteFor(state);

  return (
    <div className="idc">
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
                <Link to="/tools/business-tools">Business Tools</Link>
              </li>
              <li aria-current="page">Employee ID Card Generator</li>
            </ol>
          </nav>
          <h1>Employee ID Card Generator</h1>
          <p>
            Design a print-ready staff badge: {CARD_TEMPLATES.length} templates, your own colours, a live front and back
            preview, and scannable QR and Code 128 codes. Download the card as PNG, JPG or a print-ready PDF.
          </p>
          <p className="ch247-page__hint">
            Your card details and uploaded images are stored locally in this browser. Nothing is uploaded to CloudHost247
            — you can erase everything again with one button at the bottom of the page.
          </p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="idc__grid">
          {/* ---------------- controls ---------------- */}
          <div className="idc__controls">
            {message ? (
              <p className={`idc__message idc__message--${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
                {message.text}
              </p>
            ) : null}

            <fieldset className="idc__panel">
              <legend>Employee details</legend>
              <div className="idc__fields">
                <Field label="Full name" required value={state.fullName} onChange={(value) => set('fullName', value)} maxLength={60} />
                <Field label="Employee ID" required value={state.employeeId} onChange={(value) => set('employeeId', value)} maxLength={32} />
                <Field label="Job title" value={state.jobTitle} onChange={(value) => set('jobTitle', value)} maxLength={60} />
                <Field label="Department" value={state.department} onChange={(value) => set('department', value)} maxLength={60} />
                <Field label="Email address" type="email" value={state.email} onChange={(value) => set('email', value)} />
                <Field label="Phone number" value={state.phone} onChange={(value) => set('phone', value)} />
                <label className="idc__field">
                  <span>Blood group (optional)</span>
                  <select value={state.bloodGroup} onChange={(event) => set('bloodGroup', event.target.value)}>
                    <option value="">Not printed</option>
                    {BLOOD_GROUPS.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                </label>
                <Field label="Date of joining" type="date" value={state.dateOfJoining} onChange={(value) => set('dateOfJoining', value)} />
                <Field label="Emergency contact" value={state.emergencyContact} onChange={(value) => set('emergencyContact', value)} maxLength={120} />
                <Field label="Card valid from" type="date" value={state.validFrom} onChange={(value) => set('validFrom', value)} />
                <Field label="Card valid until" type="date" value={state.validUntil} onChange={(value) => set('validUntil', value)} />
              </div>
            </fieldset>

            <fieldset className="idc__panel">
              <legend>Company</legend>
              <div className="idc__fields">
                <Field label="Company name" required value={state.companyName} onChange={(value) => set('companyName', value)} maxLength={60} />
                <Field label="Company address" value={state.companyAddress} onChange={(value) => set('companyAddress', value)} maxLength={160} />
                <Field label="Website" value={state.companyWebsite} onChange={(value) => set('companyWebsite', value)} />
              </div>
            </fieldset>

            <fieldset className="idc__panel">
              <legend>Photograph, logo and signature</legend>
              <Upload
                label="Employee photograph"
                hint="PNG, JPEG or WebP, at least 240 × 240 px, up to 6 MB."
                value={state.photo}
                onPick={(file) => void onUpload('photo', file)}
                onRemove={() => set('photo', '')}
              />
              <Upload
                label="Company logo"
                hint="PNG or JPEG with a transparent or white background works best."
                value={state.logo}
                onPick={(file) => void onUpload('logo', file)}
                onRemove={() => set('logo', '')}
              />
              <Upload
                label="Employee signature"
                hint="A photograph or scan of the signature on a plain background."
                value={state.signature}
                onPick={(file) => void onUpload('signature', file)}
                onRemove={() => set('signature', '')}
              />
              <div className="idc__toggles">
                <Toggle label="Show the photograph" checked={state.showPhoto} onChange={(value) => set('showPhoto', value)} />
                <Toggle label="Show the logo" checked={state.showLogo} onChange={(value) => set('showLogo', value)} />
                <Toggle label="Show the signature" checked={state.showSignature} onChange={(value) => set('showSignature', value)} />
              </div>
            </fieldset>

            <fieldset className="idc__panel">
              <legend>QR code</legend>
              <Toggle label="Print a QR code on the card" checked={state.showQr} onChange={(value) => set('showQr', value)} />
              <label className="idc__field">
                <span>QR content (optional)</span>
                <input
                  type="text"
                  value={state.qrContent}
                  placeholder="https://verify.example.com/employee/EMP00123"
                  onChange={(event) => set('qrContent', event.target.value)}
                  maxLength={512}
                />
              </label>
              <p className="ch247-page__hint">
                Leave this blank and the code carries text describing the badge (identifier, name, company). Enter an
                https:// address and the code points at it. Either way the QR is a real, scannable symbol — but it is not
                an employment verification service: nothing is looked up when it is scanned, and the card itself proves
                nothing about the holder.
              </p>
            </fieldset>

            <fieldset className="idc__panel">
              <legend>Code 128 barcode</legend>
              <Toggle label="Print a Code 128 barcode" checked={state.showBarcode} onChange={(value) => set('showBarcode', value)} />
              <label className="idc__field">
                <span>Barcode value</span>
                <input
                  type="text"
                  value={state.barcodeValue}
                  placeholder={state.employeeId || 'Defaults to the employee ID'}
                  onChange={(event) => set('barcodeValue', event.target.value)}
                  maxLength={48}
                />
              </label>
              <p className="ch247-page__hint">
                Digits, letters and keyboard punctuation only. A barcode is printed only when each bar stays at least
                0.19 mm wide at 300 dpi; otherwise the tool says so instead of printing one that will not scan.
              </p>
            </fieldset>
          </div>

          {/* ---------------- preview and design ---------------- */}
          <div className="idc__preview">
            <div className="idc__panel idc__panel--flush">
              <div className="idc__preview-head">
                <h2>Live preview</h2>
                <div className="idc__segmented" role="group" aria-label="Card side">
                  <button type="button" aria-pressed={side === 'front'} onClick={() => setSide('front')}>
                    Front
                  </button>
                  <button type="button" aria-pressed={side === 'back'} onClick={() => setSide('back')}>
                    Back
                  </button>
                </div>
              </div>
              <div className={`idc__canvas-wrap${side === 'front' ? '' : ' idc__canvas-wrap--hidden'}`}>
                <canvas ref={frontRef} className="idc__canvas" aria-label="Front of the employee ID card" role="img" />
              </div>
              <div className={`idc__canvas-wrap${side === 'back' ? '' : ' idc__canvas-wrap--hidden'}`}>
                <canvas ref={backRef} className="idc__canvas" aria-label="Back of the employee ID card" role="img" />
              </div>
              <p className="ch247-page__hint" style={{ padding: '0 1rem 0.5rem' }}>
                ISO/IEC 7810 ID-1 at 300 dpi: {size.width} × {size.height} px, {CARD_MM.width} × {CARD_MM.height} mm. The
                preview and every download are the same drawing.
              </p>
              {renderIssue ? (
                <p className="idc__message idc__message--error" role="alert" style={{ margin: '0 1rem 1rem' }}>
                  {renderIssue}
                </p>
              ) : null}

              <div className="idc__readiness">
                {built.errors.length > 0 ? (
                  <div className="idc__issues" role="status">
                    <h3>Still needed before this card can be printed</h3>
                    <ul>
                      {built.errors.map((error, index) => (
                        <li key={`${error.key}-${index}`}>{error.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="idc__ready" role="status">
                    Ready to download. {built.spec.employee.fullName} · {built.spec.employee.employeeId} ·{' '}
                    {built.spec.company.name}
                  </p>
                )}
              </div>

              <div className="idc__downloads">
                <h3>Download</h3>
                <div className="idc__buttons">
                  <button type="button" className="ch247-button" disabled={Boolean(busy) || built.errors.length > 0} onClick={() => void exportImage('front', 'png')}>
                    PNG — front
                  </button>
                  <button type="button" className="ch247-button ch247-button--ghost" disabled={Boolean(busy) || built.errors.length > 0} onClick={() => void exportImage('back', 'png')}>
                    PNG — back
                  </button>
                  <button type="button" className="ch247-button ch247-button--ghost" disabled={Boolean(busy) || built.errors.length > 0} onClick={() => void exportImage('both', 'jpeg')}>
                    JPG — both sides
                  </button>
                  <button type="button" className="ch247-button ch247-button--ghost" disabled={Boolean(busy) || built.errors.length > 0} onClick={() => void exportPdf('pages')}>
                    PDF — one side per page
                  </button>
                  <button type="button" className="ch247-button ch247-button--ghost" disabled={Boolean(busy) || built.errors.length > 0} onClick={() => void exportPdf('sheet')}>
                    PDF — both sides on one sheet
                  </button>
                  <button type="button" className="ch247-button ch247-button--outline" disabled={built.errors.length > 0} onClick={downloadSvg}>
                    SVG — front (vector)
                  </button>
                  <button type="button" className="ch247-button ch247-button--outline" onClick={reset}>
                    Reset form
                  </button>
                </div>
                <p className="ch247-page__hint" aria-live="polite">
                  {busy ?? 'PNG for print and screen, JPG for email or a chat message, PDF for a card printer or a print bureau.'}
                </p>
              </div>

              {built.warnings.length > 0 || layout.warnings.length > 0 ? (
                <div className="idc__issues idc__issues--advisory">
                  <h3>Worth checking</h3>
                  <ul>
                    {[...built.warnings, ...layout.warnings].map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <fieldset className="idc__panel">
              <legend>Template</legend>
              <div className="idc__templates">
                {CARD_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className={`idc__template${state.template === template.id ? ' idc__template--active' : ''}`}
                    aria-pressed={state.template === template.id}
                    onClick={() => set('template', template.id as CardTemplateId)}
                  >
                    <span className="idc__template-name">{template.name}</span>
                    <span className="idc__template-blurb">{template.blurb}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="idc__panel">
              <legend>Colours</legend>
              <div className="idc__presets">
                {CARD_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`idc__preset${state.preset === preset.id ? ' idc__preset--active' : ''}`}
                    aria-pressed={state.preset === preset.id}
                    onClick={() =>
                      setState((current) => ({
                        ...current,
                        preset: preset.id,
                        primary: preset.accent,
                        detail: preset.detail,
                      }))
                    }
                  >
                    <span className="idc__swatch" style={{ background: preset.accent }} aria-hidden="true" />
                    {preset.name}
                  </button>
                ))}
              </div>
              <div className="idc__colours">
                <Colour
                  label="Primary accent"
                  value={state.primary}
                  onChange={(value) => setState((current) => ({ ...current, preset: 'custom', primary: value }))}
                />
                <Colour
                  label="Card background"
                  value={state.background}
                  onChange={(value) => setState((current) => ({ ...current, preset: 'custom', background: value }))}
                />
                <Colour
                  label="Text colour"
                  value={state.text}
                  onChange={(value) => setState((current) => ({ ...current, preset: 'custom', text: value }))}
                />
                <Colour
                  label="Detail accent"
                  value={state.detail}
                  onChange={(value) => setState((current) => ({ ...current, preset: 'custom', detail: value }))}
                />
              </div>
              <p className="ch247-page__hint">
                Active palette: accent {palette.primary}, background {palette.background}, text {palette.text}, detail{' '}
                {palette.detail}. Reset form restores the documented defaults.
              </p>
              <label className="idc__field">
                <span>Card orientation</span>
                <select value={state.orientation} onChange={(event) => set('orientation', event.target.value as CardFormState['orientation'])}>
                  <option value="landscape">Landscape ({CARD_MM.width} × {CARD_MM.height} mm)</option>
                  <option value="portrait">Portrait (the same card, rotated)</option>
                </select>
              </label>
            </fieldset>

            {/* ---------------- bulk ---------------- */}
            <fieldset className="idc__panel">
              <legend>Bulk generation from CSV or Excel</legend>
              <p className="ch247-page__hint">
                Every imported row is held to the same validation as the form. Rows that fail are listed with a reason each
                and are never silently dropped.
              </p>
              <div className="idc__buttons">
                <button type="button" className="ch247-button ch247-button--ghost" onClick={downloadTemplate}>
                  Download the CSV template
                </button>
                <label className="ch247-button ch247-button--outline idc__file-button idc__bulk-button">
                  Choose a CSV or .xlsx file
                  <input
                    type="file"
                    accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(event) => {
                      void importRows(event.target.files?.[0]);
                      event.target.value = '';
                    }}
                  />
                </label>
              </div>
              {bulkFileName ? <p className="ch247-page__hint">File: {bulkFileName}</p> : null}

              {report ? (
                <div className="idc__report">
                  <p role="status">{summariseReport(report)}</p>
                  <p className="ch247-page__hint">
                    Columns: {BULK_COLUMNS.map((column) => `${column.header}${column.required ? ' *' : ''}`).join(', ')}
                  </p>
                  {report.accepted.length > 0 ? (
                    <>
                      <h4>Preview — {report.accepted.length} employee{report.accepted.length === 1 ? '' : 's'}</h4>
                      <div className="idc__table-wrap">
                        <table className="bt247-table">
                          <caption>Imported employees, validated and ready</caption>
                          <thead>
                            <tr>
                              <th scope="col">Row</th>
                              <th scope="col">Employee ID</th>
                              <th scope="col">Name</th>
                              <th scope="col">Department</th>
                              <th scope="col">Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.accepted.slice(0, 50).map((entry) => (
                              <tr key={entry.rowNumber}>
                                <th scope="row">{entry.rowNumber}</th>
                                <td>{entry.spec.spec.employee.employeeId}</td>
                                <td>{entry.spec.spec.employee.fullName}</td>
                                <td>{entry.spec.spec.employee.department || '—'}</td>
                                <td>{entry.warnings.length > 0 ? entry.warnings.join(' ') : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {report.accepted.length > 50 ? <p className="ch247-page__hint">Showing the first 50 rows of {report.accepted.length}.</p> : null}
                    </>
                  ) : null}

                  {report.rejected.length > 0 ? (
                    <>
                      <h4>Rejected rows — {report.rejected.length}</h4>
                      <ul className="idc__rejections">
                        {report.rejected.slice(0, 25).map((entry) => (
                          <li key={entry.rowNumber}>
                            <strong>Row {entry.rowNumber}</strong>
                            <ul>
                              {entry.reasons.map((reason, index) => (
                                <li key={index}>{reason}</li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                      {report.rejected.length > 25 ? <p className="ch247-page__hint">…and {report.rejected.length - 25} more in the report file.</p> : null}
                      <button
                        type="button"
                        className="ch247-button ch247-button--ghost"
                        onClick={() => download(new Blob([rejectedRowsCsv(report)], { type: 'text/csv;charset=utf-8' }), 'rejected-rows.csv')}
                      >
                        Download the rejected rows
                      </button>
                    </>
                  ) : null}

                  <div className="idc__buttons">
                    <button type="button" className="ch247-button" disabled={Boolean(busy) || report.accepted.length === 0} onClick={() => void generateBatch()}>
                      Generate cards and download the ZIP
                    </button>
                  </div>
                  <p className="ch247-page__hint" aria-live="polite">
                    {bulkProgress ??
                      'The ZIP holds a PNG front and back for every accepted employee, a manifest of what was generated, and the rejected rows. Generation happens in this tab — no employee data is uploaded.'}
                  </p>
                </div>
              ) : null}

              {photoFailures.length > 0 ? (
                <div className="idc__issues idc__issues--advisory">
                  <h3>Photographs that could not be loaded</h3>
                  <ul>
                    {photoFailures.map((failure, index) => (
                      <li key={index}>{failure}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </fieldset>

            <fieldset className="idc__panel">
              <legend>Your data, and how to remove it</legend>
              <p className="ch247-page__hint">
                Card details and uploaded images are kept in this browser's local storage so a refresh does not lose your
                work. They are never sent to CloudHost247 and no analytics event contains them. Photographs fetched from a
                photo URL in a bulk import are downloaded directly by your browser from that address, which means the host
                of that image sees your IP address — upload the images instead if that matters.
              </p>
              <button type="button" className="ch247-button ch247-button--outline" onClick={clearStored}>
                Clear everything stored in this browser
              </button>
            </fieldset>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small controls                                                      */
/* ------------------------------------------------------------------ */

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  maxLength?: number;
}): JSX.Element {
  return (
    <label className="idc__field">
      <span>
        {label}
        {required ? <span className="bt247-field__required" aria-hidden="true"> *</span> : null}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }): JSX.Element {
  return (
    <label className="idc__toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Upload({
  label,
  hint,
  value,
  onPick,
  onRemove,
}: {
  label: string;
  hint: string;
  value: string;
  onPick: (file: File | undefined) => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <div className="idc__upload">
      <div className="idc__upload-info">
        <span className="idc__upload-label">{label}</span>
        <span className="idc__upload-hint">{hint}</span>
      </div>
      {value ? <img className="idc__thumb" src={value} alt={`${label} preview`} /> : <span className="idc__thumb idc__thumb--empty" aria-hidden="true">—</span>}
      <div className="idc__upload-actions">
        <label className="ch247-button ch247-button--small idc__file-button">
          {value ? 'Replace' : 'Upload'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              onPick(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        {value ? (
          <button type="button" className="ch247-button ch247-button--small ch247-button--outline" onClick={onRemove}>
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Colour({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): JSX.Element {
  return (
    <label className="idc__colour">
      <span>{label}</span>
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(event) => onChange(event.target.value)} />
      <input
        type="text"
        value={value}
        maxLength={7}
        aria-label={`${label} hex value`}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
