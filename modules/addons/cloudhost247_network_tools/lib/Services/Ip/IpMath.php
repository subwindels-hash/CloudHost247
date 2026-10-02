<?php
namespace CloudHost247\NetworkTools\Services\Ip;

/**
 * Dependency-free 32-bit and 128-bit address arithmetic (docs sections 22, 23).
 *
 * Everything works on the packed binary form from inet_pton, so the same code
 * path is correct for IPv4 and IPv6 and the results are exact — no floating
 * point, no bcmath/gmp requirement, and identical output on every PHP 7.4-8.2
 * build. The decimal conversions use long division on the binary string, which
 * is what makes IPv6-to-decimal possible without a big-integer extension.
 */
final class IpMath
{
    private static $decimal = array('0', '1', '2', '3', '4', '5', '6', '7', '8', '9');

    /** @return string|null packed bytes, or null when not an IP */
    public static function packed($ip)
    {
        $packed = @inet_pton(trim((string) $ip, " \t\n\r[]"));
        return $packed === false ? null : $packed;
    }

    public static function bits($ip)
    {
        $packed = self::packed($ip);
        if ($packed === null) {
            return null;
        }
        return strlen($packed) === 4 ? 32 : 128;
    }

    /** Binary string -> decimal string (unsigned). */
    public static function binaryToDecimal($binary)
    {
        $digits = array(0);
        $length = strlen($binary);
        for ($i = 0; $i < $length; $i++) {
            $carry = ord($binary[$i]);
            for ($j = 0; $j < count($digits); $j++) {
                $value = $digits[$j] * 256 + $carry;
                $digits[$j] = $value % 10;
                $carry = intdiv($value, 10);
            }
            while ($carry > 0) {
                $digits[] = $carry % 10;
                $carry = intdiv($carry, 10);
            }
        }
        $out = '';
        for ($i = count($digits) - 1; $i >= 0; $i--) {
            $out .= (string) $digits[$i];
        }
        return ltrim($out, '0') === '' ? '0' : $out;
    }

    /**
     * Decimal string -> packed bytes of the given width.
     *
     * @return string|null null when the value does not fit the width
     */
    public static function decimalToBinary($decimal, $bytes)
    {
        $decimal = trim((string) $decimal);
        if (!preg_match('/^\d{1,40}$/', $decimal)) {
            return null;
        }
        $digits = array_map('intval', str_split(ltrim($decimal, '0') === '' ? '0' : $decimal));
        $binary = array_fill(0, $bytes, 0);
        foreach ($digits as $digit) {
            $carry = $digit;
            for ($i = 0; $i < $bytes; $i++) {
                $index = $bytes - 1 - $i;
                $value = $binary[$index] * 10 + $carry;
                $binary[$index] = $value & 0xff;
                $carry = $value >> 8;
            }
            if ($carry !== 0) {
                return null; // overflowed the requested width
            }
        }
        $out = '';
        foreach ($binary as $byte) {
            $out .= chr($byte);
        }
        return $out;
    }

    /** Long division of a binary string by 10, returning remainder; used by tests. */
    public static function binaryModulo10($binary)
    {
        $remainder = 0;
        for ($i = 0; $i < strlen($binary); $i++) {
            $remainder = (($remainder << 8) | ord($binary[$i])) % 10;
        }
        return $remainder;
    }

    public static function count($prefix, $bits)
    {
        $hostBits = $bits - $prefix;
        if ($hostBits <= 0) {
            return '1';
        }
        if ($hostBits > 200) {
            // Beyond this the exact count is unreadable anyway; the power form
            // is still exact and is what the UI shows.
            return '2^' . $hostBits;
        }
        $decimal = '1';
        for ($i = 0; $i < $hostBits; $i++) {
            $decimal = self::doubleDecimal($decimal);
        }
        return $decimal;
    }

    public static function doubleDecimal($decimal)
    {
        $carry = 0;
        $out = '';
        for ($i = strlen($decimal) - 1; $i >= 0; $i--) {
            $value = ((int) $decimal[$i]) * 2 + $carry;
            $out = (string) ($value % 10) . $out;
            $carry = $value >= 10 ? 1 : 0;
        }
        if ($carry) {
            $out = '1' . $out;
        }
        return ltrim($out, '0') === '' ? '0' : $out;
    }

    /** Network address (all host bits cleared). */
    public static function networkAddress($binary, $prefix)
    {
        return self::applyMask($binary, $prefix);
    }

    /** Last address in the block (all host bits set). */
    public static function lastAddress($binary, $prefix)
    {
        return self::applyMask($binary, $prefix, true);
    }

    public static function applyMask($binary, $prefix, $invert = false)
    {
        $bits = strlen($binary) * 8;
        $out = '';
        for ($index = 0; $index < strlen($binary); $index++) {
            $byte = ord($binary[$index]);
            for ($bit = 0; $bit < 8; $bit++) {
                $position = $index * 8 + $bit;
                $keep = $position < $prefix;
                if ($invert) {
                    if (!$keep) {
                        $byte |= (1 << (7 - $bit));
                    }
                } elseif (!$keep) {
                    $byte &= ~(1 << (7 - $bit)) & 0xff;
                }
            }
            $out .= chr($byte);
        }
        return $out;
    }

    public static function increment($binary, $by = 1)
    {
        $bytes = array_map('ord', str_split($binary));
        for ($i = count($bytes) - 1; $i >= 0; $i--) {
            if ($by === 0) {
                break;
            }
            $add = $by & 0xff;
            $value = $bytes[$i] + $add;
            $bytes[$i] = $value & 0xff;
            $by = ($by >> 8) + ($value >> 8);
        }
        $out = '';
        foreach ($bytes as $byte) {
            $out .= chr($byte);
        }
        return $out;
    }

    public static function decrement($binary, $by = 1)
    {
        $bytes = array_map('ord', str_split($binary));
        for ($i = count($bytes) - 1; $i >= 0; $i--) {
            if ($by === 0) {
                break;
            }
            $sub = $by & 0xff;
            $value = $bytes[$i] - $sub;
            if ($value < 0) {
                $borrow = intdiv(-$value + 255, 256);
                $bytes[$i] = ($value + 256 * $borrow) & 0xff;
                $by = ($by >> 8) + $borrow;
            } else {
                $bytes[$i] = $value & 0xff;
                $by >>= 8;
            }
        }
        $out = '';
        foreach ($bytes as $byte) {
            $out .= chr($byte);
        }
        return $out;
    }

    public static function compare($a, $b)
    {
        $length = max(strlen($a), strlen($b));
        $a = str_pad($a, $length, "\x00", STR_PAD_LEFT);
        $b = str_pad($b, $length, "\x00", STR_PAD_LEFT);
        return strcmp($a, $b) <=> 0;
    }

    /** Trailing zero bits of the address — the largest block it can start. */
    public static function trailingZeros($binary)
    {
        $count = 0;
        for ($i = strlen($binary) - 1; $i >= 0; $i--) {
            $byte = ord($binary[$i]);
            if ($byte === 0) {
                $count += 8;
                continue;
            }
            while (($byte & 1) === 0) {
                $count++;
                $byte >>= 1;
            }
            return $count;
        }
        return $count;
    }

    /** Number of leading equal bits between two packed addresses. */
    public static function commonPrefix($a, $b)
    {
        $bits = strlen($a) * 8;
        for ($i = 0; $i < strlen($a); $i++) {
            $x = ord($a[$i]) ^ ord($b[$i]);
            if ($x === 0) {
                continue;
            }
            for ($bit = 7; $bit >= 0; $bit--) {
                if (($x >> $bit) & 1) {
                    return $i * 8 + (7 - $bit);
                }
            }
        }
        return $bits;
    }

    /**
     * Cover an inclusive address range with the minimal set of CIDR blocks.
     *
     * @return array<int,array{cidr:string,prefix:int,count:string}>
     */
    public static function rangeToCidrs($start, $end, $maxBlocks = 256)
    {
        $bits = strlen($start) * 8;
        if (self::compare($start, $end) > 0) {
            return array();
        }
        $blocks = array();
        $current = $start;
        while (self::compare($current, $end) <= 0 && count($blocks) < $maxBlocks) {
            $alignment = max(0, self::trailingZeros($current));
            $prefix = $bits - $alignment;
            // Do not step past the end of the range.
            while ($prefix < $bits) {
                $blockEnd = self::lastAddress($current, $prefix);
                if (self::compare($blockEnd, $end) <= 0) {
                    break;
                }
                $prefix++;
            }
            $blockEnd = self::lastAddress($current, $prefix);
            $blocks[] = array(
                'cidr' => @inet_ntop($current) . '/' . $prefix,
                'network' => @inet_ntop($current),
                'last' => @inet_ntop($blockEnd),
                'prefix' => $prefix,
                'count' => self::count($prefix, $bits),
            );
            if (self::compare($blockEnd, $end) >= 0) {
                break;
            }
            $current = self::increment($blockEnd);
        }
        return $blocks;
    }

    public static function ipv4ToMapped($ipv4)
    {
        $packed = self::packed($ipv4);
        if ($packed === null || strlen($packed) !== 4) {
            return null;
        }
        return inet_ntop("\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\xff\xff" . $packed);
    }

    /** IPv4 carried by a mapped (::ffff:) or NAT64 (64:ff9b::/96) address. */
    public static function ipv6ToIpv4($ipv6)
    {
        $packed = self::packed($ipv6);
        if ($packed === null || strlen($packed) !== 16) {
            return null;
        }
        $prefix = substr($packed, 0, 12);
        if ($prefix === "\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\xff\xff" || $prefix === "\x00\x64\xff\x9b\x00\x00\x00\x00\x00\x00\x00\x00") {
            return inet_ntop(substr($packed, 12));
        }
        return null;
    }

    public static function expand($ipv6)
    {
        $packed = self::packed($ipv6);
        if ($packed === null || strlen($packed) !== 16) {
            return null;
        }
        $groups = unpack('n8', $packed);
        return implode(':', array_map(function ($group) {
            return str_pad(dechex($group), 4, '0', STR_PAD_LEFT);
        }, $groups));
    }

    public static function compress($ipv6)
    {
        $packed = self::packed($ipv6);
        if ($packed === null || strlen($packed) !== 16) {
            return null;
        }
        return inet_ntop($packed);
    }

    /**
     * Binary representation: dotted octets for IPv4, colon groups of 16 bits
     * for IPv6, exactly as a network engineer writes it.
     */
    public static function binaryString($binary, $separator = null)
    {
        $length = strlen($binary);
        if ($length === 4) {
            $octets = array();
            for ($i = 0; $i < 4; $i++) {
                $octets[] = str_pad(decbin(ord($binary[$i])), 8, '0', STR_PAD_LEFT);
            }
            return implode($separator === null ? '.' : $separator, $octets);
        }
        if ($length === 16) {
            $groups = array();
            $words = unpack('n8', $binary);
            foreach ($words as $word) {
                $groups[] = str_pad(decbin($word), 16, '0', STR_PAD_LEFT);
            }
            return implode($separator === null ? ':' : $separator, $groups);
        }
        return '';
    }

    public static function maskAddress($prefix, $bits)
    {
        $bytes = (int) ($bits / 8);
        $binary = str_repeat("\xff", (int) ($prefix / 8));
        $remainder = $prefix % 8;
        if ($remainder > 0) {
            $binary .= chr((0xff << (8 - $remainder)) & 0xff);
        }
        $binary = str_pad($binary, $bytes, "\x00");
        return @inet_ntop($binary);
    }

    public static function wildcardMaskAddress($prefix, $bits)
    {
        $bytes = (int) ($bits / 8);
        $binary = str_repeat("\x00", (int) ($prefix / 8));
        $remainder = $prefix % 8;
        if ($remainder > 0) {
            $binary .= chr((0xff >> $remainder) & 0xff);
        }
        $binary = str_pad($binary, $bytes, "\xff");
        return @inet_ntop($binary);
    }
}
