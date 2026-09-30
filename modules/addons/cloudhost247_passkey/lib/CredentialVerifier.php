<?php
/**
 * WebAuthn ceremony verification (W3C WebAuthn Level 2, §7.1 registration and
 * §7.2 authentication).
 *
 * Cryptographic signature verification is delegated to OpenSSL
 * (`openssl_verify`); this class performs the structural checks the standard
 * requires around it:
 *
 *   - clientDataJSON type is exactly "webauthn.create" / "webauthn.get",
 *   - the challenge in clientDataJSON matches the server-issued challenge,
 *     compared in constant time,
 *   - the origin is one of the explicitly configured allowed origins,
 *   - the RP ID hash inside authenticatorData equals SHA-256(configured RP ID),
 *   - the User Present flag is set, and User Verified is set when the policy
 *     requires it,
 *   - the signature counter never goes backwards (clone detection),
 *   - only supported COSE algorithms are accepted.
 *
 * Attestation: registration options request `attestation: "none"`, which is
 * the recommended setting for passkeys, so no attestation certificate chain is
 * validated. Self-attested or packed statements are accepted structurally but
 * the credential public key is always taken from authenticatorData, never
 * from the attestation statement. This is documented in docs/PASSKEY.md.
 */

namespace CloudHost247\Passkey;

final class CredentialVerifier
{
    const FLAG_USER_PRESENT = 0x01;
    const FLAG_USER_VERIFIED = 0x04;
    const FLAG_ATTESTED_DATA = 0x40;
    const FLAG_EXTENSION_DATA = 0x80;

    /**
     * Verifies a registration (attestation) response.
     *
     * @param array $response  {clientDataJSON, attestationObject} base64url strings
     * @param array $expected  {challenge, origins[], rpId, requireUserVerification}
     * @return array credential record fields
     */
    public static function verifyRegistration(array $response, array $expected)
    {
        $clientData = self::decodeClientData($response, 'webauthn.create', $expected);

        $attestationRaw = Base64Url::decode(isset($response['attestationObject']) ? $response['attestationObject'] : '');
        if ($attestationRaw === null) {
            throw new PasskeyException('Missing or malformed attestationObject.', 'malformed_response');
        }
        $attestation = Cbor::decodeAll($attestationRaw);
        if (!is_array($attestation) || !isset($attestation['fmt'], $attestation['authData'])) {
            throw new PasskeyException('Malformed attestation object.', 'malformed_response');
        }

        $authData = self::parseAuthenticatorData((string) $attestation['authData'], $expected, true);
        if (empty($authData['credentialId']) || empty($authData['coseKey'])) {
            throw new PasskeyException('Attestation object contains no credential.', 'malformed_response');
        }

        $key = Cose::toPem($authData['coseKey']);

        return array(
            'credential_id' => Base64Url::encode($authData['credentialId']),
            'public_key' => $key['pem'],
            'algorithm' => $key['alg'],
            'sign_count' => $authData['signCount'],
            'aaguid' => bin2hex($authData['aaguid']),
            'user_verified' => $authData['userVerified'],
            'backup_eligible' => $authData['backupEligible'],
            'backup_state' => $authData['backupState'],
            'attestation_format' => (string) $attestation['fmt'],
            'client_data' => $clientData,
        );
    }

    /**
     * Verifies an authentication (assertion) response against one stored
     * credential.
     *
     * @param array $response {clientDataJSON, authenticatorData, signature} base64url
     * @param array $credential stored record: public_key, algorithm, sign_count
     * @param array $expected  {challenge, origins[], rpId, requireUserVerification}
     * @return array {signCount:int, userVerified:bool, counterSupported:bool}
     */
    public static function verifyAssertion(array $response, array $credential, array $expected)
    {
        self::decodeClientData($response, 'webauthn.get', $expected);

        $authDataRaw = Base64Url::decode(isset($response['authenticatorData']) ? $response['authenticatorData'] : '');
        $signature = Base64Url::decode(isset($response['signature']) ? $response['signature'] : '');
        $clientDataRaw = Base64Url::decode(isset($response['clientDataJSON']) ? $response['clientDataJSON'] : '');
        if ($authDataRaw === null || $signature === null || $clientDataRaw === null) {
            throw new PasskeyException('Malformed assertion response.', 'malformed_response');
        }

        $authData = self::parseAuthenticatorData($authDataRaw, $expected, false);

        $publicKey = isset($credential['public_key']) ? (string) $credential['public_key'] : '';
        if ($publicKey === '') {
            throw new PasskeyException('Stored credential has no public key.', 'malformed_credential');
        }

        $algorithm = Cose::opensslAlgorithm(isset($credential['algorithm']) ? $credential['algorithm'] : Cose::ALG_ES256);
        $signedData = $authDataRaw . hash('sha256', $clientDataRaw, true);

        $result = @openssl_verify($signedData, $signature, $publicKey, $algorithm);
        if ($result !== 1) {
            // Drain the OpenSSL error queue so an unrelated later call cannot
            // inherit this failure state.
            while (function_exists('openssl_error_string') && openssl_error_string()) {
                // no-op
            }
            throw new PasskeyException('Assertion signature verification failed.', 'invalid_signature');
        }

        $storedCounter = isset($credential['sign_count']) ? (int) $credential['sign_count'] : 0;
        $newCounter = $authData['signCount'];
        // Authenticators that do not implement a counter always report 0; only
        // enforce monotonicity when the authenticator actually uses one.
        $counterSupported = !($storedCounter === 0 && $newCounter === 0);
        if ($counterSupported && $newCounter !== 0 && $newCounter <= $storedCounter) {
            throw new PasskeyException('Signature counter did not increase (possible cloned authenticator).', 'counter_replay');
        }

        return array(
            'signCount' => $newCounter,
            'userVerified' => $authData['userVerified'],
            'counterSupported' => $counterSupported,
            'backupState' => $authData['backupState'],
        );
    }

    // --- internals --------------------------------------------------------------------------

    private static function decodeClientData(array $response, $expectedType, array $expected)
    {
        $raw = Base64Url::decode(isset($response['clientDataJSON']) ? $response['clientDataJSON'] : '');
        if ($raw === null) {
            throw new PasskeyException('Missing or malformed clientDataJSON.', 'malformed_response');
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            throw new PasskeyException('clientDataJSON is not valid JSON.', 'malformed_response');
        }
        if (!isset($data['type']) || !hash_equals($expectedType, (string) $data['type'])) {
            throw new PasskeyException('Unexpected ceremony type in clientDataJSON.', 'type_mismatch');
        }

        $challenge = isset($data['challenge']) ? (string) $data['challenge'] : '';
        $expectedChallenge = isset($expected['challenge']) ? (string) $expected['challenge'] : '';
        if ($expectedChallenge === '' || !hash_equals($expectedChallenge, $challenge)) {
            throw new PasskeyException('Challenge mismatch.', 'challenge_mismatch');
        }

        $origin = isset($data['origin']) ? (string) $data['origin'] : '';
        $allowed = isset($expected['origins']) && is_array($expected['origins']) ? $expected['origins'] : array();
        $originOk = false;
        foreach ($allowed as $candidate) {
            if (hash_equals((string) $candidate, $origin)) {
                $originOk = true;
                break;
            }
        }
        if (!$originOk) {
            throw new PasskeyException('Origin is not allowed for this relying party.', 'origin_mismatch');
        }

        if (isset($data['crossOrigin']) && $data['crossOrigin'] === true) {
            throw new PasskeyException('Cross-origin ceremonies are refused.', 'cross_origin');
        }

        return $data;
    }

    /**
     * @return array{rpIdHash:string,flags:int,signCount:int,userVerified:bool,
     *               backupEligible:bool,backupState:bool,aaguid:string,
     *               credentialId:string,coseKey:array|null}
     */
    public static function parseAuthenticatorData($authData, array $expected, $requireAttestedData)
    {
        if (strlen($authData) < 37) {
            throw new PasskeyException('Authenticator data is too short.', 'malformed_response');
        }
        $rpIdHash = substr($authData, 0, 32);
        $flags = ord($authData[32]);
        $signCount = unpack('N', substr($authData, 33, 4));
        $signCount = (int) $signCount[1];

        $rpId = isset($expected['rpId']) ? (string) $expected['rpId'] : '';
        if ($rpId === '' || !hash_equals(hash('sha256', $rpId, true), $rpIdHash)) {
            throw new PasskeyException('RP ID hash mismatch.', 'rpid_mismatch');
        }

        if (!($flags & self::FLAG_USER_PRESENT)) {
            throw new PasskeyException('User presence was not established.', 'user_not_present');
        }
        $userVerified = (bool) ($flags & self::FLAG_USER_VERIFIED);
        if (!empty($expected['requireUserVerification']) && !$userVerified) {
            throw new PasskeyException('User verification was required but not performed.', 'user_not_verified');
        }

        $result = array(
            'rpIdHash' => $rpIdHash,
            'flags' => $flags,
            'signCount' => $signCount,
            'userVerified' => $userVerified,
            'backupEligible' => (bool) ($flags & 0x08),
            'backupState' => (bool) ($flags & 0x10),
            'aaguid' => str_repeat("\x00", 16),
            'credentialId' => '',
            'coseKey' => null,
        );

        $hasAttested = (bool) ($flags & self::FLAG_ATTESTED_DATA);
        if ($requireAttestedData && !$hasAttested) {
            throw new PasskeyException('Registration response carries no attested credential data.', 'malformed_response');
        }
        if (!$hasAttested) {
            return $result;
        }

        if (strlen($authData) < 55) {
            throw new PasskeyException('Attested credential data is truncated.', 'malformed_response');
        }
        $result['aaguid'] = substr($authData, 37, 16);
        $idLength = unpack('n', substr($authData, 53, 2));
        $idLength = (int) $idLength[1];
        if ($idLength < 16 || $idLength > 1023 || strlen($authData) < 55 + $idLength) {
            throw new PasskeyException('Credential id length is invalid.', 'malformed_response');
        }
        $result['credentialId'] = substr($authData, 55, $idLength);

        $remaining = substr($authData, 55 + $idLength);
        $consumed = 0;
        $cose = Cbor::decode($remaining, $consumed);
        if (!is_array($cose)) {
            throw new PasskeyException('Credential public key is not a COSE key.', 'malformed_response');
        }
        $result['coseKey'] = $cose;
        return $result;
    }
}
