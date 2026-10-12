/**
 * Downloads, printing and the local-data controls.
 *
 * Every button here is wired to a real renderer, and every outcome — success, partial success or
 * failure — is reported in the panel rather than in a toast that disappears. An export that fails
 * is the one failure a user cannot verify for themselves, so the message has to carry the reason.
 */

import { useState } from 'react';
import type { CardFace } from '../../../../src/tools/business/id-card';
import { exportCard, exportSvg, printCard, type ExportFormat } from '../../lib/id-card/export';
import { clearCard, hasStoredCard, imagesConsented, setImagesConsent } from '../../lib/id-card/storage';

export default function IdCardExportPanel({
  front,
  back,
  slug,
  title,
  disabled,
  onClearStored,
  onConsentChange,
}: {
  front: CardFace;
  back: CardFace;
  slug: string;
  title: string;
  disabled: boolean;
  onClearStored: () => void;
  onConsentChange: (consent: boolean) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [pdfLayout, setPdfLayout] = useState<'pages' | 'sheet'>('pages');
  const [stored, setStored] = useState(() => hasStoredCard());
  const [consent, setConsent] = useState(() => imagesConsented());

  async function run(label: string, action: () => Promise<{ ok: boolean; message: string }> | { ok: boolean; message: string }): Promise<void> {
    setBusy(label);
    setFeedback(null);
    try {
      const result = await action();
      setFeedback({ ok: result.ok, message: result.message });
    } catch (error) {
      setFeedback({ ok: false, message: error instanceof Error ? error.message : 'The export failed for an unknown reason.' });
    } finally {
      setBusy(null);
    }
  }

  function download(format: ExportFormat, side: 'front' | 'back' | 'both'): void {
    void run(`${format}-${side}`, () =>
      exportCard({
        front,
        back,
        format,
        side,
        slug,
        title,
        pdfLayout,
      })
    );
  }

  return (
    <section className="idc-panel" aria-labelledby="idc-export-title">
      <h3 className="bt247-panel__title" id="idc-export-title">
        Download &amp; print
      </h3>
      <p className="ch247-page__hint" style={{ marginTop: 0 }}>
        Every export is the same artwork you see in the preview, rendered at 300 dpi (1011 × 638 px)
        and sized to the ISO/IEC 7810 ID-1 card, 85.60 × 53.98 mm.
      </p>

      <div className="idc-export__group">
        <h4>PDF — for a card printer or a print bureau</h4>
        <div className="idc-radio-row">
          <label>
            <input type="radio" name="idc-pdf-layout" checked={pdfLayout === 'pages'} onChange={() => setPdfLayout('pages')} /> One
            page per side
          </label>
          <label>
            <input type="radio" name="idc-pdf-layout" checked={pdfLayout === 'sheet'} onChange={() => setPdfLayout('sheet')} /> Front
            and back on one sheet
          </label>
        </div>
        <div className="bt247-actions">
          <button type="button" className="ch247-button" disabled={disabled || busy !== null} onClick={() => download('pdf', 'both')}>
            {busy === 'pdf-both' ? 'Rendering…' : 'Download PDF (both sides)'}
          </button>
          <button type="button" className="ch247-button ch247-button--ghost" disabled={disabled || busy !== null} onClick={() => download('pdf', 'front')}>
            PDF — front only
          </button>
          <button type="button" className="ch247-button ch247-button--ghost" disabled={disabled || busy !== null} onClick={() => download('pdf', 'back')}>
            PDF — back only
          </button>
        </div>
      </div>

      <div className="idc-export__group">
        <h4>Images</h4>
        <div className="bt247-actions">
          <button type="button" className="ch247-button" disabled={disabled || busy !== null} onClick={() => download('png', 'both')}>
            {busy === 'png-both' ? 'Rendering…' : 'Download PNG (both sides)'}
          </button>
          <button type="button" className="ch247-button" disabled={disabled || busy !== null} onClick={() => download('jpg', 'both')}>
            {busy === 'jpg-both' ? 'Rendering…' : 'Download JPG (both sides)'}
          </button>
          <button type="button" className="ch247-button ch247-button--ghost" disabled={disabled || busy !== null} onClick={() => download('png', 'front')}>
            PNG — front
          </button>
          <button type="button" className="ch247-button ch247-button--ghost" disabled={disabled || busy !== null} onClick={() => download('png', 'back')}>
            PNG — back
          </button>
        </div>
      </div>

      <div className="idc-export__group">
        <h4>Print &amp; vector</h4>
        <div className="bt247-actions">
          <button type="button" className="ch247-button ch247-button--ghost" disabled={disabled} onClick={() => void run('print', () => printCard(front, back, title))}>
            Open print preview
          </button>
          <button type="button" className="ch247-button ch247-button--ghost" disabled={disabled} onClick={() => void run('svg', () => exportSvg(front, back, slug, title))}>
            Download SVG (vector)
          </button>
        </div>
        <p className="ch247-page__hint">
          Print at <strong>100% scale</strong> — “fit to page” will shrink the card and it will not
          fit a CR80 holder.
        </p>
      </div>

      {disabled ? (
        <p className="ch247-page__hint" style={{ marginBottom: 0 }}>
          Downloads unlock once the card details validate. Fix the fields marked in red above.
        </p>
      ) : null}

      {feedback ? (
        <p className={feedback.ok ? 'idc-flash idc-flash--ok' : 'idc-flash idc-flash--error'} role="status" aria-live="polite">
          {feedback.message}
        </p>
      ) : null}

      <div className="idc-privacy">
        <h4>Your data</h4>
        <p>
          The card is composed in this browser tab. Employee names, identifiers, contact details,
          photographs and signatures are never uploaded to CloudHost247 or to any third party, and
          nothing is written to disk on our side. No request is made to any server, including for
          photo URLs in a bulk import, which are recorded but not fetched.
        </p>
        <label className="idc-check">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => {
              const next = event.target.checked;
              setConsent(next);
              setImagesConsent(next);
              onConsentChange(next);
            }}
          />
          Also remember uploaded photographs, signatures and contact details in this browser between
          visits
        </label>
        <p className="ch247-page__hint">
          Off by default. With it off, only the text fields you type are kept locally and the images
          live in memory until you close the tab. This matters on a shared or kiosk computer.
        </p>
        <div className="bt247-actions">
          <button
            type="button"
            className="ch247-button ch247-button--ghost ch247-button--small"
            onClick={() => {
              clearCard();
              setStored(false);
              setConsent(false);
              onClearStored();
              setFeedback({ ok: true, message: 'Stored card details and images were removed from this browser.' });
            }}
          >
            Clear stored data{stored ? '' : ' (nothing stored)'}
          </button>
        </div>
      </div>
    </section>
  );
}
