/**
 * Live front-and-back preview.
 *
 * The preview paints the *export* canvas: `renderFace()` draws the card at its full 300 dpi size and
 * this component scales that canvas down with CSS. That is the whole point — a preview that is a
 * separate, cheaper render is a preview that eventually disagrees with the download.
 *
 * Redraws are debounced and the last canvas is only replaced once the new one is complete, so typing
 * in a field never shows a half-painted card, and a render that takes longer than the next keystroke
 * is discarded rather than queued.
 */

import { useEffect, useRef, useState } from 'react';
import type { CardFace } from '../../../../src/tools/business/id-card';
import { renderFace } from '../../lib/id-card/export';

export type PreviewSide = 'front' | 'back';

export default function IdCardPreview({
  front,
  back,
  side,
  onSideChange,
  disabled,
  zoom,
}: {
  front: CardFace;
  back: CardFace;
  side: PreviewSide;
  onSideChange: (side: PreviewSide) => void;
  disabled: boolean;
  zoom: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const renderToken = useRef(0);
  const [status, setStatus] = useState<'idle' | 'rendering' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [renderedSize, setRenderedSize] = useState<{ width: number; height: number } | null>(null);

  const face = side === 'front' ? front : back;
  const signature = `${face.width}x${face.height}:${face.ops.length}:${JSON.stringify(face.ops.map((op) => (op.kind === 'text' ? op.text : op.kind === 'image' ? (op.href ?? '').slice(-24) : op.kind)).join('|')).length}`;

  useEffect(() => {
    if (disabled) {
      setStatus('idle');
      return;
    }
    const token = (renderToken.current += 1);
    setStatus('rendering');
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const rendered = await renderFace(face);
        if (cancelled || token !== renderToken.current) return;
        const host = hostRef.current;
        if (!host) return;
        host.replaceChildren(rendered.canvas);
        rendered.canvas.className = 'idc-preview__canvas';
        rendered.canvas.setAttribute('role', 'img');
        rendered.canvas.setAttribute(
          'aria-label',
          `${side === 'front' ? 'Front' : 'Back'} of the employee ID card at ${rendered.canvas.width} by ${rendered.canvas.height} pixels, print size 85.6 by 53.98 millimetres`
        );
        // The canvas is announced to assistive technology as an image; the text content beside the
        // preview is what describes it, so the canvas itself carries no interactive semantics.
        rendered.canvas.setAttribute('tabindex', '-1');
        setRenderedSize({ width: rendered.canvas.width, height: rendered.canvas.height });
        setStatus('ready');
        setError('');
      } catch (failure) {
        if (cancelled || token !== renderToken.current) return;
        setStatus('error');
        setError(failure instanceof Error ? failure.message : 'The preview could not be drawn.');
      }
    }, 90);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `signature` captures every layout-affecting input, so a redraw happens when the card changes
    // and not merely when React re-renders.
  }, [face, side, disabled, signature]);

  return (
    <div className="idc-preview" aria-busy={status === 'rendering'}>
      <div className="idc-preview__head">
        <h3 className="idc-preview__title">Live employee ID preview</h3>
        <div className="idc-preview__switch" role="group" aria-label="Card side">
          <button type="button" className="bt247-filter" aria-pressed={side === 'front'} onClick={() => onSideChange('front')}>
            Front
          </button>
          <button type="button" className="bt247-filter" aria-pressed={side === 'back'} onClick={() => onSideChange('back')}>
            Back
          </button>
        </div>
      </div>

      <p className="idc-preview__meta">
        Standard ID-1 card ratio · print-ready front and back
        {renderedSize ? ` · ${renderedSize.width} × ${renderedSize.height} px at 300 dpi` : ''}
      </p>

      <div className="idc-preview__stage" style={{ maxWidth: `${(zoom * 10).toFixed(0)}rem` }}>
        <div ref={hostRef} className="idc-preview__host" data-status={status} />
        {status === 'idle' || status === 'rendering' ? (
          <p className="idc-preview__overlay" role="status" aria-live="polite">
            {status === 'idle' ? 'Waiting for details…' : 'Drawing the card…'}
          </p>
        ) : null}
      </div>

      {status === 'error' ? (
        <p className="bt247-state bt247-state--error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
