<?php
/**
 * Minimal, strict CBOR (RFC 8949) decoder for the subset WebAuthn uses:
 * unsigned/negative integers, byte strings, text strings, arrays, maps and
 * the simple values true/false/null.
 *
 * This is *parsing*, not cryptography — all signature verification is done by
 * OpenSSL (see CredentialVerifier). The decoder is deliberately strict:
 *   - indefinite-length items are rejected (WebAuthn never uses them and they
 *     are a classic parser-confusion vector),
 *   - trailing bytes are reported to the caller rather than ignored,
 *   - nesting depth and item counts are bounded so a hostile attestation
 *     object cannot exhaust memory or the stack.
 */

namespace CloudHost247\Passkey;

final class Cbor
{
    const MAX_DEPTH = 16;
    const MAX_ITEMS = 1024;

    /**
     * Decodes one CBOR data item.
     *
     * @param string   $binary
     * @param int|null $bytesConsumed receives the number of bytes consumed
     * @return mixed
     * @throws PasskeyException on malformed input
     */
    public static function decode($binary, &$bytesConsumed = null)
    {
        $offset = 0;
        $value = self::decodeItem((string) $binary, $offset, 0);
        $bytesConsumed = $offset;
        return $value;
    }

    /** Decodes a complete buffer, rejecting trailing data. */
    public static function decodeAll($binary)
    {
        $consumed = 0;
        $value = self::decode($binary, $consumed);
        if ($consumed !== strlen((string) $binary)) {
            throw new PasskeyException('Malformed CBOR: unexpected trailing data.');
        }
        return $value;
    }

    private static function decodeItem($binary, &$offset, $depth)
    {
        if ($depth > self::MAX_DEPTH) {
            throw new PasskeyException('Malformed CBOR: nesting too deep.');
        }
        $initial = self::byteAt($binary, $offset);
        $offset++;
        $major = $initial >> 5;
        $additional = $initial & 0x1f;

        if ($additional === 31) {
            throw new PasskeyException('Malformed CBOR: indefinite lengths are not accepted.');
        }

        $value = self::readLength($binary, $offset, $additional);

        switch ($major) {
            case 0: // unsigned integer
                return $value;
            case 1: // negative integer
                return -1 - $value;
            case 2: // byte string
                return self::readBytes($binary, $offset, $value);
            case 3: // text string
                return self::readBytes($binary, $offset, $value);
            case 4: // array
                self::guardCount($value);
                $items = array();
                for ($i = 0; $i < $value; $i++) {
                    $items[] = self::decodeItem($binary, $offset, $depth + 1);
                }
                return $items;
            case 5: // map
                self::guardCount($value);
                $map = array();
                for ($i = 0; $i < $value; $i++) {
                    $key = self::decodeItem($binary, $offset, $depth + 1);
                    if (!is_int($key) && !is_string($key)) {
                        throw new PasskeyException('Malformed CBOR: unsupported map key type.');
                    }
                    if (array_key_exists($key, $map)) {
                        throw new PasskeyException('Malformed CBOR: duplicate map key.');
                    }
                    $map[$key] = self::decodeItem($binary, $offset, $depth + 1);
                }
                return $map;
            case 7: // simple values
                if ($additional === 20) {
                    return false;
                }
                if ($additional === 21) {
                    return true;
                }
                if ($additional === 22 || $additional === 23) {
                    return null;
                }
                throw new PasskeyException('Malformed CBOR: unsupported simple value.');
            default:
                throw new PasskeyException('Malformed CBOR: unsupported major type.');
        }
    }

    private static function readLength($binary, &$offset, $additional)
    {
        if ($additional < 24) {
            return $additional;
        }
        $lengths = array(24 => 1, 25 => 2, 26 => 4, 27 => 8);
        if (!isset($lengths[$additional])) {
            throw new PasskeyException('Malformed CBOR: reserved additional information.');
        }
        $bytes = self::readBytes($binary, $offset, $lengths[$additional]);
        $value = 0;
        for ($i = 0, $len = strlen($bytes); $i < $len; $i++) {
            $value = ($value << 8) | ord($bytes[$i]);
            if ($value < 0 || $value > PHP_INT_MAX) {
                throw new PasskeyException('Malformed CBOR: length out of range.');
            }
        }
        return $value;
    }

    private static function readBytes($binary, &$offset, $length)
    {
        if ($length < 0 || $offset + $length > strlen($binary)) {
            throw new PasskeyException('Malformed CBOR: truncated data.');
        }
        $bytes = substr($binary, $offset, $length);
        $offset += $length;
        return $bytes;
    }

    private static function byteAt($binary, $offset)
    {
        if ($offset >= strlen($binary)) {
            throw new PasskeyException('Malformed CBOR: truncated data.');
        }
        return ord($binary[$offset]);
    }

    private static function guardCount($count)
    {
        if ($count > self::MAX_ITEMS) {
            throw new PasskeyException('Malformed CBOR: too many items.');
        }
    }

    /**
     * Encodes the small subset needed to re-serialise a COSE key or to build
     * fixtures in tests. Only integers, byte strings, text strings, arrays and
     * maps are supported, which is everything WebAuthn requires.
     */
    public static function encode($value)
    {
        if (is_int($value)) {
            return $value >= 0 ? self::head(0, $value) : self::head(1, -1 - $value);
        }
        if (is_string($value)) {
            return self::head(2, strlen($value)) . $value;
        }
        if (is_array($value)) {
            $isList = array_keys($value) === range(0, count($value) - 1);
            if ($isList) {
                $out = self::head(4, count($value));
                foreach ($value as $item) {
                    $out .= self::encode($item);
                }
                return $out;
            }
            $out = self::head(5, count($value));
            foreach ($value as $key => $item) {
                $out .= self::encode(is_int($key) ? (int) $key : (string) $key);
                $out .= self::encode($item);
            }
            return $out;
        }
        throw new PasskeyException('Unsupported CBOR value.');
    }

    private static function head($major, $length)
    {
        $prefix = $major << 5;
        if ($length < 24) {
            return chr($prefix | $length);
        }
        if ($length < 0x100) {
            return chr($prefix | 24) . chr($length);
        }
        if ($length < 0x10000) {
            return chr($prefix | 25) . pack('n', $length);
        }
        return chr($prefix | 26) . pack('N', $length);
    }
}
