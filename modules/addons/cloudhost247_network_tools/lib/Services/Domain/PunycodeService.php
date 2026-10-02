<?php
namespace CloudHost247\NetworkTools\Services\Domain;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;

/**
 * Punycode / IDN converter (docs section 38).
 *
 * Uses the intl extension when it is available and the module's own RFC 3492
 * encoder/decoder otherwise, so the tool behaves identically on a cPanel server
 * without intl. Homograph information is only ever reported as a comparison of
 * the ASCII form — the tool never claims a name is "safe".
 */
final class PunycodeService extends Service
{
    const BASE = 36;
    const TMIN = 1;
    const TMAX = 26;
    const SKEW = 38;
    const DAMP = 700;
    const INITIAL_BIAS = 72;
    const INITIAL_N = 128;

    protected function execute()
    {
        $value = trim((string) $this->input['value']);
        $direction = isset($this->input['direction']) ? $this->input['direction'] : 'to_ascii';
        if ($direction === 'auto') {
            $direction = (stripos($value, 'xn--') !== false) ? 'to_unicode' : 'to_ascii';
        }
        $ascii = '';
        $unicode = '';
        if ($direction === 'to_ascii') {
            $ascii = $this->toAscii($value);
            $unicode = $this->toUnicode($ascii);
        } else {
            $ascii = $this->toAscii($value);
            $unicode = $this->toUnicode($ascii);
        }
        $warnings = array();
        if ($ascii === '' || $unicode === '') {
            return ToolResult::invalid('That value could not be converted. Enter a valid domain name or a single label.');
        }
        if ($direction === 'to_ascii' && $ascii === $value) {
            $warnings[] = 'The value is already pure ASCII; no conversion was necessary.';
        }
        $mixed = $this->mixedScriptNotice($unicode);
        if ($mixed !== '') {
            $warnings[] = $mixed;
        }
        return ToolResult::success(array(
            'input' => $value,
            'direction' => $direction,
            'ascii' => $ascii,
            'unicode' => $unicode,
            'labels' => array_map(function ($label) {
                return array(
                    'unicode' => $label,
                    'ascii' => $this->labelToAscii($label),
                    'converted' => $this->labelToAscii($label) !== $label,
                );
            }, explode('.', $unicode)),
            'homograph_note' => 'Two names that look identical on screen can have different ASCII forms. Before trusting a link, compare the Punycode form shown here with the domain you expect.',
            'client_side' => false,
            'summary' => 'Unicode: ' . $unicode . ' — Punycode: ' . $ascii,
        ), $warnings);
    }

    private function toAscii($value)
    {
        $value = trim($value);
        if ($value === '') {
            return '';
        }
        if (function_exists('idn_to_ascii') && defined('INTL_IDNA_VARIANT_UTS46')) {
            $converted = @idn_to_ascii($value, IDNA_DEFAULT, INTL_IDNA_VARIANT_UTS46);
            if (is_string($converted) && $converted !== '') {
                return strtolower($converted);
            }
        }
        $labels = array();
        foreach (explode('.', $value) as $label) {
            $labels[] = $this->labelToAscii($label);
        }
        return strtolower(implode('.', $labels));
    }

    private function labelToAscii($label)
    {
        $label = (string) $label;
        if ($label === '' || preg_match('/^[\x00-\x7f]*$/', $label)) {
            return strtolower($label);
        }
        if (function_exists('idn_to_ascii') && defined('INTL_IDNA_VARIANT_UTS46')) {
            $converted = @idn_to_ascii($label, IDNA_DEFAULT, INTL_IDNA_VARIANT_UTS46);
            if (is_string($converted) && $converted !== '') {
                return strtolower($converted);
            }
        }
        return 'xn--' . $this->encodeLabel($this->utf8ToCodePoints($label));
    }

    private function toUnicode($value)
    {
        $value = trim($value);
        if ($value === '') {
            return '';
        }
        if (function_exists('idn_to_utf8') && defined('INTL_IDNA_VARIANT_UTS46')) {
            $converted = @idn_to_utf8($value, IDNA_DEFAULT, INTL_IDNA_VARIANT_UTS46);
            if (is_string($converted) && $converted !== '') {
                return $converted;
            }
        }
        $labels = array();
        foreach (explode('.', $value) as $label) {
            $labels[] = $this->labelToUnicode($label);
        }
        return implode('.', $labels);
    }

    private function labelToUnicode($label)
    {
        $label = (string) $label;
        if (stripos($label, 'xn--') !== 0) {
            return $label;
        }
        if (function_exists('idn_to_utf8') && defined('INTL_IDNA_VARIANT_UTS46')) {
            $converted = @idn_to_utf8($label, IDNA_DEFAULT, INTL_IDNA_VARIANT_UTS46);
            if (is_string($converted) && $converted !== '') {
                return $converted;
            }
        }
        $decoded = $this->decodeLabel(substr($label, 4));
        return $decoded === null ? $label : $this->codePointsToUtf8($decoded);
    }

    /** RFC 3492 section 6.3. */
    private function encodeLabel(array $codePoints)
    {
        $output = '';
        $basic = array();
        foreach ($codePoints as $codePoint) {
            if ($codePoint < self::INITIAL_N) {
                $basic[] = $codePoint;
            }
        }
        foreach ($basic as $codePoint) {
            $output .= chr($codePoint);
        }
        if ($basic) {
            // RFC 3492 section 6.3: the basic code points are followed by the
            // delimiter when the encoded part follows.
            $output .= '-';
        }
        $handled = count($basic);
        $n = self::INITIAL_N;
        $delta = 0;
        $bias = self::INITIAL_BIAS;
        while ($handled < count($codePoints)) {
            $m = PHP_INT_MAX;
            foreach ($codePoints as $codePoint) {
                if ($codePoint >= $n && $codePoint < $m) {
                    $m = $codePoint;
                }
            }
            if ($m === PHP_INT_MAX) {
                break;
            }
            $delta += ($m - $n) * ($handled + 1);
            $n = $m;
            foreach ($codePoints as $codePoint) {
                if ($codePoint < $n) {
                    $delta++;
                }
                if ($codePoint === $n) {
                    $q = $delta;
                    for ($k = self::BASE; ; $k += self::BASE) {
                        $t = $k <= $bias ? self::TMIN : ($k >= $bias + self::TMAX ? self::TMAX : $k - $bias);
                        if ($q < $t) {
                            break;
                        }
                        $output .= $this->digit($t + (($q - $t) % (self::BASE - $t)));
                        $q = (int) (($q - $t) / (self::BASE - $t));
                    }
                    $output .= $this->digit($q);
                    $bias = $this->adapt($delta, $handled + 1, $handled === count($basic));
                    $delta = 0;
                    $handled++;
                }
            }
            $delta++;
            $n++;
        }
        return $output;
    }

    /** RFC 3492 section 6.2. Returns null when the input is not valid Punycode. */
    private function decodeLabel($input)
    {
        $output = array();
        $separator = strrpos($input, '-');
        if ($separator !== false) {
            for ($index = 0; $index < $separator; $index++) {
                $ordinal = ord($input[$index]);
                if ($ordinal >= 128) {
                    return null;
                }
                $output[] = $ordinal;
            }
            $input = substr($input, $separator + 1);
        }
        $n = self::INITIAL_N;
        $i = 0;
        $bias = self::INITIAL_BIAS;
        $position = 0;
        $length = strlen($input);
        while ($position < $length) {
            $oldi = $i;
            $w = 1;
            for ($k = self::BASE; ; $k += self::BASE) {
                if ($position >= $length) {
                    return null;
                }
                $digit = $this->digitValue($input[$position++]);
                if ($digit === null) {
                    return null;
                }
                $i += $digit * $w;
                $t = $k <= $bias ? self::TMIN : ($k >= $bias + self::TMAX ? self::TMAX : $k - $bias);
                if ($digit < $t) {
                    break;
                }
                $w *= self::BASE - $t;
                if ($w > 4294967295) {
                    return null;
                }
            }
            $bias = $this->adapt($i - $oldi, count($output) + 1, $oldi === 0);
            $n += (int) ($i / (count($output) + 1));
            $i = $i % (count($output) + 1);
            array_splice($output, $i, 0, array($n));
            $i++;
        }
        return $output;
    }

    private function adapt($delta, $numPoints, $firstTime)
    {
        $delta = $firstTime ? (int) ($delta / self::DAMP) : (int) ($delta / 2);
        $delta += (int) ($delta / $numPoints);
        $k = 0;
        while ($delta > ((self::BASE - self::TMIN) * self::TMAX) / 2) {
            $delta = (int) ($delta / (self::BASE - self::TMIN));
            $k += self::BASE;
        }
        return $k + (int) (((self::BASE - self::TMIN + 1) * $delta) / ($delta + self::SKEW));
    }

    private function digit($value)
    {
        return chr($value < 26 ? 97 + $value : 22 + $value);
    }

    private function digitValue($character)
    {
        $ordinal = ord($character);
        if ($ordinal >= 48 && $ordinal <= 57) {
            return $ordinal - 22;
        }
        if ($ordinal >= 97 && $ordinal <= 122) {
            return $ordinal - 97;
        }
        if ($ordinal >= 65 && $ordinal <= 90) {
            return $ordinal - 65;
        }
        return null;
    }

    private function utf8ToCodePoints($value)
    {
        $codePoints = array();
        $length = strlen($value);
        for ($index = 0; $index < $length; $index++) {
            $ordinal = ord($value[$index]);
            if ($ordinal < 128) {
                $codePoints[] = $ordinal;
            } elseif (($ordinal & 0xE0) === 0xC0 && $index + 1 < $length) {
                $codePoints[] = (($ordinal & 0x1F) << 6) | (ord($value[++$index]) & 0x3F);
            } elseif (($ordinal & 0xF0) === 0xE0 && $index + 2 < $length) {
                $codePoints[] = (($ordinal & 0x0F) << 12) | ((ord($value[++$index]) & 0x3F) << 6) | (ord($value[++$index]) & 0x3F);
            } elseif (($ordinal & 0xF8) === 0xF0 && $index + 3 < $length) {
                $codePoints[] = (($ordinal & 0x07) << 18) | ((ord($value[++$index]) & 0x3F) << 12) | ((ord($value[++$index]) & 0x3F) << 6) | (ord($value[++$index]) & 0x3F);
            } else {
                $codePoints[] = 0xFFFD;
            }
        }
        return $codePoints;
    }

    private function codePointsToUtf8(array $codePoints)
    {
        $output = '';
        foreach ($codePoints as $codePoint) {
            if ($codePoint < 0x80) {
                $output .= chr($codePoint);
            } elseif ($codePoint < 0x800) {
                $output .= chr(0xC0 | ($codePoint >> 6)) . chr(0x80 | ($codePoint & 0x3F));
            } elseif ($codePoint < 0x10000) {
                $output .= chr(0xE0 | ($codePoint >> 12)) . chr(0x80 | (($codePoint >> 6) & 0x3F)) . chr(0x80 | ($codePoint & 0x3F));
            } else {
                $output .= chr(0xF0 | ($codePoint >> 18)) . chr(0x80 | (($codePoint >> 12) & 0x3F)) . chr(0x80 | (($codePoint >> 6) & 0x3F)) . chr(0x80 | ($codePoint & 0x3F));
            }
        }
        return $output;
    }

    /** A conservative mixed-script observation, never a verdict. */
    private function mixedScriptNotice($unicode)
    {
        $latin = preg_match('/[A-Za-z]/', $unicode) === 1 && preg_match('/[\x{0400}-\x{04FF}\x{0370}-\x{03FF}\x{0530}-\x{058F}\x{0590}-\x{05FF}]/u', $unicode) === 1;
        if (!$latin) {
            return '';
        }
        return 'This name mixes Latin characters with characters from another script, which is the pattern used by homograph lookalikes. Verify the registrant before relying on it.';
    }
}
