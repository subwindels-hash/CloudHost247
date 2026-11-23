"""Regression tests for alpha compositing, not logo identity approval.
Run with the same pinned Pillow/VTracer environment as logos:generate.
"""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

spec = importlib.util.spec_from_file_location(
    "trace_logo_light_ground", Path(__file__).with_name("trace-logo-light-ground.py")
)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class LightGroundTests(unittest.TestCase):
    def test_ico_requires_and_uses_explicit_frame(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'original.ico'
            output = Path(directory) / 'trace.svg'
            Image.new('RGBA', (256, 256), (255, 0, 0, 128)).save(
                source, sizes=[(64, 64), (128, 128), (256, 256)])
            original = source.read_bytes()

            def inspect(prepared, destination, **options):
                with Image.open(prepared) as result:
                    self.assertEqual(result.size, (512, 512))
                    self.assertEqual(result.getpixel((0, 0)), (255, 127, 127))
                self.assertEqual(options['mode'], 'spline')
                Path(destination).write_text('<svg/>')

            with patch.object(helper.vtracer, 'convert_image_to_svg_py', side_effect=inspect):
                helper.trace(source, output, upscale=True, ico_size=128)
            self.assertEqual(source.read_bytes(), original)
            self.assertFalse(Path(str(output) + '.png').exists())
            with self.assertRaises(ValueError):
                helper.trace(source, output)
            with self.assertRaises(ValueError):
                helper.trace(source, output, ico_size=32)
            png = Path(directory) / 'not-ico.png'
            Image.new('RGBA', (128, 128)).save(png)
            with self.assertRaises(ValueError):
                helper.trace(png, output, ico_size=128)

    def test_composites_alpha_without_resizing_or_modifying_source(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "original.png"
            output = Path(directory) / "trace.svg"
            image = Image.new("RGBA", (3, 1))
            image.putdata([(0, 0, 0, 0), (255, 0, 0, 128), (12, 34, 56, 255)])
            image.save(source)
            original = source.read_bytes()

            def inspect(prepared, destination, **options):
                with Image.open(prepared) as result:
                    self.assertEqual(result.size, (3, 1))
                    self.assertEqual(result.mode, "RGB")
                    self.assertEqual(result.getpixel((0, 0)), (255, 255, 255))
                    self.assertEqual(result.getpixel((1, 0)), (255, 127, 127))
                    self.assertEqual(result.getpixel((2, 0)), (12, 34, 56))
                self.assertEqual(options["layer_difference"], 5)
                Path(destination).write_text("<svg/>")

            with patch.object(helper.vtracer, "convert_image_to_svg_py", side_effect=inspect):
                helper.trace(source, output)
            self.assertEqual(source.read_bytes(), original)
            self.assertFalse(Path(str(output) + ".png").exists())

    def test_opt_in_upscale_preserves_source_and_aspect_ratio(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "original.png"
            output = Path(directory) / "trace.svg"
            Image.new("RGBA", (3, 2), (0, 0, 0, 0)).save(source)
            original = source.read_bytes()

            def inspect(prepared, destination, **options):
                with Image.open(prepared) as result:
                    self.assertEqual(result.size, (12, 8))
                    self.assertEqual(result.getpixel((0, 0)), (255, 255, 255))
                Path(destination).write_text("<svg/>")

            with patch.object(helper.vtracer, "convert_image_to_svg_py", side_effect=inspect):
                helper.trace(source, output, upscale=True)
            self.assertEqual(source.read_bytes(), original)
            self.assertFalse(Path(str(output) + ".png").exists())

    def test_pixel_profile_uses_native_dimensions_and_no_curve_fitting(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "original.png"
            output = Path(directory) / "trace.svg"
            Image.new("RGBA", (3, 2), (255, 255, 255, 128)).save(source)
            original = source.read_bytes()

            def inspect(prepared, destination, **options):
                with Image.open(prepared) as result:
                    self.assertEqual(result.size, (3, 2))
                    self.assertEqual(result.getpixel((0, 0)), (140, 146, 164))
                self.assertEqual(options['mode'], 'none')
                self.assertEqual(options['filter_speckle'], 0)
                self.assertEqual(options['layer_difference'], 1)
                Path(destination).write_text('<svg/>')

            with patch.object(helper.vtracer, 'convert_image_to_svg_py', side_effect=inspect):
                helper.trace(source, output, dark=True, pixel=True)
            self.assertEqual(source.read_bytes(), original)
            self.assertFalse(Path(str(output) + '.png').exists())

    def test_light_pixel_profile_composites_white_without_resizing(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'original.png'
            output = Path(directory) / 'trace.svg'
            Image.new('RGBA', (3, 2), (0, 0, 0, 128)).save(source)
            original = source.read_bytes()

            def inspect(prepared, destination, **options):
                with Image.open(prepared) as result:
                    self.assertEqual(result.size, (3, 2))
                    self.assertEqual(result.getpixel((0, 0)), (127, 127, 127))
                self.assertEqual(options['mode'], 'none')
                self.assertEqual(options['filter_speckle'], 0)
                self.assertEqual(options['layer_difference'], 1)
                Path(destination).write_text('<svg/>')

            with patch.object(helper.vtracer, 'convert_image_to_svg_py', side_effect=inspect):
                helper.trace(source, output, pixel=True)
            self.assertEqual(source.read_bytes(), original)
            self.assertFalse(Path(str(output) + '.png').exists())

    def test_dark_ground_keeps_white_artwork_visible(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "original.png"
            output = Path(directory) / "trace.svg"
            image = Image.new("RGBA", (2, 1))
            image.putdata([(0, 0, 0, 0), (255, 255, 255, 255)])
            image.save(source)
            original = source.read_bytes()

            def inspect(prepared, destination, **options):
                with Image.open(prepared) as result:
                    self.assertEqual(result.getpixel((0, 0)), (24, 36, 72))
                    self.assertEqual(result.getpixel((1, 0)), (255, 255, 255))
                Path(destination).write_text("<svg/>")

            with patch.object(helper.vtracer, "convert_image_to_svg_py", side_effect=inspect):
                helper.trace(source, output, dark=True)
            self.assertEqual(source.read_bytes(), original)
            self.assertFalse(Path(str(output) + ".png").exists())

    def test_removes_intermediate_when_tracing_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "original.png"
            output = Path(directory) / "trace.svg"
            Image.new("RGBA", (2, 2)).save(source)
            with patch.object(helper.vtracer, "convert_image_to_svg_py", side_effect=RuntimeError("failure")):
                with self.assertRaisesRegex(RuntimeError, "failure"):
                    helper.trace(source, output)
            self.assertFalse(Path(str(output) + ".png").exists())

    def test_rejects_unpinned_dependency_version(self):
        with patch.object(helper.importlib.metadata, "version", return_value="0.0.0"):
            with self.assertRaisesRegex(RuntimeError, "Pillow==13.0.0"):
                helper.trace("unused.png", "unused.svg")


if __name__ == "__main__":
    unittest.main()
