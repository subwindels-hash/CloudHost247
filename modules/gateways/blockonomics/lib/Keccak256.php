<?php
/**
 * Pure-PHP Keccak-256 — the hash Ethereum uses — plus EIP-55 address checksums.
 *
 * Why this exists: `usdtAddressValid()` must reject a mixed-case EVM address whose
 * capitalisation does not match its EIP-55 checksum. That is the guard which catches a
 * mistyped receiving address before USDT is sent to it, and it cannot be expressed with
 * `hash('sha3-256', ...)`: SHA3-256 and Keccak-256 use different padding and produce
 * different digests (SHA3-256("") = a7ffc6f8…, Keccak-256("") = c5d24601…). No PHP build
 * in this repository's support matrix ships a keccak-256 algorithm in ext-hash, and ext-gmp
 * is not required either, so the permutation is implemented here in plain PHP using 32-bit
 * lane halves — every intermediate value stays below 2^32, so the arithmetic is identical
 * on 32-bit and 64-bit builds and needs no integer-overflow assumptions.
 *
 * Verified against the published vectors in tests/payments/run.php: the empty string, "abc",
 * and the official EIP-55 examples from the specification.
 */

namespace Blockonomics;

final class Keccak256
{
    /** Keccak-256 rate in bytes (1088-bit rate, 512-bit capacity). */
    const RATE = 136;

    /** Round constants, split into 32-bit halves (index 0 = high, 1 = low). */
    private static $rc = array(
        array(0x00000000, 0x00000001), array(0x00000000, 0x00008082),
        array(0x80000000, 0x0000808a), array(0x80000000, 0x80008000),
        array(0x00000000, 0x0000808b), array(0x00000000, 0x80000001),
        array(0x80000000, 0x80008081), array(0x80000000, 0x00008009),
        array(0x00000000, 0x0000008a), array(0x00000000, 0x00000088),
        array(0x00000000, 0x80008009), array(0x00000000, 0x8000000a),
        array(0x00000000, 0x8000808b), array(0x80000000, 0x0000008b),
        array(0x80000000, 0x00008089), array(0x80000000, 0x00008003),
        array(0x80000000, 0x00008002), array(0x80000000, 0x00000080),
        array(0x00000000, 0x0000800a), array(0x80000000, 0x8000000a),
        array(0x80000000, 0x80008081), array(0x80000000, 0x00008080),
        array(0x00000000, 0x80000001), array(0x80000000, 0x80008008),
    );

    /** Rotation offsets, indexed x + 5y. */
    private static $rot = array(
        0, 1, 62, 28, 27,
        36, 44, 6, 55, 20,
        3, 10, 43, 25, 39,
        41, 45, 15, 21, 8,
        18, 2, 61, 56, 14,
    );

    /**
     * Keccak-256 of a binary string, returned as lowercase hex.
     *
     * @param string $input
     * @return string 64 hex characters
     */
    public static function hash($input)
    {
        $stateLo = array_fill(0, 25, 0);
        $stateHi = array_fill(0, 25, 0);

        // pad10*1 (Keccak padding, not SHA3's 0x06 domain separation)
        $message = $input . "\x01";
        $remainder = strlen($message) % self::RATE;
        if ($remainder !== 0) {
            $message .= str_repeat("\x00", self::RATE - $remainder);
        }
        $last = strlen($message) - 1;
        $message[$last] = chr(ord($message[$last]) ^ 0x80);

        $blocks = str_split($message, self::RATE);
        foreach ($blocks as $block) {
            for ($i = 0; $i < 17; $i++) {
                $o = $i * 8;
                $stateLo[$i] ^= ord($block[$o]) | (ord($block[$o + 1]) << 8)
                    | (ord($block[$o + 2]) << 16) | (ord($block[$o + 3]) << 24);
                $stateHi[$i] ^= ord($block[$o + 4]) | (ord($block[$o + 5]) << 8)
                    | (ord($block[$o + 6]) << 16) | (ord($block[$o + 7]) << 24);
            }
            self::permute($stateLo, $stateHi);
        }

        $out = '';
        for ($i = 0; $i < 4; $i++) {
            $lo = $stateLo[$i];
            $hi = $stateHi[$i];
            $out .= chr($lo & 0xff) . chr(($lo >> 8) & 0xff)
                . chr(($lo >> 16) & 0xff) . chr(($lo >> 24) & 0xff)
                . chr($hi & 0xff) . chr(($hi >> 8) & 0xff)
                . chr(($hi >> 16) & 0xff) . chr(($hi >> 24) & 0xff);
        }

        return bin2hex($out);
    }

    /** Keccak-f[1600]: 24 rounds over 25 64-bit lanes held as two 32-bit halves each. */
    private static function permute(array &$lo, array &$hi)
    {
        for ($round = 0; $round < 24; $round++) {
            // theta
            $cLo = array();
            $cHi = array();
            for ($x = 0; $x < 5; $x++) {
                $cLo[$x] = $lo[$x] ^ $lo[$x + 5] ^ $lo[$x + 10] ^ $lo[$x + 15] ^ $lo[$x + 20];
                $cHi[$x] = $hi[$x] ^ $hi[$x + 5] ^ $hi[$x + 10] ^ $hi[$x + 15] ^ $hi[$x + 20];
            }
            for ($x = 0; $x < 5; $x++) {
                $p = ($x + 4) % 5;
                $q = ($x + 1) % 5;
                $tLo = 0;
                $tHi = 0;
                self::rotl($cLo[$q], $cHi[$q], 1, $tLo, $tHi);
                $dLo = $cLo[$p] ^ $tLo;
                $dHi = $cHi[$p] ^ $tHi;
                for ($y = 0; $y < 5; $y++) {
                    $lo[$x + 5 * $y] ^= $dLo;
                    $hi[$x + 5 * $y] ^= $dHi;
                }
            }

            // rho + pi: B[y][(2x+3y) mod 5] = rot(A[x][y], r[x][y])
            $bLo = array_fill(0, 25, 0);
            $bHi = array_fill(0, 25, 0);
            for ($x = 0; $x < 5; $x++) {
                for ($y = 0; $y < 5; $y++) {
                    $from = $x + 5 * $y;
                    $to = $y + 5 * ((2 * $x + 3 * $y) % 5);
                    self::rotl($lo[$from], $hi[$from], self::$rot[$from], $bLo[$to], $bHi[$to]);
                }
            }

            // chi
            for ($y = 0; $y < 5; $y++) {
                for ($x = 0; $x < 5; $x++) {
                    $i = $x + 5 * $y;
                    $i1 = (($x + 1) % 5) + 5 * $y;
                    $i2 = (($x + 2) % 5) + 5 * $y;
                    $lo[$i] = $bLo[$i] ^ (~$bLo[$i1] & $bLo[$i2]);
                    $hi[$i] = $bHi[$i] ^ (~$bHi[$i1] & $bHi[$i2]);
                }
            }

            // iota
            $lo[0] ^= self::$rc[$round][1];
            $hi[0] ^= self::$rc[$round][0];
        }
    }

    /** Rotate a 64-bit lane (lo, hi) left by $n bits, writing $outLo / $outHi. */
    private static function rotl($lo, $hi, $n, &$outLo, &$outHi)
    {
        if ($n === 0) {
            $outLo = $lo;
            $outHi = $hi;
            return;
        }
        if ($n === 32) {
            $outLo = $hi;
            $outHi = $lo;
            return;
        }
        if ($n < 32) {
            $m = 32 - $n;
            $outLo = (($lo << $n) | ($hi >> $m)) & 0xffffffff;
            $outHi = (($hi << $n) | ($lo >> $m)) & 0xffffffff;
            return;
        }
        $m = $n - 32;
        $k = 32 - $m;
        $outLo = (($hi << $m) | ($lo >> $k)) & 0xffffffff;
        $outHi = (($lo << $m) | ($hi >> $k)) & 0xffffffff;
    }

    /**
     * The EIP-55 mixed-case form of a 0x address (input is lowercased first).
     *
     * @param string $address
     * @return string
     */
    public static function checksumAddress($address)
    {
        $hex = strtolower(substr($address, 2));
        $hash = self::hash($hex);
        $out = '';
        for ($i = 0; $i < 40; $i++) {
            $character = $hex[$i];
            if ($character >= 'a' && $character <= 'f' && hexdec($hash[$i]) >= 8) {
                $character = strtoupper($character);
            }
            $out .= $character;
        }
        return '0x' . $out;
    }

    /**
     * EIP-55 validity: an address written entirely in one case carries no checksum
     * information and is accepted; a mixed-case address must match its checksum.
     *
     * @param string $address
     * @return bool
     */
    public static function checksumValid($address)
    {
        $hex = substr($address, 2);
        if ($hex === strtolower($hex) || $hex === strtoupper($hex)) {
            return true;
        }
        return $address === self::checksumAddress($address);
    }
}
