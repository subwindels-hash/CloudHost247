/**
 * Shared CloudHost247 illustration frame.
 *
 * Every marketing surface (homepage, product pages, split sections) renders through this
 * component so a 3D scene and its SVG diagram stay paired. The `<img>` always points at the
 * SVG — that is the file the generator and the page tests assert — and a `<picture>` upgrades
 * to the smallest AVIF or WebP encoding that covers the box. Missing 3D files therefore
 * degrade to the diagram rather than a broken image.
 *
 * The three widths are literal because the files are: `scripts/generate-raster-formats.py`
 * writes `-640`, `-960` and `-1280` for every scene and fails the build if one is missing. The
 * default `sizes` matches the CSS box (`.ch-visual` caps at 660 px inside the 1240 px wrap and
 * the split collapses to one column under 900 px). Change the ladder there and here together.
 */
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
  const img = (
    <img
      src={`${ART}/${visual}.svg`}
      alt={alt}
      width={660}
      height={520}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  );
  const srcSet = (format: string) =>
    LADDER.map((width) => `${ART}/${visual3d}-${width}.${format} ${width}w`).join(', ');

  return (
    <figure className={className} style={{ margin: 0 }}>
      {visual3d ? (
        <picture>
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
