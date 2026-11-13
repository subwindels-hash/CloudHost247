import { useState, type CSSProperties } from 'react';
import { readPngDpi, setPngDpi } from '../../../../src/tools/design-studio/render/png-meta';
import './studio-result.css';

/**
 * The result of a Design Studio tool (barcodes, labels, shipping labels, business cards).
 *
 * The API returns one shape for all of them: SVG previews at true physical size, the print files as
 * base64, a few facts and the notices a person should read before printing. This component shows
 * exactly that and nothing it was not given.
 *
 * Previews are rendered through <img>, never injected as markup, so an SVG can draw but cannot run
 * script. File types are checked against a short allow-list before a download is offered.
 */

export interface StudioFileView {
  name: string;
  mime: string;
  base64: string;
  bytes: number;
  label: string;
  hint?: string;
}

export interface StudioPreviewView {
  title: string;
  svg: string;
  widthMm: number;
  heightMm: number;
}

export interface StudioResultView {
  studio: true;
  title: string;
  previews: StudioPreviewView[];
  files: StudioFileView[];
  facts: Array<{ label: string; value: string }>;
  notices: string[];
  count: number;
}

const DOWNLOADABLE = new Set(['image/svg+xml', 'image/png', 'application/pdf', 'application/zip', 'text/vcard']);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function isStudioResult(value: unknown): value is StudioResultView {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.studio === true && Array.isArray(record.previews) && Array.isArray(record.files) && Array.isArray(record.facts) && Array.isArray(record.notices);
}

function isPreview(value: unknown): value is StudioPreviewView {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.svg === 'string' && record.svg.startsWith('<svg') && typeof record.widthMm === 'number' && typeof record.heightMm === 'number' && record.widthMm > 0 && record.heightMm > 0;
}

function isFile(value: unknown): value is StudioFileView {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === 'string' && typeof record.mime === 'string' && DOWNLOADABLE.has(record.mime) && typeof record.base64 === 'string' && BASE64.test(record.base64) && typeof record.label === 'string';
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

/** A file name that cannot carry a path, whatever the server sent. */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '');
  return cleaned === '' ? 'cloudhost247-download' : cleaned.slice(0, 120);
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeFileName(name);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked after the click has been handled; revoking at once cancels the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function fileBlob(file: StudioFileView): Blob {
  return new Blob([decodeBase64(file.base64)], { type: file.mime });
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatMm(value: number): string {
  return `${Math.round(value * 10) / 10}`;
}

const PNG_DPI = 300;

/**
 * Draw a preview onto a canvas at print resolution and declare that resolution in the file.
 *
 * A canvas writes pixels only. Without the resolution, a program that places the picture assumes
 * 72 or 96 dpi and the label comes out three to four times too large, so a file offered as
 * "300 dpi" has to say 300 dpi itself. If that cannot be written, no file is handed over.
 * The PDF remains the file to print from.
 */
async function previewToPng(preview: StudioPreviewView): Promise<Blob> {
  const image = new Image();
  image.decoding = 'async';
  image.src = svgDataUrl(preview.svg);
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((preview.widthMm / 25.4) * PNG_DPI));
  canvas.height = Math.max(1, Math.round((preview.heightMm / 25.4) * PNG_DPI));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw the image.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const drawn = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('This browser could not create the image.'))), 'image/png');
  });
  const stamped = setPngDpi(new Uint8Array(await drawn.arrayBuffer()), PNG_DPI);
  if (readPngDpi(stamped) !== PNG_DPI) throw new Error('This browser did not produce a PNG.');
  // A copy with its own buffer: `stamped` may be a view onto a larger one.
  return new Blob([stamped.slice().buffer], { type: 'image/png' });
}

export default function StudioResult({ value }: { value: StudioResultView }) {
  const [message, setMessage] = useState<string | null>(null);
  const previews = value.previews.filter(isPreview);
  const files = value.files.filter(isFile);
  const hasPng = files.some((file) => file.mime === 'image/png' || file.mime === 'application/zip');
  const first = previews[0];
  const pdf = files.find((file) => file.mime === 'application/pdf');

  function download(file: StudioFileView): void {
    try {
      saveBlob(fileBlob(file), file.name);
      setMessage(null);
    } catch {
      setMessage('The file could not be prepared. Generate it again and retry.');
    }
  }

  function openPdf(file: StudioFileView): void {
    try {
      const url = URL.createObjectURL(fileBlob(file));
      // A real link click rather than window.open: browsers treat it as the user's own navigation,
      // so it is not caught by pop-up blocking.
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setMessage(null);
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch {
      setMessage('The PDF could not be opened. Use the download button instead.');
    }
  }

  async function savePng(preview: StudioPreviewView): Promise<void> {
    try {
      const blob = await previewToPng(preview);
      const stem = (pdf?.name ?? 'cloudhost247-artwork.pdf').replace(/\.pdf$/i, '');
      saveBlob(blob, `${stem}-${PNG_DPI}dpi.png`);
      setMessage(null);
    } catch {
      setMessage('This browser could not create the PNG. The SVG and PDF downloads are unaffected.');
    }
  }

  return (
    <div className="studio-result">
      {previews.length > 0 ? (
        <div className={`studio-previews${previews.length > 1 ? ' studio-previews--many' : ''}`}>
          {previews.map((preview, index) => {
            const page = preview.widthMm >= 200 && preview.heightMm >= 250;
            return (
              <figure key={`${preview.title}-${index}`} className={`studio-preview${page ? ' studio-preview--page' : ''}`}>
                <div className="studio-preview__frame">
                  <img
                    src={svgDataUrl(preview.svg)}
                    alt={`${preview.title}: preview of the generated artwork, ${formatMm(preview.widthMm)} by ${formatMm(preview.heightMm)} millimetres.`}
                    style={{ aspectRatio: `${preview.widthMm} / ${preview.heightMm}`, '--studio-ratio': String(preview.widthMm / preview.heightMm) } as CSSProperties}
                  />
                </div>
                <figcaption>
                  <strong>{preview.title}</strong>
                  {/* The size it prints at. The picture is fitted to the panel, so on screen it may be
                      larger or smaller than that, and no claim is made about which. */}
                  <span>
                    Actual size {formatMm(preview.widthMm)} × {formatMm(preview.heightMm)} mm
                  </span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      ) : null}

      {files.length > 0 ? (
        <section className="studio-downloads" aria-label="Downloads">
          <h3>Download</h3>
          <ul>
            {files.map((file, index) => (
              <li key={`${index}-${file.name}`}>
                <div className="studio-downloads__buttons">
                  <button type="button" className={`ch247-button${file.mime === 'application/pdf' ? '' : ' ch247-button--ghost'}`} onClick={() => download(file)}>
                    {file.label}
                  </button>
                  {file.mime === 'application/pdf' ? (
                    <button type="button" className="ch247-button ch247-button--ghost" onClick={() => openPdf(file)}>
                      Open to print
                    </button>
                  ) : null}
                </div>
                <small>
                  {[file.hint, formatBytes(file.bytes)].filter(Boolean).join(' ')}
                </small>
              </li>
            ))}
            {!hasPng && first ? (
              <li>
                <div className="studio-downloads__buttons">
                  <button type="button" className="ch247-button ch247-button--ghost" onClick={() => void savePng(first)}>
                    Save as PNG image ({PNG_DPI} dpi)
                  </button>
                </div>
                <small>A picture of {previews.length > 1 ? 'the first preview' : 'the preview'} for screens and messages. Print from the PDF.</small>
              </li>
            ) : null}
          </ul>
          {message ? (
            <p role="alert" className="studio-result__message">
              {message}
            </p>
          ) : null}
        </section>
      ) : null}

      {value.notices.length > 0 ? (
        <section className="studio-notices" aria-label="Before you print">
          <h3>Before you print</h3>
          <ul>
            {value.notices.map((notice, index) => (
              <li key={`${index}-${String(notice)}`}>{String(notice)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {value.facts.length > 0 ? (
        <section aria-label="Details">
          <h3>Details</h3>
          <dl className="studio-facts">
            {value.facts.map((fact, index) => (
              <div key={`${fact.label}-${index}`}>
                <dt>{String(fact.label)}</dt>
                <dd>{String(fact.value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}
