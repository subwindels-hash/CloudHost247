<?php
/**
 * COSE_Key (RFC 8152) → PEM conversion.
 *
 * WebAuthn hands us the credential public key as a COSE map. OpenSSL needs a
 * SubjectPublicKeyInfo, so this class performs the DER encoding. It is pure
 * structure encoding — every cryptographic operation is performed by OpenSSL.
 *
 * Supported algorithms (the ones platform authenticators actually produce):
 *   -7   ES256  ECDSA w/ SHA-256 on P-256
 *   -35  ES384  ECDSA w/ SHA-384 on P-384
 *   -257 RS256  RSASSA-PKCS1-v1_5 w/ SHA-256
 *
 * EdDSA (-8) is intentionally rejected with a clear error rather than being
 * silently accepted, because PHP's OpenSSL binding cannot verify Ed25519 on
 * every supported PHP version and a pretended success would be a security bug.
 */

namespace CloudHost247\Passkey;

final class Cose
{
    const ALG_ES256 = -7;
    const ALG_EDDSA = -8;
    const ALG_ES384 = -35;
    const ALG_RS256 = -257;

    const KTY_OKP = 1;
    const KTY_EC2 = 2;
    const KTY_RSA = 3;

    /** Algorithms advertised in registration options, most preferred first. */
    public static function supportedAlgorithms()
    {
        return array(self::ALG_ES256, self::ALG_ES384, self::ALG_RS256);
    }

    public static function isSupportedAlgorithm($alg)
    {
        return in_array((int) $alg, self::supportedAlgorithms(), true);
    }

    public static function opensslAlgorithm($alg)
    {
        switch ((int) $alg) {
            case self::ALG_ES256:
            case self::ALG_RS256:
                return OPENSSL_ALGO_SHA256;
            case self::ALG_ES384:
                return OPENSSL_ALGO_SHA384;
        }
        throw new PasskeyException('Unsupported COSE algorithm.', 'unsupported_algorithm');
    }

    /**
     * @param array $cose decoded COSE_Key map
     * @return array{alg:int,pem:string}
     */
    public static function toPem(array $cose)
    {
        $kty = isset($cose[1]) ? (int) $cose[1] : 0;
        $alg = isset($cose[3]) ? (int) $cose[3] : 0;

        if ($kty === self::KTY_OKP || $alg === self::ALG_EDDSA) {
            throw new PasskeyException('EdDSA credentials are not supported by this deployment.', 'unsupported_algorithm');
        }
        if (!self::isSupportedAlgorithm($alg)) {
            throw new PasskeyException('Unsupported COSE algorithm.', 'unsupported_algorithm');
        }

        if ($kty === self::KTY_EC2) {
            return array('alg' => $alg, 'pem' => self::ec2Pem($cose, $alg));
        }
        if ($kty === self::KTY_RSA) {
            return array('alg' => $alg, 'pem' => self::rsaPem($cose));
        }
        throw new PasskeyException('Unsupported COSE key type.', 'unsupported_algorithm');
    }

    private static function ec2Pem(array $cose, $alg)
    {
        $crv = isset($cose[-1]) ? (int) $cose[-1] : 0;
        $x = isset($cose[-2]) ? (string) $cose[-2] : '';
        $y = isset($cose[-3]) ? (string) $cose[-3] : '';

        // Curve must match the algorithm: an attacker must not be able to pair
        // a P-256 key with an ES384 declaration (or vice versa).
        $curves = array(
            1 => array('oid' => '2a8648ce3d030107', 'size' => 32, 'alg' => self::ALG_ES256), // P-256
            2 => array('oid' => '2b81040022', 'size' => 48, 'alg' => self::ALG_ES384),       // P-384
        );
        if (!isset($curves[$crv]) || $curves[$crv]['alg'] !== (int) $alg) {
            throw new PasskeyException('Unsupported or mismatched elliptic curve.', 'unsupported_algorithm');
        }
        $size = $curves[$crv]['size'];
        if (strlen($x) !== $size || strlen($y) !== $size) {
            throw new PasskeyException('Malformed elliptic-curve public key.', 'malformed_credential');
        }

        $point = self::derBitString("\x04" . $x . $y);
        $algorithmId = self::derSequence(
            self::derOid('2a8648ce3d0201') . self::derOid($curves[$crv]['oid'])
        );
        return self::pem(self::derSequence($algorithmId . $point));
    }

    private static function rsaPem(array $cose)
    {
        $n = isset($cose[-1]) ? (string) $cose[-1] : '';
        $e = isset($cose[-2]) ? (string) $cose[-2] : '';
        if ($n === '' || $e === '') {
            throw new PasskeyException('Malformed RSA public key.', 'malformed_credential');
        }
        // Reject undersized moduli outright rather than storing a weak key.
        if (strlen(ltrim($n, "\x00")) < 256) {
            throw new PasskeyException('RSA credentials below 2048 bits are rejected.', 'weak_credential');
        }
        $rsaKey = self::derSequence(self::derInteger($n) . self::derInteger($e));
        $algorithmId = self::derSequence(self::derOid('2a864886f70d010101') . "\x05\x00");
        return self::pem(self::derSequence($algorithmId . self::derBitString($rsaKey)));
    }

    // --- Minimal DER encoding helpers ---------------------------------------------------------

    private static function derLength($length)
    {
        if ($length < 0x80) {
            return chr($length);
        }
        $bytes = '';
        while ($length > 0) {
            $bytes = chr($length & 0xff) . $bytes;
            $length >>= 8;
        }
        return chr(0x80 | strlen($bytes)) . $bytes;
    }

    private static function derSequence($contents)
    {
        return "\x30" . self::derLength(strlen($contents)) . $contents;
    }

    private static function derBitString($contents)
    {
        $body = "\x00" . $contents;
        return "\x03" . self::derLength(strlen($body)) . $body;
    }

    private static function derOid($hex)
    {
        $bytes = pack('H*', $hex);
        return "\x06" . self::derLength(strlen($bytes)) . $bytes;
    }

    private static function derInteger($bytes)
    {
        $bytes = ltrim($bytes, "\x00");
        if ($bytes === '') {
            $bytes = "\x00";
        }
        if (ord($bytes[0]) & 0x80) {
            $bytes = "\x00" . $bytes;
        }
        return "\x02" . self::derLength(strlen($bytes)) . $bytes;
    }

    private static function pem($der)
    {
        return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
    }
}
