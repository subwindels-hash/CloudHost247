<?php
namespace CloudHost247\NetworkTools\Services\Productivity;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;
use InvalidArgumentException;

/**
 * Colour converter (docs section 59).
 *
 * Deterministic colour maths: HEX, RGB, HSL, HSV, CMYK, plus WCAG 2.1 relative
 * luminance and contrast ratios against black and white. Contrast is a
 * calculation with a published formula, so the pass/fail thresholds quoted are
 * WCAG's, not the module's opinion.
 */
final class ColorService extends Service
{
    private static $names = array(
        'black' => '#000000', 'white' => '#ffffff', 'red' => '#ff0000', 'green' => '#008000', 'blue' => '#0000ff',
        'yellow' => '#ffff00', 'cyan' => '#00ffff', 'magenta' => '#ff00ff', 'gray' => '#808080', 'grey' => '#808080',
        'orange' => '#ffa500', 'purple' => '#800080', 'pink' => '#ffc0cb', 'brown' => '#a52a2a', 'navy' => '#000080',
        'teal' => '#008080', 'olive' => '#808000', 'maroon' => '#800000', 'silver' => '#c0c0c0', 'lime' => '#00ff00',
        'indigo' => '#4b0082', 'gold' => '#ffd700', 'crimson' => '#dc143c', 'tomato' => '#ff6347', 'salmon' => '#fa8072',
    );

    protected function execute()
    {
        $input = trim((string) $this->input['value']);
        $rgb = $this->parse($input);
        list($hue, $saturation, $lightness) = $this->toHsl($rgb);
        list($hueV, $saturationV, $value) = $this->toHsv($rgb);
        list($c, $m, $y, $k) = $this->toCmyk($rgb);
        $luminance = $this->luminance($rgb);
        $contrastWhite = $this->contrast($luminance, 1.0);
        $contrastBlack = $this->contrast($luminance, 0.0);
        $hslString = 'hsl(' . $hue . ', ' . round($saturation * 100, 1) . '%, ' . round($lightness * 100, 1) . '%)';
        $models = array(
            'hex' => $this->toHex($rgb),
            'hex_short' => $this->toHex($rgb, true),
            'rgb' => 'rgb(' . $rgb['r'] . ', ' . $rgb['g'] . ', ' . $rgb['b'] . ')',
            'rgba' => 'rgba(' . $rgb['r'] . ', ' . $rgb['g'] . ', ' . $rgb['b'] . ', 1)',
            'hsl' => $hslString,
            'hsv' => 'hsv(' . $hueV . ', ' . round($saturationV * 100, 1) . '%, ' . round($value * 100, 1) . '%)',
            'cmyk' => 'cmyk(' . round($c * 100) . '%, ' . round($m * 100) . '%, ' . round($y * 100) . '%, ' . round($k * 100) . '%)',
            'luminance' => round($luminance, 4),
        );
        $output = isset($this->input['output']) ? $this->input['output'] : 'all';
        $warnings = array();
        if ($contrastWhite < 3.0 && $contrastBlack < 3.0) {
            $warnings[] = 'This colour has low contrast against both black and white (below 3:1). Text in this colour on either background will be difficult to read, and it fails WCAG AA for normal text in both cases.';
        }
        if ($contrastWhite >= 4.5) {
            $warnings[] = 'This colour reaches WCAG AA (4.5:1) for normal text on white (' . round($contrastWhite, 2) . ':1).';
        }
        if ($contrastBlack >= 4.5) {
            $warnings[] = 'This colour reaches WCAG AA (4.5:1) for normal text on black (' . round($contrastBlack, 2) . ':1).';
        }
        return ToolResult::success(array(
            'input' => $input,
            'swatch' => $models['hex'],
            'models' => $models,
            'selected_output' => $output,
            'components' => $rgb,
            'hsl_components' => array('h' => $hue, 's' => round($saturation * 100, 1) . '%', 'l' => round($lightness * 100, 1) . '%'),
            'hsv_components' => array('h' => $hueV, 's' => round($saturationV * 100, 1) . '%', 'v' => round($value * 100, 1) . '%'),
            'cmyk_components' => array('c' => round($c * 100) . '%', 'm' => round($m * 100) . '%', 'y' => round($y * 100) . '%', 'k' => round($k * 100) . '%'),
            'contrast' => array(
                'against_white' => round($contrastWhite, 2),
                'against_black' => round($contrastBlack, 2),
                'wcag_note' => 'Ratios use the WCAG 2.1 relative-luminance formula. AA requires 4.5:1 for normal text and 3:1 for large text; AAA requires 7:1. Contrast is about legibility, not aesthetics.',
            ),
            'summary' => $input . ' is ' . $models['hex'] . ' — ' . $models['rgb'] . '.',
            'note' => 'Values are rounded for display; the HEX and RGB forms are exact.',
        ), $warnings);
    }

    private function parse($input)
    {
        $value = strtolower(trim($input));
        if (isset(self::$names[$value])) {
            $value = self::$names[$value];
        }
        if (preg_match('/^#?([0-9a-f]{3})$/', $value, $matches)) {
            return array(
                'r' => hexdec(str_repeat($matches[1][0], 2)),
                'g' => hexdec(str_repeat($matches[1][1], 2)),
                'b' => hexdec(str_repeat($matches[1][2], 2)),
            );
        }
        if (preg_match('/^#?([0-9a-f]{6})$/', $value, $matches)) {
            return array('r' => hexdec(substr($matches[1], 0, 2)), 'g' => hexdec(substr($matches[1], 2, 2)), 'b' => hexdec(substr($matches[1], 4, 2)));
        }
        if (preg_match('/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i', $value, $matches)) {
            foreach (array(1, 2, 3) as $index) {
                if ((int) $matches[$index] > 255) {
                    throw new InvalidArgumentException('RGB components must be between 0 and 255.');
                }
            }
            return array('r' => (int) $matches[1], 'g' => (int) $matches[2], 'b' => (int) $matches[3]);
        }
        if (preg_match('/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i', $value, $matches)) {
            $hue = ((float) $matches[1]) / 360;
            $saturation = ((float) $matches[2]) / 100;
            $lightness = ((float) $matches[3]) / 100;
            return $this->fromHsl($hue, $saturation, $lightness);
        }
        throw new InvalidArgumentException('Enter a colour as HEX (#0B5FFF), rgb(11,95,255), hsl(219,100%,52%), or one of the common colour names this tool knows.');
    }

    private function fromHsl($h, $s, $l)
    {
        $h = fmod(($h % 1) + 1, 1);
        if ($s == 0) {
            $level = (int) round($l * 255);
            return array('r' => $level, 'g' => $level, 'b' => $level);
        }
        $q = $l < 0.5 ? $l * (1 + $s) : $l + $s - $l * $s;
        $p = 2 * $l - $q;
        $channel = function ($t) use ($p, $q) {
            if ($t < 0) { $t += 1; }
            if ($t > 1) { $t -= 1; }
            if ($t < 1 / 6) { return $p + ($q - $p) * 6 * $t; }
            if ($t < 1 / 2) { return $q; }
            if ($t < 2 / 3) { return $p + ($q - $p) * (2 / 3 - $t) * 6; }
            return $p;
        };
        return array(
            'r' => (int) round($channel($h + 1 / 3) * 255),
            'g' => (int) round($channel($h) * 255),
            'b' => (int) round($channel($h - 1 / 3) * 255),
        );
    }

    private function toHsl(array $rgb)
    {
        $r = $rgb['r'] / 255;
        $g = $rgb['g'] / 255;
        $b = $rgb['b'] / 255;
        $max = max($r, $g, $b);
        $min = min($r, $g, $b);
        $lightness = ($max + $min) / 2;
        if ($max === $min) {
            return array(0, 0.0, $lightness);
        }
        $delta = $max - $min;
        $saturation = $lightness > 0.5 ? $delta / (2 - $max - $min) : $delta / ($max + $min);
        if ($max === $r) {
            $hue = ($g - $b) / $delta + ($g < $b ? 6 : 0);
        } elseif ($max === $g) {
            $hue = ($b - $r) / $delta + 2;
        } else {
            $hue = ($r - $g) / $delta + 4;
        }
        return array((int) round($hue * 60), $saturation, $lightness);
    }

    private function toHsv(array $rgb)
    {
        $r = $rgb['r'] / 255;
        $g = $rgb['g'] / 255;
        $b = $rgb['b'] / 255;
        $max = max($r, $g, $b);
        $min = min($r, $g, $b);
        $delta = $max - $min;
        $saturation = $max == 0 ? 0.0 : $delta / $max;
        if ($delta == 0) {
            return array(0, $saturation, $max);
        }
        if ($max === $r) {
            $hue = 60 * fmod((($g - $b) / $delta), 6);
        } elseif ($max === $g) {
            $hue = 60 * ((($b - $r) / $delta) + 2);
        } else {
            $hue = 60 * ((($r - $g) / $delta) + 4);
        }
        if ($hue < 0) {
            $hue += 360;
        }
        return array((int) round($hue), $saturation, $max);
    }

    private function toCmyk(array $rgb)
    {
        $r = $rgb['r'] / 255;
        $g = $rgb['g'] / 255;
        $b = $rgb['b'] / 255;
        $k = 1 - max($r, $g, $b);
        if ($k >= 1) {
            return array(0.0, 0.0, 0.0, 1.0);
        }
        return array((1 - $r - $k) / (1 - $k), (1 - $g - $k) / (1 - $k), (1 - $b - $k) / (1 - $k), $k);
    }

    private function toHex(array $rgb, $short = false)
    {
        $hex = sprintf('#%02x%02x%02x', $rgb['r'], $rgb['g'], $rgb['b']);
        if ($short && $hex[1] === $hex[2] && $hex[3] === $hex[4] && $hex[5] === $hex[6]) {
            return '#' . $hex[1] . $hex[3] . $hex[5];
        }
        return $hex;
    }

    private function luminance(array $rgb)
    {
        $channel = function ($value) {
            $value = $value / 255;
            return $value <= 0.03928 ? $value / 12.92 : pow(($value + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * $channel($rgb['r']) + 0.7152 * $channel($rgb['g']) + 0.0722 * $channel($rgb['b']);
    }

    private function contrast($luminanceA, $luminanceB)
    {
        $light = max($luminanceA, $luminanceB);
        $dark = min($luminanceA, $luminanceB);
        return ($light + 0.05) / ($dark + 0.05);
    }
}
