/**
 * Shared CloudHost247 illustration frame.
 *
 * Every marketing surface (homepage, product pages, split sections) renders through this
 * component so a 3D raster and its SVG diagram stay paired. The `<img>` always points at the
 * SVG — that is the file the generator and the page tests assert — and a `<picture>` source
 * upgrades to the 3D JPEG when one exists. Missing 3D files therefore degrade to the diagram
 * rather than a broken image.
 */
const ART = '/media/cloudhost247';

export function Illustration({
  visual,
  visual3d,
  alt,
  caption,
  eager = false,
  light = false,
}: {
  visual: string;
  visual3d?: string;
  alt: string;
  caption?: { left: string; right: string };
  eager?: boolean;
  light?: boolean;
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

  return (
    <figure className={className} style={{ margin: 0 }}>
      {visual3d ? (
        <picture>
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
