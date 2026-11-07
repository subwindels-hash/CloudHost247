/**
 * Shared CloudHost247 illustration frame — illustrative infrastructure imagery first.
 *
 * Every marketing surface (homepage, product pages, split sections) renders through this
 * component so an AI-generated image, a 3D scene and an SVG diagram stay paired. The `<img>`
 * always points at the SVG — that is the file the generator and the page tests assert — and a
 * `<picture>` upgrades to AI-generated infrastructure imagery in AVIF / WebP / JPEG. The original 3D
 * ladder remains as a second fallback. Missing files therefore degrade to the diagram rather
 * than a broken image.
 *
 * The photo for a scene comes from `photo-map.generated.ts`, which is generated from
 * `shared/site/photography.json` — the same registry that drives the WHMCS `visual.tpl`. Neither
 * surface invents its own image mapping, so a page looks the same on both stacks.
 *
 * The three widths are literal because `scripts/generate-raster-formats.py` writes `-640`,
 * `-960` and `-1280` for every JPEG in the library, photography included. Change the ladder
 * there, in `visual.tpl` and here together.
 */
import { resolvePhoto } from './photo-map.generated';

const ART = '/media/cloudhost247';

const LADDER = [640, 960, 1280];
const DEFAULT_SIZES = '(max-width: 900px) 100vw, 660px';

export function Illustration({
  visual,
  visual3d,
  alt,
  caption,
  eager = false,
  light = false,
  sizes = DEFAULT_SIZES,
}: {
  visual: string;
  visual3d?: string;
  alt: string;
  caption?: { left: string; right: string };
  eager?: boolean;
  light?: boolean;
  sizes?: string;
}) {
  const className = `ch-visual${visual3d ? ' ch-visual--3d' : ''}${light && !visual3d ? ' ch-visual--light' : ''}`;
  const photo = visual3d ? resolvePhoto(visual3d) : null;
  const effectiveAlt = alt && photo ? photo.alt : alt;
  const img = (
    <img
      src={`${ART}/${visual}.svg`}
      alt={effectiveAlt}
      width={660}
      height={520}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  );
  const srcSet = (format: string) =>
    LADDER.map((width) => `${ART}/${visual3d}-${width}.${format} ${width}w`).join(', ');
  const photoSrcSet = (format: string) =>
    LADDER.map((width) => `${ART}/${photo?.key}-${width}.${format} ${width}w`).join(', ');

  return (
    <figure className={className} style={{ margin: 0 }}>
      {visual3d ? (
        <picture>
          {photo ? (
            <>
              <source type="image/avif" sizes={sizes} srcSet={photoSrcSet('avif')} />
              <source type="image/webp" sizes={sizes} srcSet={photoSrcSet('webp')} />
              <source type="image/jpeg" srcSet={`${ART}/${photo.key}.jpg`} />
            </>
          ) : null}
          <source type="image/avif" sizes={sizes} srcSet={srcSet('avif')} />
          <source type="image/webp" sizes={sizes} srcSet={srcSet('webp')} />
          <source type="image/jpeg" srcSet={`${ART}/${visual3d}.jpg`} />
          {img}
        </picture>
      ) : (
        img
      )}
      {caption ? (
        <figcaption className="ch-visual__caption">
          <span>{caption.left}</span>
          <span>{caption.right}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
