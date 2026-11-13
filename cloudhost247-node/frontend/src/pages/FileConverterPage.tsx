import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import {
  convertImageFile,
  convertImageToJpegPdfPage,
  convertPdfFile,
  createMultipagePdfOutput,
  createZipArchive,
  formatFileSize,
  getAvailableOutputFormats,
  getSourceKind,
  MAX_CONVERTER_FILE_BYTES,
  MAX_CONVERTER_FILES,
  MAX_PDF_PAGES,
  MAX_ZIP_ARCHIVE_BYTES,
  OUTPUT_FORMAT_LABELS,
  parsePdfPageSelection,
  type ConversionSettings,
  type ConvertedOutput,
  type JpegPdfPage,
  type OutputFormat,
  type SourceKind,
} from '../lib/file-converter';

const FILE_ACCEPT = '.png,.jpg,.jpeg,.jfif,.webp,.gif,.bmp,.avif,.heic,.heif,.svg,.pdf,image/png,image/jpeg,image/jfif,image/webp,image/gif,image/bmp,image/avif,image/heic,image/heif,image/svg+xml,application/pdf';
const DEFAULT_SETTINGS: ConversionSettings = {
  quality: 88,
  resize: false,
  maxWidth: 1920,
  maxHeight: 1920,
  dpi: 144,
  suffix: '',
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
  crop: { left: 0, top: 0, width: 100, height: 100 },
  pdfPages: '',
  combineImagesToPdf: false,
};

type JobStatus = 'ready' | 'converting' | 'done' | 'error';
interface ConversionJob {
  id: string;
  file: File;
  kind: SourceKind;
  status: JobStatus;
  outputs: ConvertedOutput[];
  error?: string;
  progress?: string;
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `file-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function FilePreview({ file, kind }: { file: File; kind: SourceKind }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (kind !== 'image' || typeof URL.createObjectURL !== 'function') return undefined;
    let objectUrl: string;
    try {
      objectUrl = URL.createObjectURL(file);
    } catch {
      return undefined;
    }
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, kind]);

  if (kind === 'pdf') {
    return <span className="fc-file-icon fc-file-icon--pdf" aria-hidden="true">PDF</span>;
  }
  return url
    ? <img className="fc-file-thumb" src={url} alt="" aria-hidden="true" />
    : <span className="fc-file-icon" aria-hidden="true">IMG</span>;
}

function triggerDownload(output: ConvertedOutput): void {
  const url = URL.createObjectURL(output.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = output.fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function StatusMark({ status }: { status: JobStatus }) {
  const label: Record<JobStatus, string> = {
    ready: 'Ready',
    converting: 'Converting',
    done: 'Converted',
    error: 'Needs attention',
  };
  return <span className={`fc-status fc-status--${status}`}>{label[status]}</span>;
}

export default function FileConverterPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [format, setFormat] = useState<OutputFormat>('png');
  const [settings, setSettings] = useState<ConversionSettings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  const [zipProgress, setZipProgress] = useState('');
  const [batchOutputs, setBatchOutputs] = useState<ConvertedOutput[]>([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  usePageMeta(
    'File Converter',
    'Convert, crop and rotate images, select PDF pages, build multi-page PDFs and download results as ZIP files. Processing stays in your browser.'
  );

  const availableFormats = useMemo(
    () => getAvailableOutputFormats(jobs.map((job) => job.kind)),
    [jobs],
  );
  const readyCount = jobs.length;
  const completedCount = jobs.filter((job) => job.status === 'done').length;
  const failedCount = jobs.filter((job) => job.status === 'error').length;
  const hasPdf = jobs.some((job) => job.kind === 'pdf');
  const combineAvailable = format === 'pdf' && jobs.length > 1 && jobs.every((job) => job.kind === 'image');
  const combiningPdf = combineAvailable && settings.combineImagesToPdf;
  const locked = busy || zipBusy;
  const downloadableOutputs = useMemo(
    () => [...batchOutputs, ...jobs.flatMap((job) => job.outputs)],
    [batchOutputs, jobs],
  );
  const pageRangeError = useMemo(() => {
    if (!hasPdf) return null;
    try {
      parsePdfPageSelection(settings.pdfPages, MAX_PDF_PAGES);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Check the selected PDF pages.';
    }
  }, [hasPdf, settings.pdfPages]);

  function addFiles(fileList: FileList | File[]) {
    if (locked) return;
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;
    const additions: ConversionJob[] = [];
    const problems: string[] = [];
    const signatures = new Set(jobs.map((job) => `${job.file.name}:${job.file.size}:${job.file.lastModified}`));

    for (const file of incoming) {
      const kind = getSourceKind(file);
      if (!kind) {
        problems.push(`${file.name}: choose an image (PNG, JPEG/JFIF, WebP, GIF, BMP, AVIF, HEIC/HEIF or SVG) or a PDF.`);
        continue;
      }
      if (file.size <= 0) {
        problems.push(`${file.name}: the file is empty.`);
        continue;
      }
      if (file.size > MAX_CONVERTER_FILE_BYTES) {
        problems.push(`${file.name}: files must be ${formatFileSize(MAX_CONVERTER_FILE_BYTES)} or smaller.`);
        continue;
      }
      const signature = `${file.name}:${file.size}:${file.lastModified}`;
      if (signatures.has(signature)) {
        problems.push(`${file.name}: this file is already in the queue.`);
        continue;
      }
      if (jobs.length + additions.length >= MAX_CONVERTER_FILES) {
        problems.push(`The queue is limited to ${MAX_CONVERTER_FILES} files at a time.`);
        break;
      }
      signatures.add(signature);
      additions.push({ id: createId(), file, kind, status: 'ready', outputs: [] });
    }

    if (additions.length > 0) {
      const resetCombinedJobs = format === 'pdf' && settings.combineImagesToPdf;
      const existingJobs = resetCombinedJobs
        ? jobs.map((job) => ({ ...job, status: 'ready' as const, outputs: [], error: undefined, progress: undefined }))
        : jobs;
      const nextJobs = [...existingJobs, ...additions];
      setJobs(nextJobs);
      setBatchOutputs([]);
      const supported = getAvailableOutputFormats(nextJobs.map((job) => job.kind));
      setFormat((current) => supported.includes(current) ? current : 'png');
      if (nextJobs.some((job) => job.kind === 'pdf') && settings.combineImagesToPdf) {
        setSettings((current) => ({ ...current, combineImagesToPdf: false }));
      }
    }
    setNotice(problems.length > 0
      ? { kind: 'error', text: problems.slice(0, 3).join(' ') + (problems.length > 3 ? ` And ${problems.length - 3} more issue(s).` : '') }
      : additions.length > 0
        ? { kind: 'success', text: `${additions.length} file${additions.length === 1 ? '' : 's'} added. Your files stay on this device.` }
        : null);
  }

  function clearQueue() {
    if (locked) return;
    setJobs([]);
    setBatchOutputs([]);
    setFormat('png');
    setSettings((current) => ({ ...current, combineImagesToPdf: false }));
    setNotice(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  function removeJob(id: string) {
    if (locked) return;
    const nextJobs = jobs.filter((job) => job.id !== id);
    const resetCombinedJobs = format === 'pdf' && settings.combineImagesToPdf;
    setJobs(resetCombinedJobs
      ? nextJobs.map((job) => ({ ...job, status: 'ready', outputs: [], error: undefined, progress: undefined }))
      : nextJobs);
    setBatchOutputs([]);
    const supported = getAvailableOutputFormats(nextJobs.map((job) => job.kind));
    setFormat((current) => supported.includes(current) ? current : 'png');
    if ((nextJobs.length <= 1 || nextJobs.some((job) => job.kind === 'pdf')) && settings.combineImagesToPdf) {
      setSettings((current) => ({ ...current, combineImagesToPdf: false }));
    }
    setNotice(null);
  }

  function moveJob(id: string, direction: -1 | 1) {
    if (locked || !combiningPdf) return;
    const index = jobs.findIndex((job) => job.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= jobs.length) return;
    const nextJobs = [...jobs];
    [nextJobs[index], nextJobs[nextIndex]] = [nextJobs[nextIndex]!, nextJobs[index]!];
    setJobs(nextJobs.map((job) => ({ ...job, status: 'ready', outputs: [], error: undefined, progress: undefined })));
    setBatchOutputs([]);
    setNotice(null);
  }

  function updateSettings(patch: Partial<ConversionSettings>) {
    if (locked) return;
    setSettings((current) => ({ ...current, ...patch }));
    setJobs((current) => current.map((job) => ({ ...job, status: 'ready', outputs: [], error: undefined, progress: undefined })));
    setBatchOutputs([]);
    setNotice(null);
  }

  function updateCrop(field: keyof ConversionSettings['crop'], rawValue: number) {
    if (!Number.isFinite(rawValue)) return;
    const crop = settings.crop;
    let nextCrop = { ...crop };
    if (field === 'left') {
      nextCrop.left = Math.max(0, Math.min(99, rawValue));
      nextCrop.width = Math.min(crop.width, 100 - nextCrop.left);
    }
    if (field === 'top') {
      nextCrop.top = Math.max(0, Math.min(99, rawValue));
      nextCrop.height = Math.min(crop.height, 100 - nextCrop.top);
    }
    if (field === 'width') nextCrop.width = Math.max(1, Math.min(100 - crop.left, rawValue));
    if (field === 'height') nextCrop.height = Math.max(1, Math.min(100 - crop.top, rawValue));
    updateSettings({ crop: nextCrop });
  }

  function changeFormat(nextFormat: OutputFormat) {
    if (locked || !availableFormats.includes(nextFormat)) return;
    setFormat(nextFormat);
    if (nextFormat !== 'pdf' && settings.combineImagesToPdf) {
      setSettings((current) => ({ ...current, combineImagesToPdf: false }));
    }
    setJobs((current) => current.map((job) => ({ ...job, status: 'ready', outputs: [], error: undefined, progress: undefined })));
    setBatchOutputs([]);
    setNotice(null);
  }

  async function convertFiles(retryOnly = false) {
    if (locked || jobs.length === 0 || !availableFormats.includes(format)) return;
    if (pageRangeError) {
      setNotice({ kind: 'error', text: pageRangeError });
      return;
    }
    const targetJobs = retryOnly && !combiningPdf ? jobs.filter((job) => job.status === 'error') : jobs;
    if (targetJobs.length === 0) return;
    setBusy(true);
    setNotice(null);
    setBatchOutputs([]);
    let completed = 0;
    let failed = 0;

    if (combiningPdf) {
      const pages: JpegPdfPage[] = [];
      const errors = new Map<string, string>();
      for (let index = 0; index < targetJobs.length; index += 1) {
        const job = targetJobs[index]!;
        setJobs((current) => current.map((item) => item.id === job.id
          ? { ...item, status: 'converting', outputs: [], error: undefined, progress: `Preparing image ${index + 1} of ${targetJobs.length}…` }
          : item));
        try {
          pages.push(await convertImageToJpegPdfPage(job.file, settings));
        } catch (error) {
          errors.set(job.id, error instanceof Error ? error.message : 'This image could not be prepared for the PDF.');
        }
      }

      if (errors.size > 0) {
        failed = errors.size;
        setJobs((current) => current.map((job) => {
          const error = errors.get(job.id);
          return error
            ? { ...job, status: 'error', outputs: [], error, progress: undefined }
            : { ...job, status: 'ready', outputs: [], error: undefined, progress: undefined };
        }));
        setNotice({ kind: 'error', text: `The combined PDF was not created because ${failed} image${failed === 1 ? '' : 's'} could not be prepared. Fix or remove the failed file, then retry the batch.` });
      } else {
        try {
          const output = createMultipagePdfOutput(pages, settings.suffix);
          setBatchOutputs([output]);
          setJobs((current) => current.map((job) => ({ ...job, status: 'done', outputs: [], error: undefined, progress: undefined })));
          completed = targetJobs.length;
          setNotice({ kind: 'success', text: `Created one multi-page PDF with ${pages.length} pages in queue order.` });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'The combined PDF could not be created.';
          setJobs((current) => current.map((job) => ({ ...job, status: 'error', outputs: [], error: message, progress: undefined })));
          failed = targetJobs.length;
          setNotice({ kind: 'error', text: message });
        }
      }
      setBusy(false);
      return;
    }

    for (const job of targetJobs) {
      setJobs((current) => current.map((item) => item.id === job.id
        ? { ...item, status: 'converting', outputs: [], error: undefined, progress: job.kind === 'pdf' ? 'Opening PDF…' : 'Preparing image…' }
        : item));
      try {
        let outputs: ConvertedOutput[];
        if (job.kind === 'pdf') {
          if (format === 'pdf' || format === 'svg') throw new Error('PDF pages can be exported as PNG, JPEG, or WebP images.');
          outputs = await convertPdfFile(job.file, format, settings, (pageNumber, selectedIndex, selectedTotal) => {
            setJobs((current) => current.map((item) => item.id === job.id
              ? { ...item, progress: `Rendering PDF page ${pageNumber} (${selectedIndex} of ${selectedTotal})…` }
              : item));
          });
        } else {
          outputs = [await convertImageFile(job.file, format, settings)];
        }
        setJobs((current) => current.map((item) => item.id === job.id
          ? { ...item, status: 'done', outputs, progress: undefined, error: undefined }
          : item));
        completed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'This file could not be converted.';
        setJobs((current) => current.map((item) => item.id === job.id
          ? { ...item, status: 'error', outputs: [], error: message, progress: undefined }
          : item));
        failed += 1;
      }
    }

    setBusy(false);
    if (failed === 0) {
      setNotice({ kind: 'success', text: `${completed} file${completed === 1 ? '' : 's'} converted. Select Download to save the result${completed === 1 ? '' : 's'}.` });
    } else {
      setNotice({ kind: 'error', text: `${completed} converted and ${failed} could not be converted. See each file for details.` });
    }
  }

  async function downloadAllAsZip() {
    if (locked || downloadableOutputs.length === 0) return;
    setZipBusy(true);
    setZipProgress(`0 of ${downloadableOutputs.length}`);
    setNotice(null);
    try {
      const blob = await createZipArchive(downloadableOutputs, (completed, total) => {
        setZipProgress(`${completed} of ${total}`);
      });
      triggerDownload({ fileName: 'cloudhost247-converted-files.zip', blob });
      setNotice({ kind: 'success', text: `${downloadableOutputs.length} converted file${downloadableOutputs.length === 1 ? '' : 's'} packed into a ZIP download.` });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'The ZIP archive could not be created.' });
    } finally {
      setZipBusy(false);
      setZipProgress('');
    }
  }

  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!locked) addFiles(event.dataTransfer.files);
  };

  return (
    <div className="fc-page">
      <div className="fc-wrap">
        <nav className="fc-breadcrumb" aria-label="Breadcrumb">
          <Link to="/tools">Tools</Link>
          <span aria-hidden="true">/</span>
          <Link to="/tools/file-tools">File Tools</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">File Converter</span>
        </nav>

        <section className="fc-hero" aria-labelledby="file-converter-title">
          <div className="fc-hero__copy">
            <p className="fc-eyebrow"><span aria-hidden="true" /> CLOUDHOST247 · FREE ONLINE TOOL</p>
            <h1 id="file-converter-title">File Converter</h1>
            <p className="fc-hero__lede">Convert images and PDF pages to the formats you need, without handing your files to a server.</p>
            <div className="fc-hero__proof">
              <span><b aria-hidden="true">✓</b> Runs in your browser</span>
              <span><b aria-hidden="true">✓</b> No sign-in required</span>
              <span><b aria-hidden="true">✓</b> No upload or cloud copy</span>
            </div>
          </div>
          <div className="fc-hero__visual" aria-hidden="true">
            <div className="fc-orbit fc-orbit--one" />
            <div className="fc-orbit fc-orbit--two" />
            <div className="fc-format-card fc-format-card--left"><span>PNG</span><i>Image</i></div>
            <div className="fc-format-card fc-format-card--center"><span className="fc-doc-mark">↗</span><strong>Convert</strong><small>on this device</small></div>
            <div className="fc-format-card fc-format-card--right"><span>PDF</span><i>Document</i></div>
          </div>
        </section>

        <section className="fc-workspace" aria-labelledby="fc-workspace-title">
          <div className="fc-workspace__head">
            <div>
              <p className="fc-eyebrow fc-eyebrow--dark">YOUR CONVERSION WORKSPACE</p>
              <h2 id="fc-workspace-title">Start with a file</h2>
              <p>Choose files from your device. You can add up to {MAX_CONVERTER_FILES} files in one batch.</p>
            </div>
            {jobs.length > 0 && (
              <button className="fc-button fc-button--quiet" type="button" onClick={clearQueue} disabled={locked}>Clear queue</button>
            )}
          </div>

          <div
            className={`fc-dropzone${dragging ? ' is-dragging' : ''}${locked ? ' is-busy' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); if (!locked) setDragging(true); }}
            onDragOver={(event) => { event.preventDefault(); if (!locked) setDragging(true); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
            onDrop={dropFiles}
            aria-label="File drop area"
          >
            <input
              ref={fileInput}
              className="fc-visually-hidden"
              type="file"
              accept={FILE_ACCEPT}
              multiple
              aria-label="Choose images and PDFs"
disabled={locked || jobs.length >= MAX_CONVERTER_FILES}
              onChange={(event) => {
                if (event.currentTarget.files) addFiles(event.currentTarget.files);
                event.currentTarget.value = '';
              }}
            />
            <span className="fc-upload-icon" aria-hidden="true">
              <svg viewBox="0 0 48 48" fill="none"><path d="M24 32V7m0 0-9 9m9-9 9 9M9 27v11a3 3 0 0 0 3 3h24a3 3 0 0 0 3-3V27" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <h3>{dragging ? 'Drop to add your files' : 'Drop files here'}</h3>
            <p>or browse from your device</p>
            <button className="fc-button fc-button--primary" type="button" onClick={() => fileInput.current?.click()} disabled={locked || jobs.length >= MAX_CONVERTER_FILES}>
              Choose files
            </button>
            <small>PNG, JPG/JFIF, WebP, GIF, BMP, AVIF, HEIC/HEIF, SVG or PDF · up to {formatFileSize(MAX_CONVERTER_FILE_BYTES)} each</small>
          </div>

          {notice && <p className={`fc-notice fc-notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>}

          {jobs.length > 0 && (
            <div className="fc-conversion-panel">
              <div className="fc-controls">
                <label className="fc-control" htmlFor="fc-output-format">
                  <span>Convert to</span>
                  <select id="fc-output-format" value={format} onChange={(event) => changeFormat(event.target.value as OutputFormat)} disabled={locked}>
                    {availableFormats.map((item) => <option key={item} value={item}>{OUTPUT_FORMAT_LABELS[item]}</option>)}
                  </select>
                </label>
                <p className="fc-control-note">
                  {hasPdf
                    ? `Selected PDF pages export as separate ${OUTPUT_FORMAT_LABELS[format]} files.`
                    : format === 'pdf' && settings.combineImagesToPdf && jobs.length > 1
                      ? 'Queued images become pages in one PDF, in the order shown below.'
                      : format === 'pdf'
                        ? 'One single-page PDF is created for each image.'
                        : format === 'svg'
                          ? 'SVG output wraps a PNG image; it is not a vector trace.'
                          : 'Each image is converted into a separate file.'}
                </p>
              </div>

              {combineAvailable && (
                <div className="fc-combine-option">
                  <label className="fc-checkbox">
                    <input type="checkbox" checked={settings.combineImagesToPdf} onChange={(event) => updateSettings({ combineImagesToPdf: event.target.checked })} disabled={locked} />
                    <span>Combine queued images into one multi-page PDF</span>
                  </label>
                  <p>Page order follows the queue. Use the arrow controls on each file to rearrange pages.</p>
                </div>
              )}

              <details className="fc-advanced">
                <summary><span>Advanced settings</span><small>Optional · quality, image edits and PDF controls</small></summary>
                <div className="fc-advanced__body">
                  <label className="fc-control fc-control--range" htmlFor="fc-quality">
                    <span>Quality <output htmlFor="fc-quality">{settings.quality}%</output></span>
                    <input id="fc-quality" type="range" min="10" max="100" step="1" value={settings.quality} onChange={(event) => updateSettings({ quality: Number(event.target.value) })} disabled={locked} />
                    <small>Applies to JPEG and WebP. PNG is lossless.</small>
                  </label>
                  <div className="fc-resize">
                    <label className="fc-checkbox"><input type="checkbox" checked={settings.resize} onChange={(event) => updateSettings({ resize: event.target.checked })} disabled={locked} /><span>Resize output to fit within</span></label>
                    <label className="fc-control" htmlFor="fc-max-width"><span>Maximum width</span><input id="fc-max-width" type="number" min="1" max="8192" value={settings.maxWidth} onChange={(event) => updateSettings({ maxWidth: Number(event.target.value) || 0 })} disabled={locked || !settings.resize} /></label>
                    <label className="fc-control" htmlFor="fc-max-height"><span>Maximum height</span><input id="fc-max-height" type="number" min="1" max="8192" value={settings.maxHeight} onChange={(event) => updateSettings({ maxHeight: Number(event.target.value) || 0 })} disabled={locked || !settings.resize} /></label>
                  </div>

                  <fieldset className="fc-edit-tools">
                    <legend>Image edits</legend>
                    <p>These edits apply to every image and every PDF page you export in this batch.</p>
                    <div className="fc-edit-tools__grid">
                      <label className="fc-control" htmlFor="fc-rotation">
                        <span>Rotate clockwise</span>
                        <select id="fc-rotation" value={settings.rotation} onChange={(event) => updateSettings({ rotation: Number(event.target.value) as ConversionSettings['rotation'] })} disabled={locked}>
                          <option value={0}>No rotation</option>
                          <option value={90}>90°</option>
                          <option value={180}>180°</option>
                          <option value={270}>270°</option>
                        </select>
                      </label>
                      <div className="fc-edit-tools__flips">
                        <label className="fc-checkbox"><input type="checkbox" checked={settings.flipHorizontal} onChange={(event) => updateSettings({ flipHorizontal: event.target.checked })} disabled={locked} /><span>Flip horizontally</span></label>
                        <label className="fc-checkbox"><input type="checkbox" checked={settings.flipVertical} onChange={(event) => updateSettings({ flipVertical: event.target.checked })} disabled={locked} /><span>Flip vertically</span></label>
                      </div>
                    </div>
                    <fieldset className="fc-crop-tools">
                      <legend>Crop area <small>Percent of the original width and height</small></legend>
                      <div className="fc-crop-tools__grid">
                        <label className="fc-control" htmlFor="fc-crop-left"><span>Left (%)</span><input id="fc-crop-left" type="number" min="0" max="99" step="1" value={settings.crop.left} onChange={(event) => updateCrop('left', Number(event.target.value))} disabled={locked} /></label>
                        <label className="fc-control" htmlFor="fc-crop-top"><span>Top (%)</span><input id="fc-crop-top" type="number" min="0" max="99" step="1" value={settings.crop.top} onChange={(event) => updateCrop('top', Number(event.target.value))} disabled={locked} /></label>
                        <label className="fc-control" htmlFor="fc-crop-width"><span>Width (%)</span><input id="fc-crop-width" type="number" min="1" max={100 - settings.crop.left} step="1" value={settings.crop.width} onChange={(event) => updateCrop('width', Number(event.target.value))} disabled={locked} /></label>
                        <label className="fc-control" htmlFor="fc-crop-height"><span>Height (%)</span><input id="fc-crop-height" type="number" min="1" max={100 - settings.crop.top} step="1" value={settings.crop.height} onChange={(event) => updateCrop('height', Number(event.target.value))} disabled={locked} /></label>
                      </div>
                      <button type="button" className="fc-button fc-button--quiet fc-crop-reset" onClick={() => updateSettings({ crop: { left: 0, top: 0, width: 100, height: 100 } })} disabled={locked || (settings.crop.left === 0 && settings.crop.top === 0 && settings.crop.width === 100 && settings.crop.height === 100)}>Reset crop</button>
                    </fieldset>
                  </fieldset>

                  {hasPdf && (
                    <div className="fc-pdf-tools">
                      <label className="fc-control" htmlFor="fc-pdf-pages">
                        <span>PDF pages to export</span>
                        <input id="fc-pdf-pages" type="text" value={settings.pdfPages} placeholder="All pages (or 1-3, 5)" aria-invalid={Boolean(pageRangeError)} aria-describedby="fc-pdf-pages-help" onChange={(event) => updateSettings({ pdfPages: event.target.value })} disabled={locked} />
                        <small id="fc-pdf-pages-help">Leave blank for every page. Use page numbers and ranges, for example 1-3, 5.</small>
                      </label>
                      {pageRangeError && <p className="fc-file-error" role="alert">{pageRangeError}</p>}
                    </div>
                  )}
                  {hasPdf && (
                    <label className="fc-control" htmlFor="fc-dpi">
                      <span>PDF page resolution</span>
                      <select id="fc-dpi" value={settings.dpi} onChange={(event) => updateSettings({ dpi: Number(event.target.value) })} disabled={locked}>
                        <option value={96}>96 DPI · smaller files</option>
                        <option value={144}>144 DPI · balanced</option>
                        <option value={216}>216 DPI · higher detail</option>
                      </select>
                    </label>
                  )}
                  <label className="fc-control" htmlFor="fc-suffix"><span>Filename suffix</span><input id="fc-suffix" type="text" maxLength={32} placeholder="e.g. optimized" value={settings.suffix} onChange={(event) => updateSettings({ suffix: event.target.value })} disabled={locked} /><small>Added before the new file extension.</small></label>
                </div>
              </details>

              {batchOutputs.length > 0 && (
                <div className="fc-batch-output">
                  <div><strong>Combined PDF</strong><small>{jobs.length} image pages · queue order</small></div>
                  {batchOutputs.map((output) => (
                    <button key={output.fileName} type="button" className="fc-button fc-button--download" onClick={() => triggerDownload(output)}>{output.fileName} · Download</button>
                  ))}
                </div>
              )}

              <div className="fc-queue-heading">
                <div><h3>Your files <span>{readyCount}</span></h3><p>{failedCount > 0 ? `${failedCount} need attention` : completedCount > 0 ? `${completedCount} converted` : `${readyCount} ready to convert`}</p></div>
                <div className="fc-queue-actions">
                  {failedCount > 0 && (
                    <button className="fc-button fc-button--quiet" type="button" onClick={() => void convertFiles(true)} disabled={locked || Boolean(pageRangeError)}>
                      {combiningPdf ? 'Retry combined PDF' : `Retry ${failedCount === 1 ? 'failed file' : `${failedCount} failed files`}`}
                    </button>
                  )}
                  {downloadableOutputs.length > 0 && (
                    <button className="fc-button fc-button--quiet fc-button--zip" type="button" onClick={() => void downloadAllAsZip()} disabled={locked}>
                      {zipBusy ? <><span className="fc-spinner fc-spinner--dark" aria-hidden="true" />Packing ZIP ({zipProgress})…</> : `Download all as ZIP (${downloadableOutputs.length})`}
                    </button>
                  )}
                  <button className="fc-button fc-button--primary fc-button--convert" type="button" onClick={() => void convertFiles()} disabled={locked || jobs.length === 0 || Boolean(pageRangeError)}>
                    {busy ? <><span className="fc-spinner" aria-hidden="true" />Converting on this device…</> : completedCount === jobs.length && jobs.length > 0 ? 'Convert again' : 'Convert files'}
                  </button>
                </div>
              </div>

              <ul className="fc-queue" aria-label="Files in conversion queue">
                {jobs.map((job, index) => (
                  <li className={`fc-file-row fc-file-row--${job.status}`} key={job.id}>
                    <FilePreview file={job.file} kind={job.kind} />
                    <div className="fc-file-info">
                      <div className="fc-file-info__top"><strong title={job.file.name}>{job.file.name}</strong><StatusMark status={job.status} /></div>
                      <p>{job.kind === 'pdf' ? 'PDF document' : 'Image'} <span aria-hidden="true">·</span> {formatFileSize(job.file.size)}</p>
                      {job.progress && <p className="fc-progress" role="status">{job.progress}</p>}
                      {job.error && <p className="fc-file-error" role="alert">{job.error}</p>}
                      {job.outputs.length > 0 && <ul className="fc-output-list" aria-label={`Converted files for ${job.file.name}`}>
                        {job.outputs.map((output) => (
                          <li key={output.fileName}>
                            <span><b>{output.fileName}</b><small>{formatFileSize(output.blob.size)}</small></span>
                            <button type="button" className="fc-button fc-button--download" onClick={() => triggerDownload(output)}>Download</button>
                          </li>
                        ))}
                      </ul>}
                    </div>
                    <div className="fc-file-actions">
                      {combiningPdf && (
                        <div className="fc-order-controls" aria-label={`PDF page order for ${job.file.name}`}>
                          <button type="button" aria-label={`Move ${job.file.name} up`} onClick={() => moveJob(job.id, -1)} disabled={locked || index === 0}>↑</button>
                          <button type="button" aria-label={`Move ${job.file.name} down`} onClick={() => moveJob(job.id, 1)} disabled={locked || index === jobs.length - 1}>↓</button>
                        </div>
                      )}
                      <button className="fc-remove" type="button" aria-label={`Remove ${job.file.name}`} onClick={() => removeJob(job.id)} disabled={locked}>×</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="fc-benefits" aria-label="About this converter">
          <article><span className="fc-benefit-icon" aria-hidden="true">◎</span><h2>Private by design</h2><p>Conversion happens inside this browser tab. The selected file bytes are not sent to CloudHost247 or a conversion API.</p></article>
          <article><span className="fc-benefit-icon" aria-hidden="true">↗</span><h2>Useful formats</h2><p>Convert PNG, JPEG/JFIF, WebP, GIF, BMP, AVIF, HEIC/HEIF and sanitized SVG images; export PDF pages or save results together as a ZIP.</p></article>
          <article><span className="fc-benefit-icon" aria-hidden="true">⌁</span><h2>Clear limits</h2><p>Up to {MAX_CONVERTER_FILES} files per batch, {formatFileSize(MAX_CONVERTER_FILE_BYTES)} per file and {MAX_PDF_PAGES} PDF pages. ZIP downloads are capped at {formatFileSize(MAX_ZIP_ARCHIVE_BYTES)}. Animated GIFs convert their first frame.</p></article>
        </section>

        <p className="fc-footnote">For compatibility, image decoding and WebP output depend on your browser. ZIP downloads are capped at {formatFileSize(MAX_ZIP_ARCHIVE_BYTES)} to protect browser memory. Close this page or clear the queue to release the files held in this tab.</p>
        <div className="fc-back-link"><Link to="/tools">← Back to all tools</Link></div>
      </div>
    </div>
  );
}
