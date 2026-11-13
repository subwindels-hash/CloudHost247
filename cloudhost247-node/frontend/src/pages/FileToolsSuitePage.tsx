import { useEffect, useMemo, useState, type ChangeEvent, type MouseEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MAX_CONVERTER_FILES, MAX_CONVERTER_FILE_BYTES, MAX_PDF_PAGES, MAX_ZIP_ARCHIVE_BYTES, formatFileSize, getSourceKind, convertImageFile, createZipArchive, resizeImageFile, type ConvertedOutput, type RasterOutputFormat } from '../lib/file-converter';
import { MAX_ANIMATION_FRAMES, compressAnimatedGif, convertAnimatedImageToApng, convertAnimatedImageToGif, convertAnimatedImageToMp4, convertVideoToGif, createGifFromImages } from '../lib/animation-tools';
import { compressPdfFile, convertDocumentToDocx, convertDocumentToPdf, convertLocalMedia, createCompressedZipArchive, createImageCompressionSettings, editPdfFile, extractDocumentText, extractZipArchive, mergePdfFiles, processGzipFile, protectPdfFile, unlockPdfFile, type LocalMediaFormat, type LocalMediaKind, type PdfOperation, type PdfToolResult } from '../lib/file-tools';
import { usePageMeta } from '../lib/usePageMeta';
import ToolSeo from '../components/tools/ToolSeo';
import '../file-tools.css';

type Section = 'overview' | 'convert' | 'compress' | 'tools' | 'api' | 'pricing';
const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'convert', label: 'Convert' },
  { id: 'compress', label: 'Compress' },
  { id: 'tools', label: 'Tools' },
  { id: 'api', label: 'API' },
  { id: 'pricing', label: 'Pricing' },
];
const MAX_BATCH_BYTES = MAX_CONVERTER_FILES * MAX_CONVERTER_FILE_BYTES;

type CompressionOutput = { sourceName: string; sourceSize: number; output: ConvertedOutput };

function saveBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setUrl(null); return; }
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);
  return url;
}

function ImageCompressor() {
  const [files, setFiles] = useState<File[]>([]);
  const [format, setFormat] = useState<RasterOutputFormat>('webp');
  const [quality, setQuality] = useState(76);
  const [maxDimension, setMaxDimension] = useState(2400);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState('');
  const [outputs, setOutputs] = useState<CompressionOutput[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [zipBusy, setZipBusy] = useState(false);

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (selected.length > MAX_CONVERTER_FILES) {
      setErrors([`Choose up to ${MAX_CONVERTER_FILES} images per batch.`]);
      return;
    }
    const invalid = selected.find((file) => getSourceKind(file) !== 'image' || file.size > MAX_CONVERTER_FILE_BYTES);
    if (invalid) {
      setErrors([getSourceKind(invalid) !== 'image' ? `“${invalid.name}” is not a supported image.` : `“${invalid.name}” exceeds the ${formatFileSize(MAX_CONVERTER_FILE_BYTES)} file limit.`]);
      return;
    }
    if (selected.reduce((total, file) => total + file.size, 0) > MAX_BATCH_BYTES) {
      setErrors([`This batch exceeds the ${formatFileSize(MAX_BATCH_BYTES)} local limit.`]);
      return;
    }
    setFiles(selected);
    setOutputs([]);
    setErrors([]);
    setProgress('');
  }

  async function compress() {
    if (!files.length || working) return;
    setWorking(true);
    setOutputs([]);
    setErrors([]);
    const completed: CompressionOutput[] = [];
    const failures: string[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      setProgress(`Compressing ${index + 1} of ${files.length}: ${file.name}`);
      try {
        const output = await convertImageFile(file, format, createImageCompressionSettings(quality, maxDimension, maxDimension));
        completed.push({ sourceName: file.name, sourceSize: file.size, output });
        setOutputs([...completed]);
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : 'Compression failed.'}`);
      }
    }
    setErrors(failures);
    setProgress(failures.length ? `Finished with ${failures.length} failed file${failures.length === 1 ? '' : 's'}.` : `Compressed ${completed.length} image${completed.length === 1 ? '' : 's'} locally.`);
    setWorking(false);
  }

  async function downloadZip() {
    if (!outputs.length || zipBusy) return;
    setZipBusy(true);
    try {
      const archive = await createZipArchive(outputs.map(({ output }) => output));
      saveBlob('cloudhost247-compressed-images.zip', archive);
    } catch (error) {
      setErrors((current) => [...current, error instanceof Error ? error.message : 'Could not create the ZIP.']);
    } finally {
      setZipBusy(false);
    }
  }

  return (
    <section id="ft-image-compressor" className="ft-panel" aria-labelledby="ft-image-compressor-title" tabIndex={-1}>
      <div className="ft-panel-heading">
        <div><p className="ft-kicker">IMAGE COMPRESSION</p><h2 id="ft-image-compressor-title">Shrink images in your browser</h2></div>
        <span className="ft-local-tag">Local processing</span>
      </div>
      <p className="ft-copy">Choose a modern WebP output for smaller files, or export JPEG/PNG. The source image is resized only when it exceeds your selected maximum dimension.</p>
      <label className="ft-file-picker">
        <span>Choose images</span>
        <input type="file" accept="image/png,image/jpeg,image/jfif,image/webp,image/gif,image/bmp,image/avif,image/heic,image/heif,image/svg+xml" multiple onChange={chooseFiles} disabled={working} />
        <small>Up to {MAX_CONVERTER_FILES} files · {formatFileSize(MAX_CONVERTER_FILE_BYTES)} each · processed on this device</small>
      </label>
      {files.length > 0 && <p className="ft-selected">{files.length} image{files.length === 1 ? '' : 's'} selected · {formatFileSize(files.reduce((sum, file) => sum + file.size, 0))}</p>}
      <div className="ft-settings-grid">
        <label>Output format<select value={format} onChange={(event) => setFormat(event.target.value as RasterOutputFormat)} disabled={working}><option value="webp">WebP — smallest for most images</option><option value="jpeg">JPEG — broad compatibility</option><option value="png">PNG — lossless</option></select></label>
        <label>Image quality <span className="ft-range-value">{quality}%</span><input type="range" min="20" max="100" value={quality} onChange={(event) => setQuality(Number(event.target.value))} disabled={working || format === 'png'} /><small>Quality affects JPEG and WebP; PNG output is lossless.</small></label>
        <label>Maximum width and height<input type="number" min="128" max="8192" step="100" value={maxDimension} onChange={(event) => setMaxDimension(Math.max(128, Math.min(8192, Number(event.target.value) || 128)))} disabled={working} /><small>Images larger than this are reduced proportionally; smaller ones are not enlarged.</small></label>
      </div>
      <div className="ft-actions"><button type="button" className="ft-button ft-button--primary" onClick={() => void compress()} disabled={!files.length || working}>{working ? 'Compressing…' : 'Compress images'}</button>{outputs.length > 1 && <button type="button" className="ft-button" onClick={() => void downloadZip()} disabled={zipBusy}>{zipBusy ? 'Preparing ZIP…' : 'Download all as ZIP'}</button>}<button type="button" className="ft-button ft-button--quiet" onClick={() => { setFiles([]); setOutputs([]); setErrors([]); setProgress(''); }} disabled={working && files.length > 0}>Clear</button></div>
      {progress && <p className="ft-status" role="status">{progress}</p>}
      {outputs.length > 0 && <div className="ft-results" aria-label="Compressed images">{outputs.map(({ sourceName, sourceSize, output }) => {
        const delta = sourceSize - output.blob.size;
        const ratio = sourceSize ? Math.round(Math.abs(delta) / sourceSize * 100) : 0;
        return <article className="ft-result" key={`${sourceName}-${output.fileName}`}><div><strong>{sourceName}</strong><small>{formatFileSize(sourceSize)} → {formatFileSize(output.blob.size)} · {delta >= 0 ? `${ratio}% smaller` : `${ratio}% larger`}</small></div><button type="button" className="ft-button" onClick={() => saveBlob(output.fileName, output.blob)}>Download</button></article>;
      })}</div>}
      {errors.length > 0 && <ul className="ft-errors" role="alert">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
    </section>
  );
}

function PdfCompressor() {
  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] = useState(64);
  const [dpi, setDpi] = useState(110);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState('');
  const [outputs, setOutputs] = useState<CompressionOutput[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (selected.length > MAX_CONVERTER_FILES || selected.some((file) => getSourceKind(file) !== 'pdf' || file.size > MAX_CONVERTER_FILE_BYTES)) {
      setErrors([`Choose up to ${MAX_CONVERTER_FILES} PDFs, no larger than ${formatFileSize(MAX_CONVERTER_FILE_BYTES)} each.`]);
      return;
    }
    setFiles(selected);
    setOutputs([]);
    setErrors([]);
    setProgress('');
  }

  async function compress() {
    if (!files.length || working) return;
    setWorking(true);
    setOutputs([]);
    setErrors([]);
    const completed: CompressionOutput[] = [];
    const failures: string[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      setProgress(`Reading ${index + 1} of ${files.length}: ${file.name}`);
      try {
        const output = await compressPdfFile(file, { quality, dpi }, (page, total) => setProgress(`${file.name} · rendering page ${page} of ${total}`));
        completed.push({ sourceName: file.name, sourceSize: file.size, output });
        setOutputs([...completed]);
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : 'Compression failed.'}`);
      }
    }
    setErrors(failures);
    setProgress(failures.length ? `Finished with ${failures.length} failed file${failures.length === 1 ? '' : 's'}.` : `Compressed ${completed.length} PDF${completed.length === 1 ? '' : 's'} locally.`);
    setWorking(false);
  }

  return (
    <section id="ft-pdf-compressor" className="ft-panel" aria-labelledby="ft-pdf-compressor-title" tabIndex={-1}>
      <div className="ft-panel-heading"><div><p className="ft-kicker">PDF COMPRESSION</p><h2 id="ft-pdf-compressor-title">Reduce PDF size locally</h2></div><span className="ft-local-tag">No upload</span></div>
      <p className="ft-copy">Pages are rendered and rebuilt as optimized images. This can shrink image-heavy PDFs; it also flattens text, links, form fields, and existing signatures. For text-searchable output, use the original file instead.</p>
      <label className="ft-file-picker"><span>Choose PDFs</span><input type="file" accept="application/pdf,.pdf" multiple onChange={chooseFiles} disabled={working} /><small>Up to {MAX_CONVERTER_FILES} files · {formatFileSize(MAX_CONVERTER_FILE_BYTES)} each · {MAX_PDF_PAGES} pages per PDF</small></label>
      {files.length > 0 && <p className="ft-selected">{files.length} PDF{files.length === 1 ? '' : 's'} selected · {formatFileSize(files.reduce((sum, file) => sum + file.size, 0))}</p>}
      <div className="ft-settings-grid">
        <label>Image quality <span className="ft-range-value">{quality}%</span><input type="range" min="25" max="95" value={quality} onChange={(event) => setQuality(Number(event.target.value))} disabled={working} /><small>Lower quality usually creates a smaller PDF.</small></label>
        <label>Page rendering resolution<select value={dpi} onChange={(event) => setDpi(Number(event.target.value))} disabled={working}><option value="72">72 DPI · smallest</option><option value="110">110 DPI · balanced</option><option value="150">150 DPI · clearer text</option></select><small>Higher resolution can increase output size.</small></label>
      </div>
      <div className="ft-actions"><button type="button" className="ft-button ft-button--primary" onClick={() => void compress()} disabled={!files.length || working}>{working ? 'Compressing…' : 'Compress PDFs'}</button><button type="button" className="ft-button ft-button--quiet" onClick={() => { setFiles([]); setOutputs([]); setErrors([]); setProgress(''); }} disabled={working}>Clear</button></div>
      {progress && <p className="ft-status" role="status">{progress}</p>}
      {outputs.length > 0 && <div className="ft-results" aria-label="Compressed PDFs">{outputs.map(({ sourceName, sourceSize, output }) => {
        const delta = sourceSize - output.blob.size;
        const ratio = sourceSize ? Math.round(Math.abs(delta) / sourceSize * 100) : 0;
        return <article className="ft-result" key={`${sourceName}-${output.fileName}`}><div><strong>{sourceName}</strong><small>{formatFileSize(sourceSize)} → {formatFileSize(output.blob.size)} · {delta >= 0 ? `${ratio}% smaller` : `${ratio}% larger`}</small></div><button type="button" className="ft-button" onClick={() => saveBlob(output.fileName, output.blob)}>Download</button></article>;
      })}</div>}
      {errors.length > 0 && <ul className="ft-errors" role="alert">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
    </section>
  );
}

type AnimationMode = 'images-to-gif' | 'video-to-gif' | 'animation-to-gif' | 'compress-gif' | 'animation-to-apng' | 'animation-to-mp4';

function AnimationWorkspace({ initialMode = 'images-to-gif', compressOnly = false, id = 'ft-animation-workspace' }: { initialMode?: AnimationMode; compressOnly?: boolean; id?: string }) {
  const [mode, setMode] = useState<AnimationMode>(initialMode);
  const [files, setFiles] = useState<File[]>([]);
  const [delayMs, setDelayMs] = useState(200);
  const [startSeconds, setStartSeconds] = useState('0');
  const [endSeconds, setEndSeconds] = useState('5');
  const [fps, setFps] = useState(10);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<ConvertedOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const multiple = mode === 'images-to-gif';
  const acceptsVideo = mode === 'video-to-gif';
  const acceptsStillSequence = multiple;
  const accepted = acceptsVideo
    ? 'video/*,.m4v,.mkv,.mov,.mp4,.m2ts,.mts,.ts,.webm'
    : acceptsStillSequence
      ? 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/heic,image/heif,image/svg+xml'
      : mode === 'compress-gif' ? 'image/gif,.gif' : 'image/gif,image/png,.gif,.png,.apng';
  const label: Record<AnimationMode, string> = {
    'images-to-gif': 'Make a GIF from images', 'video-to-gif': 'Convert a video clip to GIF',
    'animation-to-gif': 'Convert GIF or APNG to GIF', 'compress-gif': 'Compress an animated GIF',
    'animation-to-apng': 'Convert GIF or APNG to APNG', 'animation-to-mp4': 'Convert GIF or APNG to MP4',
  };
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (selected.length > MAX_CONVERTER_FILES || selected.some((file) => file.size > MAX_CONVERTER_FILE_BYTES)
      || selected.reduce((sum, file) => sum + file.size, 0) > MAX_ZIP_ARCHIVE_BYTES) {
      setError(`Choose up to ${MAX_CONVERTER_FILES} files, ${formatFileSize(MAX_CONVERTER_FILE_BYTES)} each and ${formatFileSize(MAX_ZIP_ARCHIVE_BYTES)} combined.`);
      return;
    }
    if (multiple && selected.some((file) => getSourceKind(file) !== 'image')) {
      setError('Choose supported still image files for a frame sequence.');
      return;
    }
    if (!multiple && selected.length > 1) {
      setError('Choose one animation or video at a time.');
      return;
    }
    setFiles(selected);
    setError(null);
    setResult(null);
    setProgress('');
  }
  async function process() {
    if (!files.length || working) return;
    if (multiple && files.length < 2) { setError('Choose at least two images to make a GIF.'); return; }
    setWorking(true);
    setError(null);
    setResult(null);
    setProgress('Preparing animation frames…');
    try {
      const onProgress = (done: number, total: number) => setProgress(`Processing frame ${done} of ${total}…`);
      const file = files[0]!;
      const output = mode === 'images-to-gif'
        ? await createGifFromImages(files, delayMs, onProgress)
        : mode === 'video-to-gif'
          ? await convertVideoToGif(file, { startSeconds: Number(startSeconds), endSeconds: Number(endSeconds), fps }, onProgress)
          : mode === 'animation-to-gif'
            ? await convertAnimatedImageToGif(file, onProgress)
            : mode === 'compress-gif'
              ? await compressAnimatedGif(file, onProgress)
              : mode === 'animation-to-apng'
                ? await convertAnimatedImageToApng(file, onProgress)
                : await convertAnimatedImageToMp4(file, onProgress);
      setResult(output);
      setProgress('Finished locally.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Animation processing failed.');
      setProgress('');
    } finally {
      setWorking(false);
    }
  }
  return (
    <section id={id} className="ft-panel" aria-labelledby="ft-animation-title" tabIndex={-1}>
      <div className="ft-panel-heading"><div><p className="ft-kicker">GIF & ANIMATION TOOLS</p><h2 id="ft-animation-title">Create, convert, and compress animations</h2></div><span className="ft-local-tag">Browser processing</span></div>
      <p className="ft-copy">Build a GIF from stills, turn a short video into a GIF, convert GIF/APNG animations, or resize and re-encode a GIF. Animated-image decoding requires a current browser that supports the WebCodecs ImageDecoder API.</p>
      <label className="ft-inline-label">Animation tool<select value={mode} onChange={(event) => { setMode(event.target.value as AnimationMode); setFiles([]); setResult(null); setError(null); setProgress(''); }} disabled={working || compressOnly}>{compressOnly ? <option value="compress-gif">Compress an animated GIF</option> : <><option value="images-to-gif">Images to GIF</option><option value="video-to-gif">Video clip to GIF</option><option value="animation-to-gif">GIF/APNG to GIF</option><option value="compress-gif">Compress GIF</option><option value="animation-to-apng">GIF/APNG to APNG</option><option value="animation-to-mp4">GIF/APNG to MP4</option></>}</select></label>
      <label className="ft-file-picker"><span>{multiple ? 'Choose image frames' : acceptsVideo ? 'Choose a video clip' : 'Choose one animation'}</span><input type="file" accept={accepted} multiple={multiple} onChange={choose} disabled={working} /><small>{multiple ? `2–${MAX_ANIMATION_FRAMES} frames · ${formatFileSize(MAX_CONVERTER_FILE_BYTES)} per file` : `One file · ${formatFileSize(MAX_CONVERTER_FILE_BYTES)} maximum`}</small></label>
      {files.length > 0 && <p className="ft-selected">{files.length === 1 ? files[0]!.name : `${files.length} image frames`} · {formatFileSize(files.reduce((sum, file) => sum + file.size, 0))}</p>}
      {mode === 'images-to-gif' && <label className="ft-inline-label">Delay per frame<select value={delayMs} onChange={(event) => setDelayMs(Number(event.target.value))} disabled={working}><option value="80">80 ms · fast</option><option value="120">120 ms</option><option value="200">200 ms · balanced</option><option value="400">400 ms · slow</option><option value="800">800 ms</option></select></label>}
      {mode === 'video-to-gif' && <div className="ft-settings-grid"><label>Start (seconds)<input type="number" min="0" step="0.1" value={startSeconds} onChange={(event) => setStartSeconds(event.target.value)} disabled={working} /></label><label>End (seconds)<input type="number" min="0.1" step="0.1" value={endSeconds} onChange={(event) => setEndSeconds(event.target.value)} disabled={working} /><small>Clips are limited to 10 seconds and 12 frames per second.</small></label><label>Frame rate<select value={fps} onChange={(event) => setFps(Number(event.target.value))} disabled={working}><option value="5">5 fps · smaller</option><option value="8">8 fps</option><option value="10">10 fps · balanced</option><option value="12">12 fps</option></select></label></div>}
      <div className="ft-actions"><button type="button" className="ft-button ft-button--primary" onClick={() => void process()} disabled={!files.length || (multiple && files.length < 2) || working}>{working ? 'Processing…' : label[mode]}</button><button type="button" className="ft-button ft-button--quiet" onClick={() => { setFiles([]); setResult(null); setError(null); setProgress(''); }} disabled={working}>Clear</button></div>
      {progress && <p className="ft-status" role="status">{progress}</p>}
      {result && <article className="ft-result ft-result--single" role="status"><div><strong>{result.fileName}</strong><small>{formatFileSize(result.blob.size)} output · dimensions/frame count depend on the selected conversion.</small></div><button type="button" className="ft-button" onClick={() => saveBlob(result.fileName, result.blob)}>Download</button></article>}
      {error && <p className="ft-error" role="alert">{error}</p>}
      <p className="ft-hint">Browser limits: maximum 120 frames, 480 px maximum dimension, 30 seconds of animation, 10 seconds for video-to-GIF, and 250 MiB output. MP4 requires browser H.264 encoding; source codecs vary by device.</p>
    </section>
  );
}

function ImageResizeTool() {
  const [file, setFile] = useState<File | null>(null);
  const [width, setWidth] = useState('1600');
  const [height, setHeight] = useState('1600');
  const [format, setFormat] = useState<RasterOutputFormat>('webp');
  const [quality, setQuality] = useState(88);
  const [allowUpscale, setAllowUpscale] = useState(false);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<ConvertedOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const next = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    if (next && (getSourceKind(next) !== 'image' || next.size > MAX_CONVERTER_FILE_BYTES)) {
      setFile(null);
      setError('Choose a supported image no larger than 25 MiB.');
      return;
    }
    setFile(next);
    setResult(null);
    setError(null);
  }
  async function resize() {
    if (!file || working) return;
    setWorking(true);
    setResult(null);
    setError(null);
    try { setResult(await resizeImageFile(file, Number(width), Number(height), format, quality, allowUpscale)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Image resize failed.'); }
    finally { setWorking(false); }
  }
  return (
    <section id="ft-image-resizer" className="ft-panel" aria-labelledby="ft-image-resize-title" tabIndex={-1}>
      <div className="ft-panel-heading"><div><p className="ft-kicker">IMAGE RESIZER</p><h2 id="ft-image-resize-title">Resize images to exact bounds</h2></div><span className="ft-local-tag">On this device</span></div>
      <p className="ft-copy">The image keeps its aspect ratio and fits inside your requested width and height. Outputs are limited to 8,192 px per side and 32 megapixels.</p>
      <label className="ft-file-picker"><span>Choose one image</span><input type="file" accept="image/png,image/jpeg,image/jfif,image/webp,image/gif,image/bmp,image/avif,image/heic,image/heif,image/svg+xml" onChange={choose} disabled={working} /><small>One supported image · 25 MiB maximum</small></label>
      {file && <p className="ft-selected">{file.name} · {formatFileSize(file.size)}</p>}
      <div className="ft-settings-grid"><label>Maximum width (px)<input type="number" min="1" max="8192" value={width} onChange={(event) => setWidth(event.target.value)} disabled={working} /></label><label>Maximum height (px)<input type="number" min="1" max="8192" value={height} onChange={(event) => setHeight(event.target.value)} disabled={working} /></label><label>Output format<select value={format} onChange={(event) => setFormat(event.target.value as RasterOutputFormat)} disabled={working}><option value="webp">WebP</option><option value="jpeg">JPEG</option><option value="png">PNG</option></select></label>{format !== 'png' && <label>Quality <span className="ft-range-value">{quality}%</span><input type="range" min="20" max="100" value={quality} onChange={(event) => setQuality(Number(event.target.value))} disabled={working} /></label>}<label className="ft-checkbox-label"><input type="checkbox" checked={allowUpscale} onChange={(event) => setAllowUpscale(event.target.checked)} disabled={working} /> Allow enlarging smaller images (up to 4×)</label></div>
      <div className="ft-actions"><button type="button" className="ft-button ft-button--primary" onClick={() => void resize()} disabled={!file || working}>{working ? 'Resizing…' : 'Resize image'}</button><button type="button" className="ft-button ft-button--quiet" onClick={() => { setFile(null); setResult(null); setError(null); }} disabled={working}>Clear</button></div>
      {result && <article className="ft-result ft-result--single"><div><strong>{result.fileName}</strong><small>{formatFileSize(result.blob.size)}</small></div><button type="button" className="ft-button" onClick={() => saveBlob(result.fileName, result.blob)}>Download</button></article>}
      {error && <p className="ft-error" role="alert">{error}</p>}
    </section>
  );
}

function PdfWorkspace({ initialOperation = 'merge' }: { initialOperation?: PdfOperation }) {
  const [operation, setOperation] = useState<PdfOperation>(initialOperation);
  const [files, setFiles] = useState<File[]>([]);
  const [pages, setPages] = useState('1');
  const [order, setOrder] = useState('');
  const [rotation, setRotation] = useState<90 | 180 | 270>(90);
  const [geometry, setGeometry] = useState({ x: 0, y: 0, width: 400, height: 600 });
  const [userPassword, setUserPassword] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<(PdfToolResult | ConvertedOutput) | null>(null);
  const [error, setError] = useState<string | null>(null);

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (selected.length > MAX_CONVERTER_FILES || selected.some((file) => getSourceKind(file) !== 'pdf' || file.size > MAX_CONVERTER_FILE_BYTES)) {
      setError(`Choose up to ${MAX_CONVERTER_FILES} PDFs, no larger than ${formatFileSize(MAX_CONVERTER_FILE_BYTES)} each.`);
      return;
    }
    setFiles(selected);
    setResult(null);
    setError(null);
  }

  async function apply() {
    if (!files.length || working) return;
    setWorking(true);
    setResult(null);
    setError(null);
    try {
      const completed = operation === 'merge'
        ? await mergePdfFiles(files)
        : operation === 'protect'
          ? await protectPdfFile(files[0]!, userPassword, ownerPassword || userPassword)
          : operation === 'unlock'
            ? await unlockPdfFile(files[0]!, unlockPassword)
            : await editPdfFile(files[0]!, operation, pages, rotation, order, geometry);
      setResult(completed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The PDF operation failed.');
    } finally {
      setWorking(false);
    }
  }

  const needsMany = operation === 'merge';
  const operationLabels: Record<PdfOperation, string> = {
    merge: 'Merge PDFs', extract: 'Extract selected pages', remove: 'Remove selected pages', rotate: 'Rotate selected pages', reorder: 'Reorder all pages',
    flatten: 'Flatten form fields', crop: 'Crop selected pages', resize: 'Resize selected pages', protect: 'Protect PDF', unlock: 'Unlock PDF',
  };
  const pageSelectionNeeded = ['extract', 'remove', 'rotate', 'crop', 'resize'].includes(operation);
  return (
    <section id="ft-pdf-tools" className="ft-panel" aria-labelledby="ft-pdf-tools-title" tabIndex={-1}>
      <div className="ft-panel-heading"><div><p className="ft-kicker">PDF TOOLS</p><h2 id="ft-pdf-tools-title">Merge and organize pages</h2></div><span className="ft-local-tag">Browser-only</span></div>
      <p className="ft-copy">Merge, extract, remove, rotate, reorder, crop, resize, or flatten PDF pages. You can also protect and unlock files locally with AES-256; a changed PDF may invalidate existing digital signatures.</p>
      <label className="ft-inline-label">PDF action<select value={operation} onChange={(event) => { setOperation(event.target.value as PdfOperation); setFiles([]); setResult(null); setError(null); }}><option value="merge">Merge PDFs</option><option value="extract">Extract selected pages</option><option value="remove">Remove selected pages</option><option value="rotate">Rotate selected pages</option><option value="reorder">Reorder all pages</option><option value="crop">Crop selected pages</option><option value="resize">Resize selected pages</option><option value="flatten">Flatten form fields</option><option value="protect">Password-protect PDF</option><option value="unlock">Unlock password-protected PDF</option></select></label>
      <label className="ft-file-picker"><span>{needsMany ? 'Choose PDFs in page order' : 'Choose one PDF'}</span><input type="file" accept="application/pdf,.pdf" multiple={needsMany} onChange={chooseFiles} disabled={working} /><small>{needsMany ? 'Select at least 2 PDFs; selected order is the merge order.' : 'One PDF · up to 25 pages · 25 MiB maximum.'}</small></label>
      {files.length > 0 && <p className="ft-selected">{files.map((file) => file.name).join(' · ')}</p>}
      {!needsMany && pageSelectionNeeded && <label className="ft-inline-label">Page range<input type="text" value={pages} onChange={(event) => setPages(event.target.value)} placeholder="1-3, 5" /><small>Examples: 1-3, 5. Leave blank to select all pages.</small></label>}
      {!needsMany && operation === 'reorder' && <label className="ft-inline-label">New page order<input type="text" value={order} onChange={(event) => setOrder(event.target.value)} placeholder="3, 1, 2" /><small>List every page exactly once. For a 3-page file, “3, 1, 2” moves page 3 to the front.</small></label>}
      {operation === 'rotate' && <label className="ft-inline-label">Clockwise rotation<select value={rotation} onChange={(event) => setRotation(Number(event.target.value) as 90 | 180 | 270)}><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label>}
      {operation === 'crop' && <div className="ft-settings-grid"><label>Left offset (pt)<input type="number" min="0" value={geometry.x} onChange={(event) => setGeometry((current) => ({ ...current, x: Number(event.target.value) }))} /></label><label>Bottom offset (pt)<input type="number" min="0" value={geometry.y} onChange={(event) => setGeometry((current) => ({ ...current, y: Number(event.target.value) }))} /></label><label>Crop width (pt)<input type="number" min="1" value={geometry.width} onChange={(event) => setGeometry((current) => ({ ...current, width: Number(event.target.value) }))} /></label><label>Crop height (pt)<input type="number" min="1" value={geometry.height} onChange={(event) => setGeometry((current) => ({ ...current, height: Number(event.target.value) }))} /></label><p className="ft-hint">PDF units are points; 72 pt equals 1 inch. Crop bounds must fit every selected page.</p></div>}
      {operation === 'resize' && <div className="ft-settings-grid"><label>Page width (pt)<input type="number" min="72" max="14400" value={geometry.width} onChange={(event) => setGeometry((current) => ({ ...current, width: Number(event.target.value) }))} /></label><label>Page height (pt)<input type="number" min="72" max="14400" value={geometry.height} onChange={(event) => setGeometry((current) => ({ ...current, height: Number(event.target.value) }))} /></label><p className="ft-hint">PDF units are points; 72 pt equals 1 inch. Page content and annotations are scaled.</p></div>}
      {operation === 'protect' && <div className="ft-settings-grid"><label>Open password<input type="password" autoComplete="new-password" maxLength={128} value={userPassword} onChange={(event) => setUserPassword(event.target.value)} /></label><label>Owner password<input type="password" autoComplete="new-password" maxLength={128} value={ownerPassword} onChange={(event) => setOwnerPassword(event.target.value)} /><small>Leave blank to use the open password for both.</small></label><p className="ft-hint">AES-256 encryption is performed on your device. Keep the password safe; it cannot be recovered.</p></div>}
      {operation === 'unlock' && <label className="ft-inline-label">Current PDF password<input type="password" autoComplete="current-password" maxLength={128} value={unlockPassword} onChange={(event) => setUnlockPassword(event.target.value)} /></label>}
      <div className="ft-actions"><button type="button" className="ft-button ft-button--primary" onClick={() => void apply()} disabled={!files.length || (operation === 'merge' && files.length < 2) || (operation === 'protect' && !userPassword) || (operation === 'unlock' && !unlockPassword) || working}>{working ? 'Working…' : operationLabels[operation]}</button><button type="button" className="ft-button ft-button--quiet" onClick={() => { setFiles([]); setResult(null); setError(null); }} disabled={working}>Clear</button></div>
      {result && <article className="ft-result ft-result--single" role="status"><div><strong>{result.fileName}</strong><small>{'pageCount' in result ? `${result.pageCount} page${result.pageCount === 1 ? '' : 's'} · ` : ''}{formatFileSize(result.blob.size)}</small></div><button type="button" className="ft-button" onClick={() => saveBlob(result.fileName, result.blob)}>Download PDF</button></article>}
      {error && <p className="ft-error" role="alert">{error}</p>}
    </section>
  );
}

function MediaConverter({ kind }: { kind: LocalMediaKind }) {
  const formats: Array<{ id: LocalMediaFormat; label: string }> = kind === 'audio'
    ? [{ id: 'mp3', label: 'MP3 — compressed, widely compatible' }, { id: 'wav', label: 'WAV — uncompressed PCM' }, { id: 'flac', label: 'FLAC — lossless' }, { id: 'ogg', label: 'OGG / Opus — compressed' }]
    : [{ id: 'mp4', label: 'MP4 — H.264 video' }, { id: 'webm', label: 'WebM — VP9 video' }];
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<LocalMediaFormat>(kind === 'audio' ? 'mp3' : 'webm');
  const [quality, setQuality] = useState(65);
  const [bitrate, setBitrate] = useState(128_000);
  const [trimStart, setTrimStart] = useState('');
  const [trimEnd, setTrimEnd] = useState('');
  const [cropLeft, setCropLeft] = useState('');
  const [cropTop, setCropTop] = useState('');
  const [cropWidth, setCropWidth] = useState('');
  const [cropHeight, setCropHeight] = useState('');
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<ConvertedOutput | null>(null);
  const [sourceSize, setSourceSize] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const accepted = kind === 'audio'
    ? 'audio/*,.aac,.flac,.m4a,.m4b,.m4v,.mkv,.mov,.mp3,.mp4,.m2ts,.mts,.ts,.oga,.ogg,.opus,.wav,.wave,.webm'
    : 'video/*,.m4v,.mkv,.mov,.mp4,.m2ts,.mts,.ts,.webm';

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const next = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    setFile(next);
    setSourceSize(next?.size ?? 0);
    setResult(null);
    setError(null);
    setProgress('');
  }

  async function process() {
    if (!file || working) return;
    const start = trimStart.trim() ? Number(trimStart) : undefined;
    const end = trimEnd.trim() ? Number(trimEnd) : undefined;
    const cropValues = [cropLeft, cropTop, cropWidth, cropHeight];
    const cropProvided = kind === 'video' && cropValues.some((value) => value.trim() !== '');
    if ((start !== undefined && (!Number.isFinite(start) || start < 0)) || (end !== undefined && (!Number.isFinite(end) || end <= 0))) {
      setError('Enter valid non-negative trim times in seconds.');
      return;
    }
    if (cropProvided && cropValues.some((value) => value.trim() === '' || !Number.isFinite(Number(value)))) {
      setError('Enter left, top, width, and height to crop the video, or clear all four values.');
      return;
    }
    const crop = cropProvided ? {
      left: Number(cropLeft), top: Number(cropTop), width: Number(cropWidth), height: Number(cropHeight),
    } : undefined;
    const mediaOptions = {
      quality,
      audioBitrate: bitrate,
      ...(start !== undefined ? { trimStart: start } : {}),
      ...(end !== undefined ? { trimEnd: end } : {}),
      ...(crop ? { crop } : {}),
    };
    setWorking(true);
    setResult(null);
    setError(null);
    setProgress('Preparing browser codecs…');
    try {
      const converted = await convertLocalMedia(file, kind, format, mediaOptions, (fraction) => {
        setProgress(`Processing locally · ${Math.round(fraction * 100)}%`);
      });
      setResult(converted);
      setProgress('Finished on this device.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Media processing failed.');
      setProgress('');
    } finally {
      setWorking(false);
    }
  }

  const delta = result ? sourceSize - result.blob.size : 0;
  const percent = sourceSize ? Math.round(Math.abs(delta) / sourceSize * 100) : 0;
  return (
    <section id={`ft-${kind}-converter`} className="ft-panel" aria-labelledby={`ft-${kind}-converter-title`} tabIndex={-1}>
      <div className="ft-panel-heading"><div><p className="ft-kicker">{kind.toUpperCase()} · BROWSER CODECS</p><h2 id={`ft-${kind}-converter-title`}>{kind === 'audio' ? 'Convert and compress audio' : 'Convert and compress video'}</h2></div><span className="ft-local-tag">Local processing</span></div>
      <p className="ft-copy">{kind === 'audio' ? 'Convert audio to MP3, WAV, FLAC, or OGG/Opus. MP3 and Opus use the selected bitrate; WAV and FLAC are uncompressed/lossless.' : 'Transcode video to MP4/H.264 or WebM/VP9, with a quality control. The primary audio track is retained when the selected browser encoder supports it.'} Files remain in this browser; codec support depends on this device and browser.</p>
      {kind === 'audio' && <p className="ft-hint">MP3 output uses the open-source <a href="https://www.mp3dev.org/" target="_blank" rel="noreferrer">LAME encoder</a> (LGPL-2.0-or-later); <a href="https://lame.sourceforge.io/" target="_blank" rel="noreferrer">license and project details</a>.</p>}
      <label className="ft-file-picker"><span>Choose one {kind} file</span><input type="file" accept={accepted} onChange={choose} disabled={working} /><small>Maximum {formatFileSize(MAX_CONVERTER_FILE_BYTES)} · up to 10 minutes · output capped at 250 MiB</small></label>
      {file && <p className="ft-selected">{file.name} · {formatFileSize(file.size)}</p>}
      <div className="ft-settings-grid">
        <label>Output format<select value={format} onChange={(event) => { setFormat(event.target.value as LocalMediaFormat); setResult(null); }} disabled={working}>{formats.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
        {kind === 'audio' && (format === 'mp3' || format === 'ogg')
          ? <label>Audio bitrate<select value={bitrate} onChange={(event) => setBitrate(Number(event.target.value))} disabled={working}><option value="96000">96 kbps · smaller</option><option value="128000">128 kbps · balanced</option><option value="192000">192 kbps · higher quality</option><option value="256000">256 kbps · largest</option></select><small>Lower bitrate usually reduces the output size.</small></label>
          : kind === 'video'
            ? <label>Video quality <span className="ft-range-value">{quality}%</span><input type="range" min="25" max="95" value={quality} onChange={(event) => setQuality(Number(event.target.value))} disabled={working} /><small>Lower quality usually reduces file size; output size depends on the source.</small></label>
            : <p className="ft-hint">WAV is uncompressed. FLAC preserves decoded audio losslessly.</p>}
      </div>
      {kind === 'video' && <details className="ft-advanced-media"><summary>Trim or crop video (optional)</summary><p className="ft-hint">Times are in seconds. Crop values are pixels from the left/top of the displayed video frame.</p><div className="ft-settings-grid"><label>Start time (seconds)<input type="number" min="0" step="0.1" value={trimStart} onChange={(event) => setTrimStart(event.target.value)} disabled={working} /></label><label>End time (seconds)<input type="number" min="0.1" step="0.1" value={trimEnd} onChange={(event) => setTrimEnd(event.target.value)} disabled={working} /></label><label>Crop left (px)<input type="number" min="0" step="1" value={cropLeft} onChange={(event) => setCropLeft(event.target.value)} disabled={working} /></label><label>Crop top (px)<input type="number" min="0" step="1" value={cropTop} onChange={(event) => setCropTop(event.target.value)} disabled={working} /></label><label>Crop width (px)<input type="number" min="1" step="1" value={cropWidth} onChange={(event) => setCropWidth(event.target.value)} disabled={working} /></label><label>Crop height (px)<input type="number" min="1" step="1" value={cropHeight} onChange={(event) => setCropHeight(event.target.value)} disabled={working} /></label></div></details>}
      <div className="ft-actions"><button type="button" className="ft-button ft-button--primary" onClick={() => void process()} disabled={!file || working}>{working ? 'Processing…' : `Convert ${kind}`}</button><button type="button" className="ft-button ft-button--quiet" onClick={() => { setFile(null); setResult(null); setError(null); setProgress(''); setTrimStart(''); setTrimEnd(''); setCropLeft(''); setCropTop(''); setCropWidth(''); setCropHeight(''); }} disabled={working}>Clear</button></div>
      {progress && <p className="ft-status" role="status">{progress}</p>}
      {result && <article className="ft-result ft-result--single" role="status"><div><strong>{result.fileName}</strong><small>{formatFileSize(sourceSize)} → {formatFileSize(result.blob.size)} · {delta >= 0 ? `${percent}% smaller` : `${percent}% larger`}</small></div><button type="button" className="ft-button" onClick={() => saveBlob(result.fileName, result.blob)}>Download</button></article>}
      {error && <p className="ft-error" role="alert">{error}</p>}
    </section>
  );
}

function DocumentWorkspace({ initialFormat = 'pdf', id = 'ft-document-workspace' }: { initialFormat?: 'docx' | 'pdf' | 'txt'; id?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<'docx' | 'pdf' | 'txt'>(initialFormat);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<ConvertedOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pdfInput = file?.name.toLowerCase().endsWith('.pdf') ?? false;
  const docxInput = file?.name.toLowerCase().endsWith('.docx') ?? false;

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const next = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    setFile(next);
    const isPdf = next?.name.toLowerCase().endsWith('.pdf') ?? false;
    const isDocx = next?.name.toLowerCase().endsWith('.docx') ?? false;
    setFormat(isPdf && initialFormat === 'pdf' ? 'docx' : isDocx && initialFormat === 'docx' ? 'pdf' : initialFormat);
    setResult(null);
    setError(null);
  }

  async function convert() {
    if (!file || working) return;
    setWorking(true);
    setResult(null);
    setError(null);
    try {
      if (format === 'pdf') setResult(await convertDocumentToPdf(file));
      else if (format === 'docx') setResult(await convertDocumentToDocx(file));
      else setResult(await extractDocumentText(file));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Document conversion failed.');
    } finally {
      setWorking(false);
    }
  }

  const outputHint = format === 'docx'
    ? 'Creates an editable .docx from extracted text; original page layout, images, and table styling are not retained.'
    : format === 'pdf'
      ? 'Creates a simple text-based PDF; Word styling, images, and table layout are not retained.'
      : pdfInput
        ? 'Exports selectable PDF text only. Scanned or image-only PDFs require OCR, which is not offered.'
        : 'Exports readable text from the selected document or ebook.';

  return (
    <section id={id} className="ft-panel" aria-labelledby="ft-document-tool-title" tabIndex={-1}>
      <div className="ft-panel-heading"><div><p className="ft-kicker">WORD & PDF CONVERTER</p><h2 id="ft-document-tool-title">Convert Word documents and PDFs</h2></div><span className="ft-local-tag">Browser-only</span></div>
      <p className="ft-copy">Convert Word (.docx) files to PDF, or export selectable PDF text to an editable Word (.docx) document. Also supports plain text, Markdown, CSV, JSON, HTML, ODT, and EPUB. These text-based conversions do not preserve the original layout, images, or full styling; PDF extraction is not OCR.</p>
      <label className="ft-file-picker"><span>Choose a document or ebook</span><input type="file" accept=".pdf,.txt,.md,.markdown,.csv,.json,.log,.html,.htm,.docx,.odt,.epub,text/*,application/pdf" onChange={choose} disabled={working} /><small>Maximum {formatFileSize(MAX_CONVERTER_FILE_BYTES)} · PDF text extraction supports up to {MAX_PDF_PAGES} pages</small></label>
      {file && <p className="ft-selected">{file.name} · {formatFileSize(file.size)}</p>}
      <div className="ft-settings-grid"><label>Output format<select value={format} onChange={(event) => setFormat(event.target.value as 'docx' | 'pdf' | 'txt')} disabled={working}><option value="pdf" disabled={pdfInput}>PDF document</option><option value="docx" disabled={docxInput}>Word document (.docx)</option><option value="txt">Plain text (.txt)</option></select><small>{outputHint}</small></label></div>
      <div className="ft-actions"><button type="button" className="ft-button ft-button--primary" onClick={() => void convert()} disabled={!file || working}>{working ? 'Converting…' : format === 'pdf' ? 'Convert to PDF' : format === 'docx' ? 'Convert to Word' : 'Extract text'}</button></div>
      {result && <article className="ft-result ft-result--single" role="status"><div><strong>{result.fileName}</strong><small>{formatFileSize(result.blob.size)} · generated locally</small></div><button type="button" className="ft-button" onClick={() => saveBlob(result.fileName, result.blob)}>Download</button></article>}
      {error && <p className="ft-error" role="alert">{error}</p>}
    </section>
  );
}

function ArchiveWorkspace({ initialMode = 'extract' }: { initialMode?: 'extract' | 'create' }) {
  const [mode, setMode] = useState<'extract' | 'create'>(initialMode);
  const [files, setFiles] = useState<File[]>([]);
  const [outputs, setOutputs] = useState<ConvertedOutput[]>([]);
  const [result, setResult] = useState<ConvertedOutput | null>(null);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    setOutputs([]);
    setResult(null);
    setError(null);
    if (mode === 'extract') {
      if (selected.length > 1 || (selected[0] && !selected[0].name.toLowerCase().endsWith('.zip'))) {
        setFiles([]);
        setError('Choose one ZIP archive.');
        return;
      }
      if (selected[0] && selected[0].size > MAX_CONVERTER_FILE_BYTES) {
        setFiles([]);
        setError(`ZIP files are limited to ${formatFileSize(MAX_CONVERTER_FILE_BYTES)}.`);
        return;
      }
    } else {
      if (selected.length > MAX_CONVERTER_FILES) {
        setFiles([]);
        setError(`Choose up to ${MAX_CONVERTER_FILES} files per archive.`);
        return;
      }
      const tooLarge = selected.find((candidate) => candidate.size > MAX_CONVERTER_FILE_BYTES);
      if (tooLarge) {
        setFiles([]);
        setError(`“${tooLarge.name}” exceeds the ${formatFileSize(MAX_CONVERTER_FILE_BYTES)} file limit.`);
        return;
      }
      if (selected.reduce((sum, candidate) => sum + candidate.size, 0) > MAX_ZIP_ARCHIVE_BYTES) {
        setFiles([]);
        setError(`ZIP inputs are limited to ${formatFileSize(MAX_ZIP_ARCHIVE_BYTES)} combined.`);
        return;
      }
    }
    setFiles(selected);
  }

  async function run() {
    if (!files.length || working) return;
    setWorking(true);
    setError(null);
    setResult(null);
    setOutputs([]);
    setProgress(mode === 'create' ? 'Compressing selected files…' : 'Reading ZIP archive…');
    try {
      if (mode === 'extract') setOutputs(await extractZipArchive(files[0]!));
      else {
        const archive = await createCompressedZipArchive(files, (completed, total) => setProgress(`Adding file ${completed} of ${total}…`));
        setResult({ fileName: 'cloudhost247-archive.zip', blob: archive });
      }
      setProgress('Archive task finished locally.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Archive processing failed.');
      setProgress('');
    } finally {
      setWorking(false);
    }
  }

  async function downloadExtractedZip() {
    try {
      const archive = await createZipArchive(outputs);
      saveBlob('cloudhost247-extracted-files.zip', archive);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not package the extracted files.');
    }
  }

  return (
    <section id="ft-archive-tools" className="ft-panel" aria-labelledby="ft-archive-tool-title" tabIndex={-1}>
      <div className="ft-panel-heading"><div><p className="ft-kicker">ARCHIVE TOOLS</p><h2 id="ft-archive-tool-title">Create or extract ZIP files</h2></div><span className="ft-local-tag">No filesystem writes</span></div>
      <p className="ft-copy">Build a DEFLATE-compressed ZIP from selected files or extract a local ZIP archive. Extraction stays in the page and is protected against unsafe paths and unusually large expansion.</p>
      <label className="ft-inline-label">Archive action<select value={mode} onChange={(event) => { setMode(event.target.value as 'extract' | 'create'); setFiles([]); setOutputs([]); setResult(null); setError(null); }} disabled={working}><option value="extract">Extract ZIP</option><option value="create">Create ZIP</option></select></label>
      <label className="ft-file-picker"><span>{mode === 'extract' ? 'Choose one ZIP archive' : 'Choose files to add to ZIP'}</span><input type="file" accept={mode === 'extract' ? '.zip,application/zip' : undefined} multiple={mode === 'create'} onChange={choose} disabled={working} /><small>{mode === 'extract' ? 'Maximum 25 MiB compressed · up to 100 files · 250 MiB expanded' : `Up to ${MAX_CONVERTER_FILES} files · ${formatFileSize(MAX_CONVERTER_FILE_BYTES)} each · ${formatFileSize(MAX_ZIP_ARCHIVE_BYTES)} combined`}</small></label>
      {files.length > 0 && <p className="ft-selected">{files.map((candidate) => candidate.name).join(' · ')}</p>}
      <div className="ft-actions"><button type="button" className="ft-button ft-button--primary" onClick={() => void run()} disabled={!files.length || working}>{working ? 'Working…' : mode === 'extract' ? 'Extract ZIP' : 'Create ZIP'}</button><button type="button" className="ft-button ft-button--quiet" onClick={() => { setFiles([]); setOutputs([]); setResult(null); setError(null); setProgress(''); }}>Clear</button></div>
      {progress && <p className="ft-status" role="status">{progress}</p>}
      {result && <article className="ft-result ft-result--single" role="status"><div><strong>{result.fileName}</strong><small>{formatFileSize(result.blob.size)} · created locally</small></div><button type="button" className="ft-button" onClick={() => saveBlob(result.fileName, result.blob)}>Download ZIP</button></article>}
      {outputs.length > 0 && <><p className="ft-status" role="status">Extracted {outputs.length} file{outputs.length === 1 ? '' : 's'} locally. Duplicate names were renamed to avoid overwriting.</p><div className="ft-results" aria-label="Extracted files">{outputs.map((output) => <article className="ft-result" key={output.fileName}><div><strong>{output.fileName}</strong><small>{formatFileSize(output.blob.size)}</small></div><button type="button" className="ft-button" onClick={() => saveBlob(output.fileName, output.blob)}>Download</button></article>)}</div><div className="ft-actions"><button type="button" className="ft-button" onClick={() => void downloadExtractedZip()}>Download extracted files as ZIP</button></div></>}
      {error && <p className="ft-error" role="alert">{error}</p>}
    </section>
  );
}

function GzipWorkspace({ initialOperation = 'compress' }: { initialOperation?: 'compress' | 'extract' }) {
  const [operation, setOperation] = useState<'compress' | 'extract'>(initialOperation);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ConvertedOutput | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const next = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    setFile(next);
    setResult(null);
    setError(null);
    if (next && operation === 'extract' && !/\.(gz|gzip)$/i.test(next.name)) setError('Choose a .gz or .gzip file.');
  }

  async function run() {
    if (!file || working) return;
    setWorking(true);
    setResult(null);
    setError(null);
    try {
      setResult(await processGzipFile(file, operation));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'GZIP processing failed.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <section id="ft-gzip-tools" className="ft-panel" aria-labelledby="ft-gzip-tool-title" tabIndex={-1}>
      <div className="ft-panel-heading"><div><p className="ft-kicker">GZIP ARCHIVE TOOL</p><h2 id="ft-gzip-tool-title">Compress or expand a .gz file</h2></div><span className="ft-local-tag">Local file</span></div>
      <p className="ft-copy">Create a GZIP-compressed copy of any file or expand one GZIP stream. The uncompressed output is limited to 250 MiB.</p>
      <label className="ft-inline-label">GZIP action<select value={operation} onChange={(event) => { setOperation(event.target.value as 'compress' | 'extract'); setFile(null); setResult(null); setError(null); }} disabled={working}><option value="compress">Compress file to .gz</option><option value="extract">Expand .gz or .gzip</option></select></label>
      <label className="ft-file-picker"><span>{operation === 'compress' ? 'Choose a file to compress' : 'Choose a GZIP file'}</span><input type="file" accept={operation === 'extract' ? '.gz,.gzip,application/gzip' : undefined} onChange={choose} disabled={working} /><small>Maximum input {formatFileSize(MAX_CONVERTER_FILE_BYTES)}</small></label>
      {file && <p className="ft-selected">{file.name} · {formatFileSize(file.size)}</p>}
      <div className="ft-actions"><button type="button" className="ft-button ft-button--primary" onClick={() => void run()} disabled={!file || Boolean(error) || working}>{working ? 'Working…' : operation === 'compress' ? 'Create GZIP' : 'Expand GZIP'}</button></div>
      {result && <article className="ft-result ft-result--single" role="status"><div><strong>{result.fileName}</strong><small>{formatFileSize(result.blob.size)} · processed locally</small></div><button type="button" className="ft-button" onClick={() => saveBlob(result.fileName, result.blob)}>Download</button></article>}
      {error && <p className="ft-error" role="alert">{error}</p>}
    </section>
  );
}

const UNIT_GROUPS = {
  length: [{ id: 'm', label: 'Metres (m)', factor: 1 }, { id: 'km', label: 'Kilometres (km)', factor: 1000 }, { id: 'cm', label: 'Centimetres (cm)', factor: 0.01 }, { id: 'mm', label: 'Millimetres (mm)', factor: 0.001 }, { id: 'mi', label: 'Miles (mi)', factor: 1609.344 }, { id: 'ft', label: 'Feet (ft)', factor: 0.3048 }, { id: 'in', label: 'Inches (in)', factor: 0.0254 }],
  mass: [{ id: 'kg', label: 'Kilograms (kg)', factor: 1 }, { id: 'g', label: 'Grams (g)', factor: 0.001 }, { id: 'mg', label: 'Milligrams (mg)', factor: 0.000001 }, { id: 'lb', label: 'Pounds (lb)', factor: 0.45359237 }, { id: 'oz', label: 'Ounces (oz)', factor: 0.028349523125 }],
  temperature: [{ id: 'c', label: 'Celsius (°C)' }, { id: 'f', label: 'Fahrenheit (°F)' }, { id: 'k', label: 'Kelvin (K)' }],
  data: [{ id: 'b', label: 'Bytes (B)', factor: 1 }, { id: 'kb', label: 'Kilobytes (KB)', factor: 1000 }, { id: 'mb', label: 'Megabytes (MB)', factor: 1_000_000 }, { id: 'gb', label: 'Gigabytes (GB)', factor: 1_000_000_000 }, { id: 'kib', label: 'Kibibytes (KiB)', factor: 1024 }, { id: 'mib', label: 'Mebibytes (MiB)', factor: 1_048_576 }, { id: 'gib', label: 'Gibibytes (GiB)', factor: 1_073_741_824 }],
  duration: [{ id: 's', label: 'Seconds', factor: 1 }, { id: 'ms', label: 'Milliseconds', factor: 0.001 }, { id: 'min', label: 'Minutes', factor: 60 }, { id: 'h', label: 'Hours', factor: 3600 }, { id: 'd', label: 'Days', factor: 86_400 }, { id: 'wk', label: 'Weeks', factor: 604_800 }],
  volume: [{ id: 'l', label: 'Litres (L)', factor: 1 }, { id: 'ml', label: 'Millilitres (mL)', factor: 0.001 }, { id: 'm3', label: 'Cubic metres (m³)', factor: 1000 }, { id: 'gal', label: 'US gallons (gal)', factor: 3.785411784 }, { id: 'cup', label: 'US cups', factor: 0.2365882365 }],
  area: [{ id: 'm2', label: 'Square metres (m²)', factor: 1 }, { id: 'km2', label: 'Square kilometres (km²)', factor: 1_000_000 }, { id: 'ha', label: 'Hectares (ha)', factor: 10_000 }, { id: 'acre', label: 'Acres', factor: 4046.8564224 }, { id: 'ft2', label: 'Square feet (ft²)', factor: 0.09290304 }],
  speed: [{ id: 'ms', label: 'Metres per second (m/s)', factor: 1 }, { id: 'kmh', label: 'Kilometres per hour (km/h)', factor: 1 / 3.6 }, { id: 'mph', label: 'Miles per hour (mph)', factor: 0.44704 }, { id: 'kn', label: 'Knots (kn)', factor: 0.5144444444 }],
  pressure: [{ id: 'pa', label: 'Pascals (Pa)', factor: 1 }, { id: 'kpa', label: 'Kilopascals (kPa)', factor: 1000 }, { id: 'bar', label: 'Bar', factor: 100_000 }, { id: 'atm', label: 'Atmospheres (atm)', factor: 101_325 }, { id: 'psi', label: 'Pounds per square inch (psi)', factor: 6894.757293 }],
  energy: [{ id: 'j', label: 'Joules (J)', factor: 1 }, { id: 'kj', label: 'Kilojoules (kJ)', factor: 1000 }, { id: 'cal', label: 'Calories (cal)', factor: 4.184 }, { id: 'kcal', label: 'Kilocalories (kcal)', factor: 4184 }, { id: 'wh', label: 'Watt-hours (Wh)', factor: 3600 }, { id: 'kwh', label: 'Kilowatt-hours (kWh)', factor: 3_600_000 }, { id: 'btu', label: 'British thermal units (BTU)', factor: 1055.055852 }],
  power: [{ id: 'w', label: 'Watts (W)', factor: 1 }, { id: 'kw', label: 'Kilowatts (kW)', factor: 1000 }, { id: 'mw', label: 'Megawatts (MW)', factor: 1_000_000 }, { id: 'hp', label: 'Mechanical horsepower (hp)', factor: 745.699872 }],
  dataRate: [{ id: 'bps', label: 'Bits per second (bit/s)', factor: 1 }, { id: 'kbps', label: 'Kilobits per second (kbit/s)', factor: 1000 }, { id: 'mbps', label: 'Megabits per second (Mbit/s)', factor: 1_000_000 }, { id: 'gbps', label: 'Gigabits per second (Gbit/s)', factor: 1_000_000_000 }, { id: 'kibps', label: 'Kibibits per second (Kibit/s)', factor: 1024 }, { id: 'mibps', label: 'Mebibits per second (Mibit/s)', factor: 1_048_576 }],
  frequency: [{ id: 'hz', label: 'Hertz (Hz)', factor: 1 }, { id: 'khz', label: 'Kilohertz (kHz)', factor: 1000 }, { id: 'mhz', label: 'Megahertz (MHz)', factor: 1_000_000 }, { id: 'ghz', label: 'Gigahertz (GHz)', factor: 1_000_000_000 }],
  angle: [{ id: 'deg', label: 'Degrees (°)', factor: 1 }, { id: 'rad', label: 'Radians (rad)', factor: 180 / Math.PI }, { id: 'grad', label: 'Gradians (gon)', factor: 0.9 }, { id: 'turn', label: 'Turns', factor: 360 }],
  force: [{ id: 'n', label: 'Newtons (N)', factor: 1 }, { id: 'kn', label: 'Kilonewtons (kN)', factor: 1000 }, { id: 'lbf', label: 'Pound-force (lbf)', factor: 4.448221615 }],
} as const;
type UnitCategory = keyof typeof UNIT_GROUPS;

function UnitTimeWorkspace({ initialCategory = 'length' }: { initialCategory?: UnitCategory }) {
  const [category, setCategory] = useState<UnitCategory>(initialCategory);
  const [value, setValue] = useState('1');
  const [from, setFrom] = useState<string>(UNIT_GROUPS[initialCategory][0].id);
  const [to, setTo] = useState<string>(UNIT_GROUPS[initialCategory][1].id);
  const [dateTime, setDateTime] = useState('');
  const [timestamp, setTimestamp] = useState('');
  const unitOptions = UNIT_GROUPS[category];
  const sourceUnit = unitOptions.find((unit) => unit.id === from) ?? unitOptions[0];
  const targetUnit = unitOptions.find((unit) => unit.id === to) ?? unitOptions[1];
  let converted: number | null = null;
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && value.trim() !== '') {
    if (category === 'temperature') {
      const kelvin = from === 'c' ? numericValue + 273.15 : from === 'f' ? (numericValue - 32) * 5 / 9 + 273.15 : numericValue;
      converted = to === 'c' ? kelvin - 273.15 : to === 'f' ? (kelvin - 273.15) * 9 / 5 + 32 : kelvin;
    } else {
      const sourceFactor = 'factor' in sourceUnit ? sourceUnit.factor : 1;
      const targetFactor = 'factor' in targetUnit ? targetUnit.factor : 1;
      converted = numericValue * sourceFactor / targetFactor;
    }
  }
  const selectedDate = dateTime ? new Date(dateTime) : null;
  const localEpochMs = selectedDate && Number.isFinite(selectedDate.getTime()) ? selectedDate.getTime() : null;
  const timestampValue = Number(timestamp);
  const timestampDate = timestamp.trim() && Number.isFinite(timestampValue)
    ? new Date(Math.abs(timestampValue) < 100_000_000_000 ? timestampValue * 1000 : timestampValue)
    : null;
  const outputDate = timestampDate && Number.isFinite(timestampDate.getTime()) ? timestampDate : null;

  return (
    <section id="ft-unit-time-tools" className="ft-panel" aria-labelledby="ft-units-time-title" tabIndex={-1}>
      <div className="ft-panel-heading"><div><p className="ft-kicker">UNIT & TIME</p><h2 id="ft-units-time-title">Convert units and timestamps</h2></div><span className="ft-local-tag">Instant calculation</span></div>
      <p className="ft-copy">Unit and date calculations happen in this page and do not use an API.</p>
      <h3 id="ft-unit-converter" className="ft-subheading" tabIndex={-1}>Unit converter</h3>
      <div className="ft-settings-grid">
        <label>Category<select value={category} onChange={(event) => { const next = event.target.value as UnitCategory; setCategory(next); setFrom(UNIT_GROUPS[next][0].id); setTo(UNIT_GROUPS[next][1].id); }}><option value="length">Length</option><option value="area">Area</option><option value="volume">Volume</option><option value="mass">Mass</option><option value="temperature">Temperature</option><option value="speed">Speed</option><option value="pressure">Pressure</option><option value="energy">Energy</option><option value="power">Power</option><option value="force">Force</option><option value="data">Digital storage</option><option value="dataRate">Data rate</option><option value="frequency">Frequency</option><option value="angle">Angle</option><option value="duration">Duration</option></select></label>
        <label>Value<input type="number" value={value} onChange={(event) => setValue(event.target.value)} /></label>
        <label>From<select value={from} onChange={(event) => setFrom(event.target.value)}>{unitOptions.map((unit) => <option value={unit.id} key={unit.id}>{unit.label}</option>)}</select></label>
        <label>To<select value={to} onChange={(event) => setTo(event.target.value)}>{unitOptions.map((unit) => <option value={unit.id} key={unit.id}>{unit.label}</option>)}</select></label>
      </div>
      <p className="ft-conversion-result" aria-live="polite">{converted === null ? 'Enter a valid number.' : `${numericValue.toLocaleString()} ${sourceUnit.label} = ${new Intl.NumberFormat(undefined, { maximumSignificantDigits: 12 }).format(converted)} ${targetUnit.label}`}</p>
      <h3 id="ft-date-timestamp" className="ft-subheading" tabIndex={-1}>Date & Unix timestamp</h3>
      <div className="ft-settings-grid">
        <label>Local date and time<input type="datetime-local" value={dateTime} onChange={(event) => setDateTime(event.target.value)} /><small>Your browser's local time zone is used.</small></label>
        <label>Unix timestamp (seconds or milliseconds)<input type="number" value={timestamp} onChange={(event) => setTimestamp(event.target.value)} placeholder="e.g. 1735689600" /></label>
      </div>
      {localEpochMs !== null && <p className="ft-conversion-result">{Math.floor(localEpochMs / 1000)} seconds · {localEpochMs} milliseconds · {new Date(localEpochMs).toISOString()}</p>}
      {timestamp.trim() && <p className="ft-conversion-result">{outputDate ? `${outputDate.toLocaleString()} · ${outputDate.toISOString()}` : 'Enter a valid Unix timestamp.'}</p>}
    </section>
  );
}

function ImageColorPicker() {
  const [file, setFile] = useState<File | null>(null);
  const [sample, setSample] = useState<{ hex: string; rgb: string } | null>(null);
  const previewUrl = useObjectUrl(file);
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const next = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    if (next && (getSourceKind(next) !== 'image' || next.size > MAX_CONVERTER_FILE_BYTES)) {
      setFile(null);
      setSample(null);
      return;
    }
    setFile(next);
    setSample(null);
  }
  function samplePixel(event: MouseEvent<HTMLImageElement>) {
    const image = event.currentTarget;
    const bounds = image.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = Math.max(0, Math.min(image.naturalWidth - 1, Math.floor((event.clientX - bounds.left) / bounds.width * image.naturalWidth)));
    const y = Math.max(0, Math.min(image.naturalHeight - 1, Math.floor((event.clientY - bounds.top) / bounds.height * image.naturalHeight)));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    try {
      context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
      const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
      setSample({ hex: `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`, rgb: `rgb(${red}, ${green}, ${blue})` });
    } catch {
      setSample(null);
    } finally {
      canvas.width = canvas.height = 0;
    }
  }
  return (
    <section id="ft-image-color-picker" className="ft-panel" aria-labelledby="ft-color-picker-title" tabIndex={-1}>
      <div className="ft-panel-heading"><div><p className="ft-kicker">IMAGE COLOR PICKER</p><h2 id="ft-color-picker-title">Sample a pixel color</h2></div><span className="ft-local-tag">Local file</span></div>
      <p className="ft-copy">Choose an image, then click a pixel to inspect its color. Your image stays in this browser tab.</p>
      <label className="ft-file-picker ft-file-picker--compact"><span>Choose an image</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif" onChange={choose} /><small>Maximum {formatFileSize(MAX_CONVERTER_FILE_BYTES)}</small></label>
      {previewUrl && <><img className="ft-color-preview" src={previewUrl} alt="Click the image to sample a pixel color" onClick={samplePixel} /><p className="ft-hint">Click anywhere in the preview.</p></>}
      {sample && <div className="ft-color-value"><span className="ft-color-swatch" style={{ backgroundColor: sample.hex }} /><div><strong>{sample.hex}</strong><small>{sample.rgb}</small></div><button type="button" className="ft-button" onClick={() => void navigator.clipboard?.writeText(sample.hex)}>Copy HEX</button></div>}
      {file && !previewUrl && <p className="ft-status" role="status">Loading local preview…</p>}
    </section>
  );
}

type ApiOperation = 'image.convert' | 'image.compress' | 'image.resize' | 'image.crop' | 'image.rotate' | 'gif.compress' | 'pdf.merge' | 'pdf.extract' | 'pdf.remove' | 'pdf.rotate' | 'pdf.reorder' | 'pdf.crop' | 'pdf.resize' | 'pdf.flatten' | 'pdf.compress' | 'document.to-pdf' | 'document.extract-text' | 'archive.create-zip' | 'archive.extract-zip' | 'archive.gzip' | 'archive.gunzip';

const API_OPERATION_CHOICES: Array<{ id: ApiOperation; label: string; endpoint: string; multiple?: boolean }> = [
  { id: 'image.convert', label: 'Convert image', endpoint: '/api/v1/file-tools/convert/image' },
  { id: 'image.compress', label: 'Compress image', endpoint: '/api/v1/file-tools/compress/image' },
  { id: 'image.resize', label: 'Resize image', endpoint: '/api/v1/file-tools/resize/image' },
  { id: 'image.crop', label: 'Crop image', endpoint: '/api/v1/file-tools/crop/image' },
  { id: 'image.rotate', label: 'Rotate / flip image', endpoint: '/api/v1/file-tools/rotate/image' },
  { id: 'gif.compress', label: 'Compress animated GIF', endpoint: '/api/v1/file-tools/compress/gif' },
  { id: 'pdf.merge', label: 'Merge PDFs', endpoint: '/api/v1/file-tools/convert/pdf/merge', multiple: true },
  { id: 'pdf.extract', label: 'Extract PDF pages', endpoint: '/api/v1/file-tools/convert/pdf/extract' },
  { id: 'pdf.remove', label: 'Remove PDF pages', endpoint: '/api/v1/file-tools/convert/pdf/remove-pages' },
  { id: 'pdf.rotate', label: 'Rotate PDF pages', endpoint: '/api/v1/file-tools/convert/pdf/rotate' },
  { id: 'pdf.reorder', label: 'Reorder PDF pages', endpoint: '/api/v1/file-tools/convert/pdf/reorder' },
  { id: 'pdf.crop', label: 'Crop PDF pages', endpoint: '/api/v1/file-tools/convert/pdf/crop' },
  { id: 'pdf.resize', label: 'Resize PDF pages', endpoint: '/api/v1/file-tools/convert/pdf/resize' },
  { id: 'pdf.flatten', label: 'Flatten PDF forms', endpoint: '/api/v1/file-tools/convert/pdf/flatten' },
  { id: 'pdf.compress', label: 'Compress PDF', endpoint: '/api/v1/file-tools/compress/pdf' },
  { id: 'document.to-pdf', label: 'Text / HTML to PDF', endpoint: '/api/v1/file-tools/convert/document/pdf' },
  { id: 'document.extract-text', label: 'Extract document text', endpoint: '/api/v1/file-tools/convert/document/text' },
  { id: 'archive.create-zip', label: 'Create ZIP archive', endpoint: '/api/v1/file-tools/convert/archive/zip', multiple: true },
  { id: 'archive.extract-zip', label: 'Safely extract ZIP', endpoint: '/api/v1/file-tools/extract/archive/zip' },
  { id: 'archive.gzip', label: 'Compress as GZIP', endpoint: '/api/v1/file-tools/compress/archive/gzip' },
  { id: 'archive.gunzip', label: 'Decompress GZIP', endpoint: '/api/v1/file-tools/decompress/archive/gzip' },
];

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  return btoa(binary);
}

function ApiSection() {
  const [capabilities, setCapabilities] = useState<Record<string, unknown> | null>(null);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [operation, setOperation] = useState<ApiOperation>('image.compress');
  const [files, setFiles] = useState<File[]>([]);
  const [options, setOptions] = useState<Record<string, string | number | boolean>>({ format: 'webp', quality: 76, width: 2048, height: 2048, pages: '1', rotation: 90, dpi: 110, level: 6, colors: 128, allowUpscale: false });
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState('');
  const [outputName, setOutputName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const selection = API_OPERATION_CHOICES.find((item) => item.id === operation)!;
  const multiple = Boolean(selection.multiple);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/file-tools/capabilities')
      .then(async (response) => {
        if (!response.ok) throw new Error(`Capabilities endpoint returned ${response.status}.`);
        return response.json() as Promise<Record<string, unknown>>;
      })
      .then((data) => { if (!cancelled) setCapabilities(data); })
      .catch((reason: Error) => { if (!cancelled) setCapabilityError(reason.message); });
    return () => { cancelled = true; };
  }, []);

  function setOption(key: string, value: string | number | boolean) { setOptions((current) => ({ ...current, [key]: value })); }
  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (selected.length > (multiple ? 20 : 1)) { setError(`Choose ${multiple ? 'up to 20 files' : 'one file'} for this operation.`); return; }
    const tooLarge = selected.find((file) => file.size > 8 * 1024 * 1024);
    if (tooLarge) { setError(`“${tooLarge.name}” exceeds the API's 8 MiB per-file limit.`); return; }
    if (selected.reduce((sum, file) => sum + file.size, 0) > 16 * 1024 * 1024) { setError('Combined API input is limited to 16 MiB per job.'); return; }
    setFiles(selected);
    setError(null);
    setOutputName('');
    setStatus('');
  }
  async function createJob() {
    if (!files.length || working) return;
    if (operation === 'pdf.merge' && files.length < 2) { setError('Choose at least two PDFs to merge.'); return; }
    setWorking(true);
    setError(null);
    setOutputName('');
    setStatus('Encoding files for the API…');
    try {
      const apiFiles = await Promise.all(files.map(async (file) => ({ fileName: file.name, contentType: file.type || 'application/octet-stream', dataBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) })));
      const response = await fetch(selection.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: apiFiles, options }) });
      const created = await response.json() as { success?: boolean; message?: string; error?: string; jobId?: string; status?: string; statusUrl?: string; downloadUrl?: string | null };
      if (!response.ok || !created.jobId || !created.statusUrl) throw new Error(created.message ?? created.error ?? `API request failed (${response.status}).`);
      setStatus(`Job ${created.jobId} queued. Waiting for processing…`);
      let finished: { status: string; error?: string | null; output?: { fileName?: string } | null; downloadUrl?: string | null } | null = null;
      for (let attempt = 0; attempt < 180; attempt += 1) {
        const statusResponse = await fetch(created.statusUrl, { cache: 'no-store' });
        if (!statusResponse.ok) throw new Error(`Could not read job status (${statusResponse.status}).`);
        const current = await statusResponse.json() as { status: string; error?: string | null; output?: { fileName?: string } | null; downloadUrl?: string | null };
        if (current?.status === 'completed' || current?.status === 'failed') { finished = current; break; }
        setStatus(`Job ${created.jobId} · ${current?.status ?? 'processing'}…`);
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      if (!finished) throw new Error('The job is still processing. Its status and download links remain available for 15 minutes.');
      if (finished.status !== 'completed') throw new Error(finished.error ?? 'The file API could not process this input.');
      const downloadUrl = finished.downloadUrl ?? created.downloadUrl;
      if (!downloadUrl) throw new Error('The API job completed without a download link.');
      const download = await fetch(downloadUrl, { cache: 'no-store' });
      if (!download.ok) throw new Error(`Could not download the output (${download.status}).`);
      const blob = await download.blob();
      const fileName = finished.output?.fileName ?? `${files[0]!.name}.out`;
      saveBlob(fileName, blob);
      setOutputName(`${fileName} · ${formatFileSize(blob.size)}`);
      setStatus('Complete. The download has started; the server copy expires after 15 minutes.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the API job.');
      setStatus('');
    } finally { setWorking(false); }
  }

  const numberOption = (key: string, label: string, minimum: number, maximum: number, step = 1) => <label key={key}>{label}<input type="number" min={minimum} max={maximum} step={step} value={String(options[key] ?? '')} onChange={(event) => setOption(key, Number(event.target.value))} disabled={working} /></label>;
  const sampleFiles = (files.length ? files : [{ name: 'input-file', type: 'application/octet-stream' } as File]).map((file) => ({ fileName: file.name, contentType: file.type || 'application/octet-stream', dataBase64: '<BASE64_FILE_BYTES>' }));
  const snippet = `const response = await fetch('${selection.endpoint}', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    files: ${JSON.stringify(sampleFiles, null, 4).replace(/^/gm, '    ').trim()},\n    options: ${JSON.stringify(options, null, 4).replace(/^/gm, '    ').trim()}\n  })\n});\nconst job = await response.json();\n// Poll job.statusUrl until status is "completed", then GET job.downloadUrl.\nconsole.log(job);`;
  const apiPaths = API_OPERATION_CHOICES.map(({ endpoint, label }) => ({ endpoint, label }));

  return (
    <div className="ft-column">
      <section id="ft-api-job-builder" className="ft-panel" aria-labelledby="ft-api-title" tabIndex={-1}>
        <div className="ft-panel-heading"><div><p className="ft-kicker">DEVELOPER API</p><h2 id="ft-api-title">Build and run a File Tools API job</h2></div><span className="ft-local-tag">REST · asynchronous</span></div>
        <p className="ft-copy">Create a real server-side conversion, editing, archive, or compression job. Unlike browser-local tools, API requests upload Base64 file contents to this server for temporary in-memory processing. Do not submit sensitive files unless your deployment policy permits it.</p>
        <div className="ft-notice"><strong>API privacy & limits.</strong> Files are not written to permanent storage and job outputs expire after 15 minutes. Maximum 8 MiB per file, 16 MiB decoded input per job, 64 MiB output, 20 files per job, and 20 submissions per minute per IP. No API key or paid plan is configured.</div>
        <div className="ft-settings-grid">
          <label>Operation<select value={operation} onChange={(event) => { setOperation(event.target.value as ApiOperation); setFiles([]); setError(null); setOutputName(''); setStatus(''); }} disabled={working}>{API_OPERATION_CHOICES.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select><small>Each operation calls its specific documented endpoint.</small></label>
          <label className="ft-file-picker"><span>{multiple ? 'Choose input files' : 'Choose one input file'}</span><input type="file" multiple={multiple} onChange={chooseFiles} disabled={working} /><small>{multiple ? 'Up to 20 files · 8 MiB each · 16 MiB total' : 'One file · 8 MiB maximum'}</small></label>
        </div>
        {files.length > 0 && <p className="ft-selected">{files.map((file) => `${file.name} (${formatFileSize(file.size)})`).join(' · ')}</p>}
        {(operation === 'image.convert' || operation === 'image.compress') && <div className="ft-settings-grid"><label>Output format<select value={String(options.format)} onChange={(event) => setOption('format', event.target.value)} disabled={working}><option value="webp">WebP</option><option value="jpeg">JPEG</option><option value="png">PNG</option><option value="avif">AVIF</option><option value="tiff">TIFF</option></select></label>{numberOption('quality', 'Quality (%)', 20, 100)}{numberOption('width', 'Maximum width (px)', 1, 8192)}{numberOption('height', 'Maximum height (px)', 1, 8192)}</div>}
        {operation === 'image.resize' && <div className="ft-settings-grid">{numberOption('width', 'Maximum width (px)', 1, 8192)}{numberOption('height', 'Maximum height (px)', 1, 8192)}<label><input type="checkbox" checked={Boolean(options.allowUpscale)} onChange={(event) => setOption('allowUpscale', event.target.checked)} disabled={working} /> Allow upscaling</label><label>Quality (%)<input type="number" min="20" max="100" value={String(options.quality)} onChange={(event) => setOption('quality', Number(event.target.value))} disabled={working} /></label></div>}
        {operation === 'image.crop' && <div className="ft-settings-grid">{numberOption('left', 'Left (px)', 0, 8191)}{numberOption('top', 'Top (px)', 0, 8191)}{numberOption('width', 'Crop width (px)', 1, 8192)}{numberOption('height', 'Crop height (px)', 1, 8192)}</div>}
        {operation === 'image.rotate' && <div className="ft-settings-grid"><label>Rotation<select value={String(options.rotation)} onChange={(event) => setOption('rotation', Number(event.target.value))} disabled={working}><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label><label><input type="checkbox" checked={Boolean(options.flip)} onChange={(event) => setOption('flip', event.target.checked)} disabled={working} /> Flip vertically</label><label><input type="checkbox" checked={Boolean(options.flop)} onChange={(event) => setOption('flop', event.target.checked)} disabled={working} /> Flip horizontally</label></div>}
        {operation === 'gif.compress' && <div className="ft-settings-grid">{numberOption('width', 'Maximum width (px)', 1, 480)}{numberOption('colors', 'Palette colors', 16, 256)}</div>}
        {['pdf.extract', 'pdf.remove', 'pdf.rotate', 'pdf.reorder', 'pdf.crop', 'pdf.resize'].includes(operation) && <label className="ft-inline-label">Page selection or order<input type="text" value={String(operation === 'pdf.reorder' ? options.order ?? '' : options.pages ?? '1')} onChange={(event) => setOption(operation === 'pdf.reorder' ? 'order' : 'pages', event.target.value)} placeholder={operation === 'pdf.reorder' ? '3, 1, 2' : '1-3, 5'} disabled={working} /><small>{operation === 'pdf.reorder' ? 'List every page exactly once.' : 'Page numbers start at 1; blank selects all pages.'}</small></label>}
        {(operation === 'pdf.crop' || operation === 'pdf.resize') && <div className="ft-settings-grid">{operation === 'pdf.crop' && <>{numberOption('x', 'Left offset (pt)', 0, 14400)}{numberOption('y', 'Bottom offset (pt)', 0, 14400)}</>}{numberOption('width', operation === 'pdf.crop' ? 'Crop width (pt)' : 'Page width (pt)', 1, 14400)}{numberOption('height', operation === 'pdf.crop' ? 'Crop height (pt)' : 'Page height (pt)', 1, 14400)}</div>}
        {operation === 'pdf.compress' && <div className="ft-settings-grid">{numberOption('quality', 'JPEG quality (%)', 25, 95)}{numberOption('dpi', 'Rendering resolution (DPI)', 72, 160)}</div>}
        {operation === 'pdf.rotate' && <label className="ft-inline-label">Clockwise rotation<select value={String(options.rotation)} onChange={(event) => setOption('rotation', Number(event.target.value))} disabled={working}><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label>}
        {operation === 'archive.gzip' && <label className="ft-inline-label">GZIP compression level<select value={String(options.level)} onChange={(event) => setOption('level', Number(event.target.value))} disabled={working}><option value="1">1 · fastest</option><option value="6">6 · balanced</option><option value="9">9 · smallest</option></select></label>}
        <div className="ft-actions"><button type="button" className="ft-button ft-button--primary" onClick={() => void createJob()} disabled={!files.length || (operation === 'pdf.merge' && files.length < 2) || working}>{working ? 'Processing…' : `Run ${selection.label.toLowerCase()}`}</button><button type="button" className="ft-button ft-button--quiet" onClick={() => { setFiles([]); setError(null); setOutputName(''); setStatus(''); }} disabled={working}>Clear</button></div>
        {status && <p className="ft-status" role="status">{status}</p>}{outputName && <p className="ft-conversion-result">Downloaded: {outputName}</p>}{error && <p className="ft-error" role="alert">{error}</p>}
        <h3 className="ft-subheading">Generated API request</h3><pre className="ft-code"><code>{snippet}</code></pre><button type="button" className="ft-button" onClick={() => void navigator.clipboard?.writeText(snippet)}>Copy JavaScript</button>
      </section>
      <section className="ft-panel" aria-labelledby="ft-api-docs-title">
        <div className="ft-panel-heading"><div><p className="ft-kicker">API DOCUMENTATION</p><h2 id="ft-api-docs-title">Asynchronous jobs & specific endpoints</h2></div><span className="ft-local-tag">OpenAPI 3.1</span></div>
        <p className="ft-copy">Post to the selected operation endpoint (or use <code>POST /api/v1/file-tools/jobs</code> with an <code>operation</code> field), poll the returned <code>statusUrl</code>, then GET the completed job's <code>downloadUrl</code>. Job IDs are random UUIDs; status and file data are no longer available after the expiry time.</p>
        <div className="ft-api-endpoint"><span>GET</span><code>/api/v1/file-tools/openapi.json</code><a className="ft-button" href="/api/v1/file-tools/openapi.json" target="_blank" rel="noreferrer">Open OpenAPI JSON</a></div>
        <div className="ft-api-endpoint"><span>GET</span><code>/api/v1/file-tools/docs</code><a className="ft-button" href="/api/v1/file-tools/docs" target="_blank" rel="noreferrer">Read full docs</a></div>
        <h3 className="ft-subheading">Specific conversion and compression APIs</h3><div className="ft-api-route-list">{apiPaths.map(({ endpoint, label }) => <div className="ft-api-route" key={endpoint}><span>POST</span><code>{endpoint}</code><small>{label}</small></div>)}</div>
        <h3 className="ft-subheading">Example job request</h3><pre className="ft-code"><code>{`POST /api/v1/file-tools/compress/image\nContent-Type: application/json\n\n{ "files": [{ "fileName": "photo.png", "dataBase64": "<BASE64>" }], "options": { "format": "webp", "quality": 76 } }`}</code></pre>
        <p className="ft-notice"><strong>Important limitations.</strong> PDF compression rasterizes each page into JPEG and removes text search, links, form fields, and signatures. Document text extraction is not OCR and does not preserve layout or embedded images. Media transcoding and video-to-GIF remain browser-local, not REST APIs.</p>
        {capabilities && <details className="ft-capabilities"><summary>Live capabilities response</summary><pre><code>{JSON.stringify(capabilities, null, 2)}</code></pre></details>}
        {capabilityError && <p className="ft-error" role="status">Could not load live capabilities: {capabilityError}</p>}
      </section>
    </div>
  );
}

function PricingSection() {
  return (
    <section className="ft-panel" aria-labelledby="ft-pricing-title">
      <div className="ft-panel-heading"><div><p className="ft-kicker">SIMPLE PRICING</p><h2 id="ft-pricing-title">File tools are free to use</h2></div><span className="ft-price-tag">$0</span></div>
      <p className="ft-copy">Browser-local tools are free. The REST API currently has no paid plan or account requirement; submissions are rate-limited and processed in temporary server memory rather than durable storage.</p>
      <div className="ft-price-grid">
        <article className="ft-price-card"><p className="ft-kicker">BROWSER TOOLS</p><h3>Free · always</h3><p>Use supported image/PDF, audio/video, document/ebook, archive, unit, and file utility tools without an account. Browser and codec compatibility can vary.</p><ul><li>Files stay in your browser</li><li>Up to {MAX_CONVERTER_FILES} files per batch</li><li>{formatFileSize(MAX_CONVERTER_FILE_BYTES)} maximum per file</li><li>PDF tools support up to {MAX_PDF_PAGES} pages per file</li></ul><Link className="ft-button ft-button--primary" to="/tools/file-converter">Start converting</Link></article>
        <article className="ft-price-card ft-price-card--muted"><p className="ft-kicker">DEVELOPER API</p><h3>No paid API plan yet</h3><p>File processing endpoints are available with published size and rate caps; no paid API tiers or API keys are configured.</p><ul><li>No API key for current endpoints</li><li>API files are uploaded for in-memory processing</li><li>Job data expires after 15 minutes</li></ul><Link className="ft-button" to="/tools/file-tools?tab=api">View API details</Link></article>
      </div>
      <p className="ft-hint">Limits protect browser memory and are not a paid-tier comparison. We will publish a price only if server-side processing or a billable API is introduced.</p>
    </section>
  );
}

interface QuickLaunchTool {
  id: string;
  title: string;
  description: string;
  section: Exclude<Section, 'overview' | 'pricing'>;
  targetId?: string;
  href?: string;
  pdfOperation?: PdfOperation;
  animationMode?: AnimationMode;
  documentFormat?: 'docx' | 'pdf' | 'txt';
  archiveMode?: 'create' | 'extract';
  gzipOperation?: 'compress' | 'extract';
}

const QUICK_TOOL_GROUPS: Array<{ title: string; tools: QuickLaunchTool[] }> = [
  {
    title: 'Images & PDFs',
    tools: [
      { id: 'image-pdf-converter', title: 'Image & PDF converter', description: 'Convert formats, crop, rotate, resize, and select PDF pages.', section: 'convert', href: '/tools/file-converter' },
      { id: 'image-compress', title: 'Compress images', description: 'Reduce image file size with local format and quality controls.', section: 'compress', targetId: 'ft-image-compressor' },
      { id: 'image-resize', title: 'Resize an image', description: 'Fit an image inside exact pixel bounds.', section: 'tools', targetId: 'ft-image-resizer' },
      { id: 'image-color', title: 'Pick a color from an image', description: 'Click a pixel to copy its HEX color.', section: 'tools', targetId: 'ft-image-color-picker' },
      { id: 'pdf-compress', title: 'Compress a PDF', description: 'Reduce size by rendering pages as optimized images.', section: 'compress', targetId: 'ft-pdf-compressor' },
      { id: 'pdf-merge', title: 'Merge PDFs', description: 'Combine multiple PDFs in the order you choose.', section: 'tools', targetId: 'ft-pdf-tools', pdfOperation: 'merge' },
      { id: 'pdf-extract', title: 'Extract PDF pages', description: 'Save selected pages to a new PDF.', section: 'tools', targetId: 'ft-pdf-tools', pdfOperation: 'extract' },
      { id: 'pdf-remove', title: 'Remove PDF pages', description: 'Delete selected pages from a PDF.', section: 'tools', targetId: 'ft-pdf-tools', pdfOperation: 'remove' },
      { id: 'pdf-rotate', title: 'Rotate PDF pages', description: 'Rotate selected pages by 90, 180, or 270 degrees.', section: 'tools', targetId: 'ft-pdf-tools', pdfOperation: 'rotate' },
      { id: 'pdf-reorder', title: 'Reorder PDF pages', description: 'Put every page in a new sequence.', section: 'tools', targetId: 'ft-pdf-tools', pdfOperation: 'reorder' },
      { id: 'pdf-crop', title: 'Crop PDF pages', description: 'Set a page region in PDF points.', section: 'tools', targetId: 'ft-pdf-tools', pdfOperation: 'crop' },
      { id: 'pdf-resize', title: 'Resize PDF pages', description: 'Set output page dimensions in PDF points.', section: 'tools', targetId: 'ft-pdf-tools', pdfOperation: 'resize' },
      { id: 'pdf-flatten', title: 'Flatten PDF forms', description: 'Make form fields non-editable.', section: 'tools', targetId: 'ft-pdf-tools', pdfOperation: 'flatten' },
      { id: 'pdf-protect', title: 'Password-protect a PDF', description: 'Encrypt a PDF locally with AES-256.', section: 'tools', targetId: 'ft-pdf-tools', pdfOperation: 'protect' },
      { id: 'pdf-unlock', title: 'Unlock a PDF', description: 'Remove a PDF password when you know it.', section: 'tools', targetId: 'ft-pdf-tools', pdfOperation: 'unlock' },
    ],
  },
  {
    title: 'Audio, video & animation',
    tools: [
      { id: 'audio-convert', title: 'Convert or compress audio', description: 'Choose MP3, WAV, FLAC, or OGG/Opus output.', section: 'convert', targetId: 'ft-audio-converter' },
      { id: 'video-convert', title: 'Convert or compress video', description: 'Transcode to MP4 or WebM; optional trim and crop.', section: 'convert', targetId: 'ft-video-converter' },
      { id: 'animation-create-gif', title: 'Create a GIF from images', description: 'Turn an ordered image sequence into an animation.', section: 'convert', targetId: 'ft-animation-tool', animationMode: 'images-to-gif' },
      { id: 'video-to-gif', title: 'Convert video to GIF', description: 'Create a short GIF from a video clip.', section: 'convert', targetId: 'ft-animation-tool', animationMode: 'video-to-gif' },
      { id: 'animation-to-gif', title: 'Convert GIF or APNG to GIF', description: 'Re-encode an animated image as a GIF.', section: 'convert', targetId: 'ft-animation-tool', animationMode: 'animation-to-gif' },
      { id: 'animation-compress-gif', title: 'Compress an animated GIF', description: 'Reduce dimensions and palette colors locally.', section: 'compress', targetId: 'ft-gif-compressor', animationMode: 'compress-gif' },
      { id: 'animation-to-apng', title: 'Convert GIF or APNG to APNG', description: 'Save an animated PNG output.', section: 'convert', targetId: 'ft-animation-tool', animationMode: 'animation-to-apng' },
      { id: 'animation-to-mp4', title: 'Convert GIF or APNG to MP4', description: 'Encode an animation as an H.264 video.', section: 'convert', targetId: 'ft-animation-tool', animationMode: 'animation-to-mp4' },
    ],
  },
  {
    title: 'Documents & archives',
    tools: [
      { id: 'document-to-pdf', title: 'Convert Word to PDF', description: 'Create a simple PDF from a Word (.docx) document.', section: 'convert', targetId: 'ft-document-converter', documentFormat: 'pdf' },
      { id: 'pdf-to-word', title: 'Convert PDF to Word', description: 'Export selectable PDF text to an editable Word (.docx) document.', section: 'convert', targetId: 'ft-document-converter', documentFormat: 'docx' },
      { id: 'document-extract-text', title: 'Extract document text', description: 'Export selectable text from supported documents and ebooks.', section: 'convert', targetId: 'ft-document-converter', documentFormat: 'txt' },
      { id: 'zip-create', title: 'Create a ZIP archive', description: 'Package selected local files into a compressed ZIP.', section: 'tools', targetId: 'ft-archive-tools', archiveMode: 'create' },
      { id: 'zip-extract', title: 'Extract a ZIP archive', description: 'Inspect and download files from a safe local ZIP.', section: 'tools', targetId: 'ft-archive-tools', archiveMode: 'extract' },
      { id: 'gzip-compress', title: 'Compress a file to GZIP', description: 'Create a .gz copy of a selected file.', section: 'tools', targetId: 'ft-gzip-tools', gzipOperation: 'compress' },
      { id: 'gzip-expand', title: 'Expand a GZIP file', description: 'Decompress a .gz or .gzip file.', section: 'tools', targetId: 'ft-gzip-tools', gzipOperation: 'extract' },
    ],
  },
  {
    title: 'Utilities & developer API',
    tools: [
      { id: 'unit-converter', title: 'Convert units', description: 'Convert length, area, mass, speed, data, energy, and more.', section: 'tools', targetId: 'ft-unit-converter' },
      { id: 'date-timestamp', title: 'Convert dates and timestamps', description: 'Convert local date/time and Unix seconds or milliseconds.', section: 'tools', targetId: 'ft-date-timestamp' },
      { id: 'rest-api-builder', title: 'Build a REST API job', description: 'Upload files for temporary server-side processing.', section: 'api', targetId: 'ft-api-job-builder' },
    ],
  },
];

const QUICK_TOOLS_BY_ID = new Map(QUICK_TOOL_GROUPS.flatMap((group) => group.tools.map((tool) => [tool.id, tool] as const)));

function OverviewSection({ onSelect, onLaunch }: { onSelect: (section: Section) => void; onLaunch: (toolId: string) => void }) {
  const cards: Array<{ id: Section; title: string; description: string; action: string }> = [
    { id: 'convert', title: 'Convert', description: 'Convert images, PDF pages, audio, video, documents, and ebooks locally.', action: 'Explore converters' },
    { id: 'compress', title: 'Compress', description: 'Reduce image, PDF, audio, or video size with browser-local controls.', action: 'Open compression tools' },
    { id: 'tools', title: 'Tools & utilities', description: 'Organize PDFs, work with ZIP files, extract document text, convert units, and inspect colors.', action: 'Explore tools' },
    { id: 'api', title: 'API', description: 'Build conversion jobs, use specific endpoints, and read the OpenAPI documentation.', action: 'View API' },
    { id: 'pricing', title: 'Pricing', description: 'See the free browser-local limits and what is not yet offered.', action: 'View pricing' },
  ];
  return (
    <div className="ft-overview">
      <section className="ft-card-grid" aria-label="File tools sections">
        {cards.map((card) => (
          <article className="ft-hub-card" key={card.id}>
            <span className="ft-hub-icon" aria-hidden="true">{card.id === 'convert' ? '↔' : card.id === 'compress' ? '↓' : card.id === 'tools' ? '✦' : card.id === 'api' ? '{ }' : '$'}</span>
            <p className="ft-kicker">{card.id === 'tools' ? 'TOOLS' : card.id.toUpperCase()}</p>
            <h2>{card.title}</h2><p>{card.description}</p>
            <button type="button" className="ft-button ft-button--primary" onClick={() => onSelect(card.id)}>{card.action} <span aria-hidden="true">→</span></button>
          </article>
        ))}
      </section>
      <section className="ft-quick-launch" aria-labelledby="ft-quick-launch-title">
        <div className="ft-quick-launch-heading"><div><p className="ft-kicker">QUICK LAUNCH</p><h2 id="ft-quick-launch-title">Every tool, one click away</h2></div><span>{QUICK_TOOL_GROUPS.reduce((total, group) => total + group.tools.length, 0)} tools</span></div>
        <p className="ft-copy">Choose a button to jump straight to that tool and its matching action. Browser-local tools keep files on your device; the REST API builder uploads files for temporary processing.</p>
        {QUICK_TOOL_GROUPS.map((group) => (
          <section className="ft-quick-group" aria-label={group.title} key={group.title}>
            <h3>{group.title}</h3>
            <div className="ft-quick-grid">
              {group.tools.map((tool) => (
                <button key={tool.id} type="button" className="ft-quick-button" aria-label={tool.title} onClick={() => onLaunch(tool.id)}>
                  <span>{tool.title}</span><small>{tool.description}</small><span className="ft-quick-arrow" aria-hidden="true">Open →</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </section>
      <aside className="ft-notice"><strong>Privacy choice.</strong> Browser tools never upload selected files. REST API jobs upload files for temporary in-memory processing and expire after 15 minutes. No Dropbox/Drive/OneDrive imports or remote URL fetching is enabled.</aside>
    </div>
  );
}

export default function FileToolsSuitePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const requested = searchParams.get('tab') as Section | null;
  const section: Section = SECTIONS.some((item) => item.id === requested) ? requested! : 'overview';
  const requestedTool = searchParams.get('tool');
  const candidateTool = requestedTool ? QUICK_TOOLS_BY_ID.get(requestedTool) : undefined;
  const activeTool = candidateTool?.section === section ? candidateTool : undefined;
  const setSection = (next: Section) => setSearchParams(next === 'overview' ? {} : { tab: next }, { replace: true });
  const launchTool = (toolId: string) => {
    const tool = QUICK_TOOLS_BY_ID.get(toolId);
    if (!tool) return;
    if (tool.href) {
      navigate(tool.href);
      return;
    }
    setSearchParams({ tab: tool.section, tool: tool.id });
  };
  useEffect(() => {
    if (!activeTool?.targetId) return;
    const timer = window.setTimeout(() => {
      const target = document.getElementById(activeTool.targetId!);
      if (!target) return;
      if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeTool?.id, activeTool?.targetId, section]);
  const title = section === 'overview' ? 'File Tools' : `${SECTIONS.find((item) => item.id === section)?.label ?? 'File Tools'} · File Tools`;
  usePageMeta(title, 'Convert, compress, and organize images, PDFs, media, documents, ebooks, animations and archives with browser-local tools or optional temporary REST API jobs.');
  const activeSection = useMemo(() => SECTIONS.find((item) => item.id === section)?.label ?? 'Overview', [section]);
  return (
    <main className="ft-page">
      <ToolSeo title={`${title} | CloudHost247`} description="Convert, compress and organize images, PDFs, media, documents, ebooks, animations and archives using browser-local tools or optional temporary REST API jobs." path="/tools/file-tools" />
      <div className="ft-shell">
        <nav className="ft-breadcrumb" aria-label="Breadcrumb"><Link to="/tools">Tools</Link><span aria-hidden="true">/</span><span aria-current="page">File Tools</span></nav>
        <header className="ft-hero">
          <div><p className="ft-kicker">CLOUDHOST247 · FILE WORKSPACE</p><h1>File Tools</h1><p>Convert, compress, and organize images, PDFs, audio, video, documents, ebooks, animations, and archives. Use browser-local tools or optional temporary REST API jobs.</p><div className="ft-hero-pills"><span>✓ No sign-in</span><span>✓ Browser-local option</span><span>✓ Free to use</span></div></div>
          <div className="ft-hero-art" aria-hidden="true"><span className="ft-art-card">PNG</span><span className="ft-art-arrow">↗</span><span className="ft-art-card ft-art-card--main">WEBP</span><span className="ft-art-card">PDF</span></div>
        </header>
        <nav className="ft-tabs" role="tablist" aria-label="File tools sections">{SECTIONS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={section === item.id} onClick={() => setSection(item.id)}>{item.label}</button>)}</nav>
        <div className="ft-section-heading"><div><p className="ft-kicker">{activeSection.toUpperCase()}</p><h2>{section === 'overview' ? 'Your files, your choice' : activeSection}</h2></div><span>{section === 'api' ? 'REST processing' : 'Runs locally'}</span></div>
        {section === 'overview' && <OverviewSection onSelect={setSection} onLaunch={launchTool} />}
        {section === 'convert' && <div className="ft-column"><div className="ft-tool-callout"><div><p className="ft-kicker">IMAGE & PDF</p><h2>Convert images and PDF pages</h2><p>Use established canvas/PDF controls for batch conversion, crops, resizing, page selection, rotation, and more.</p></div><Link className="ft-button ft-button--primary" to="/tools/file-converter">Open image & PDF converter ↗</Link></div><MediaConverter kind="audio" /><MediaConverter kind="video" /><AnimationWorkspace initialMode={activeTool?.animationMode ?? 'images-to-gif'} id="ft-animation-tool" /><DocumentWorkspace initialFormat={activeTool?.documentFormat ?? 'pdf'} id="ft-document-converter" /></div>}
        {section === 'compress' && <div className="ft-column"><ImageCompressor /><PdfCompressor /><MediaConverter kind="audio" /><MediaConverter kind="video" /><AnimationWorkspace initialMode={activeTool?.animationMode ?? 'compress-gif'} compressOnly id="ft-gif-compressor" /></div>}
        {section === 'tools' && <div className="ft-column"><div className="ft-tool-callout"><div><p className="ft-kicker">IMAGE EDITING</p><h2>Crop, resize, rotate, and flip</h2><p>Batch crop, rotate, flip, and resize controls are also available in the image converter’s advanced settings.</p></div><Link className="ft-button ft-button--primary" to="/tools/file-converter">Open image editor ↗</Link></div><ImageResizeTool /><ImageColorPicker /><PdfWorkspace initialOperation={activeTool?.pdfOperation ?? 'merge'} /><DocumentWorkspace initialFormat={activeTool?.documentFormat ?? 'pdf'} id="ft-document-tools" /><ArchiveWorkspace initialMode={activeTool?.archiveMode ?? 'extract'} /><GzipWorkspace initialOperation={activeTool?.gzipOperation ?? 'compress'} /><UnitTimeWorkspace /></div>}
        {section === 'api' && <ApiSection />}
        {section === 'pricing' && <PricingSection />}
        <footer className="ft-footer-note"><span>Browser tools stay local. API jobs upload files for temporary in-memory server processing; audio/video REST conversion is not enabled.</span><Link to="/tools/file-converter">Open image & PDF converter →</Link></footer>
      </div>
    </main>
  );
}
