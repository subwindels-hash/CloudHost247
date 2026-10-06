/** A QR image returned by the existing server encoder, never HTML injected into the page. */
export default function QrResult({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const image = (
    data.qr && typeof data.qr === 'object' ? data.qr : data
  ) as Record<string, unknown>;
  const png =
    typeof image.dataUrl === 'string' &&
    /^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(image.dataUrl)
      ? image.dataUrl
      : null;
  const svg =
    typeof image.svg === 'string' && image.svg.startsWith('<svg')
      ? image.svg
      : null;
  const src =
    png ??
    (svg
      ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      : null);
  if (!src) return null;
  return (
    <figure className="tools-qr">
      <img
        src={src}
        width="256"
        height="256"
        alt="Generated QR code. The encoded text is included in the result below."
      />
      <figcaption>
        <a
          href={src}
          download={png ? 'cloudhost247-qr.png' : 'cloudhost247-qr.svg'}
        >
          Download QR image
        </a>
        <p>
          Verify the encoded destination before sharing or scanning. Wi-Fi codes
          contain the network credentials you supplied.
        </p>
      </figcaption>
    </figure>
  );
}
