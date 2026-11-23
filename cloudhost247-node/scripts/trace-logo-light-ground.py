"""Reproduce reviewed PNG traces on a white or explicitly selected dark presentation ground.

VTracer ignores partial alpha in some source PNGs, turning transparent RGB
pixels into dark outlines. Composite with Pillow before tracing; do not modify
source bytes or pretend this is a vendor-authored SVG. Both input and resulting
SVG digests are verified by generate-platform-inline-icons.mjs.
"""
import importlib.metadata
import sys

from PIL import Image
import vtracer


def trace(source, output, upscale=False, dark=False, pixel=False, ico_size=None):
    if importlib.metadata.version("Pillow") != "13.0.0":
        raise RuntimeError("Pillow==13.0.0 is required for light-ground traces")
    if importlib.metadata.version("vtracer") != "0.6.15":
        raise RuntimeError("vtracer==0.6.15 is required for light-ground traces")
    # Preserve aspect ratio and source bytes. The default does not resize;
    # the explicit upscaled profile adds only deterministic resampling.
    with Image.open(source) as image:
        if ico_size is not None:
            if image.format != "ICO" or (ico_size, ico_size) not in image.ico.sizes():
                raise ValueError("Pinned ICO frame is absent or source is not ICO")
            rgba = image.ico.getimage((ico_size, ico_size)).convert("RGBA")
        else:
            if image.format != "PNG":
                raise ValueError("Non-PNG input requires explicit ICO frame selection")
            rgba = image.convert("RGBA")
        ground = Image.new("RGBA", rgba.size, (24, 36, 72, 255) if dark else (255, 255, 255, 255))
        flattened = Image.alpha_composite(ground, rgba).convert("RGB")
        # Explicit opt-in profile: resample, never redraw. More samples give
        # VTracer room to fit small curved contours without angular corners.
        if upscale:
            flattened = flattened.resize(
                (rgba.width * 4, rgba.height * 4), Image.Resampling.LANCZOS
            )
        # The intermediate file is local to the generator's temporary directory.
        prepared = str(output) + ".png"
        flattened.save(prepared)
    try:
        vtracer.convert_image_to_svg_py(
            prepared, str(output), colormode="color", hierarchical="stacked",
            mode="none" if pixel else "spline", filter_speckle=0 if pixel else 1, color_precision=8,
            layer_difference=1 if pixel else 5, corner_threshold=45, length_threshold=1.5,
            max_iterations=10, splice_threshold=50, path_precision=2,
        )
    finally:
        from pathlib import Path
        Path(prepared).unlink(missing_ok=True)


if __name__ == "__main__":
    modes = ('--upscale', '--dark-upscale', '--dark-pixel', '--pixel', '--ico-128-upscale')
    if len(sys.argv) not in (3, 4) or (len(sys.argv) == 4 and sys.argv[3] not in modes):
        raise SystemExit('Usage: trace-logo-light-ground.py SOURCE OUTPUT [--upscale | --dark-upscale | --dark-pixel | --pixel | --ico-128-upscale]')
    mode = sys.argv[3] if len(sys.argv) == 4 else ''
    trace(sys.argv[1], sys.argv[2], upscale=mode in ('--upscale', '--dark-upscale', '--ico-128-upscale'),
          dark=mode in ('--dark-upscale', '--dark-pixel'), pixel=mode in ('--dark-pixel', '--pixel'),
          ico_size=128 if mode == '--ico-128-upscale' else None)
