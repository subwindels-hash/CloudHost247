<?php
namespace CloudHost247\NetworkTools\Services\Dns;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Dns\DnsClient;
use CloudHost247\NetworkTools\Services\Service;

/**
 * DKIM Checker (docs section 10).
 *
 * Reads selector._domainkey.<domain> for each requested selector, validates the
 * DKIM key record, decodes the public key and — for RSA keys — reports the real
 * modulus size by parsing the DER SubjectPublicKeyInfo, rather than guessing it.
 */
final class DkimService extends Service
{
    const MAX_SELECTORS = 5;

    protected function execute()
    {
        $domain = $this->input['domain'];
        $selectors = preg_split('/[,\s]+/', (string) $this->input['selectors'], -1, PREG_SPLIT_NO_EMPTY);
        $selectors = array_values(array_unique(array_map('strtolower', $selectors)));
        if (count($selectors) > self::MAX_SELECTORS) {
            return ToolResult::invalid('At most ' . self::MAX_SELECTORS . ' selectors can be checked at once.');
        }
        $results = array();
        $found = 0;
        foreach ($selectors as $selector) {
            if (!preg_match('/^[a-z0-9]([a-z0-9._-]{0,61}[a-z0-9])?$/', $selector)) {
                $results[] = array('selector' => $selector, 'status' => 'ERROR', 'message' => 'That selector is not a valid DNS label.', 'record' => '', 'checks' => array());
                continue;
            }
            $name = $selector . '._domainkey.' . $domain;
            $response = $this->querySystem($name, 'TXT');
            $record = '';
            if ($response['ok']) {
                foreach (DnsClient::values($response['records'], 'TXT') as $value) {
                    if (stripos(trim($value), 'v=DKIM1') === 0 || stripos(trim($value), 'p=') !== false || stripos(trim($value), 'k=') !== false) {
                        $record = trim($value);
                        break;
                    }
                }
            }
            $analysis = $this->analyse($selector, $name, $record, $response);
            $results[] = $analysis;
            if ($analysis['status'] === 'PASS' || $analysis['status'] === 'WARNING') {
                $found++;
            }
        }
        $status = 'PASS';
        foreach ($results as $result) {
            if ($result['status'] === 'ERROR') { $status = 'ERROR'; break; }
            if ($result['status'] === 'WARNING') { $status = 'WARNING'; }
        }
        return ToolResult::success(array(
            'domain' => $domain,
            'selectors_checked' => count($selectors),
            'selectors_with_keys' => $found,
            'results' => $results,
            'status' => $status,
            'summary' => $found . ' of ' . count($selectors) . ' selector(s) publish a usable key.',
            'explanation' => 'A DKIM key record is published at <selector>._domainkey.<domain>. It contains the public half of the signing key; the private half stays on the mail server and is never visible here.',
        ), array(), array('timestamp' => gmdate('c')));
    }

    private function analyse($selector, $name, $record, array $response)
    {
        $checks = array();
        if ($record === '') {
            $message = $response['ok']
                ? 'No DKIM key record is published at ' . $name . '.'
                : 'The lookup for ' . $name . ' did not return an answer: ' . $response['error'];
            return array('selector' => $selector, 'name' => $name, 'record' => '', 'status' => 'ERROR', 'message' => $message,
                'key_type' => '', 'key_bits' => null, 'flags' => array(), 'checks' => array());
        }
        $tags = array();
        foreach (explode(';', $record) as $part) {
            $part = trim($part);
            if ($part === '' || strpos($part, '=') === false) { continue; }
            list($key, $value) = array_map('trim', explode('=', $part, 2));
            $tags[strtolower($key)] = $value;
        }
        $status = 'PASS';
        if (isset($tags['v']) && strtoupper($tags['v']) !== 'DKIM1') {
            $checks[] = array('status' => 'ERROR', 'message' => 'The version tag must be DKIM1 when present (found "' . $tags['v'] . '").');
            $status = 'ERROR';
        }
        if (!array_key_exists('p', $tags)) {
            $checks[] = array('status' => 'ERROR', 'message' => 'The required p= (public key) tag is missing.');
            $status = 'ERROR';
        } elseif (trim($tags['p']) === '') {
            $checks[] = array('status' => 'WARNING', 'message' => 'The key is revoked (p= is empty): signatures made with this selector will fail.');
            if ($status !== 'ERROR') { $status = 'WARNING'; }
        }
        $keyType = isset($tags['k']) ? strtolower($tags['k']) : 'rsa';
        if (!in_array($keyType, array('rsa', 'ed25519'), true)) {
            $checks[] = array('status' => 'WARNING', 'message' => 'Key type "' . $keyType . '" is unusual; the standard types are rsa and ed25519.');
            if ($status !== 'ERROR') { $status = 'WARNING'; }
        }
        $bits = null;
        $decoded = false;
        if (isset($tags['p']) && trim($tags['p']) !== '') {
            $normalised = preg_replace('/\s+/', '', $tags['p']);
            $binary = base64_decode($normalised, true);
            if ($binary === false) {
                $checks[] = array('status' => 'ERROR', 'message' => 'The public key is not valid Base64.');
                $status = 'ERROR';
            } else {
                $decoded = true;
                if ($keyType === 'rsa') {
                    $bits = $this->rsaBits($binary);
                    if ($bits !== null && $bits < 1024) {
                        $checks[] = array('status' => 'WARNING', 'message' => 'The RSA key is only ' . $bits . ' bits. Receivers increasingly reject keys below 1024 bits; use 2048 bits.');
                        if ($status !== 'ERROR') { $status = 'WARNING'; }
                    } elseif ($bits !== null) {
                        $checks[] = array('status' => 'PASS', 'message' => 'Public RSA key parsed: ' . $bits . ' bits.');
                    } else {
                        $checks[] = array('status' => 'WARNING', 'message' => 'The key could not be parsed as a DER SubjectPublicKeyInfo structure.');
                    }
                } elseif ($keyType === 'ed25519' && strlen($binary) !== 32) {
                    $checks[] = array('status' => 'WARNING', 'message' => 'An ed25519 key should be 32 bytes (found ' . strlen($binary) . ').');
                }
            }
        }
        $flags = array();
        if (isset($tags['t'])) {
            foreach (preg_split('/\s*:\s*/', $tags['t']) as $flag) {
                if ($flag !== '') { $flags[] = $flag; }
            }
            if (in_array('y', $flags, true)) {
                $checks[] = array('status' => 'WARNING', 'message' => 'The testing flag (t=y) is set: receivers may ignore signature failures, so the selector is not enforcing anything.');
                if ($status !== 'ERROR') { $status = 'WARNING'; }
            }
            if (in_array('s', $flags, true)) {
                $checks[] = array('status' => 'PASS', 'message' => 'The strict flag (t=s) is set: the From domain must match the d= domain, subdomains may not sign.');
            }
        }
        if (!$checks) {
            $checks[] = array('status' => 'PASS', 'message' => 'The DKIM key record is valid and the public key decoded successfully.');
        }
        return array(
            'selector' => $selector, 'name' => $name, 'record' => $record, 'status' => $status,
            'message' => $status === 'PASS' ? 'A usable DKIM key is published for this selector.' : 'See the checks for details.',
            'tags' => $tags, 'key_type' => $keyType, 'key_bits' => $bits, 'flags' => $flags,
            'key_decoded' => $decoded, 'checks' => $checks,
        );
    }

    /**
     * Extract the modulus size (in bits) from a DER SubjectPublicKeyInfo
     * RSAPublicKey. Returns null when the structure is not what it claims.
     */
    private function rsaBits($der)
    {
        $offset = 0;
        if ($this->derRead($der, $offset, 0x30) === null) { return null; }   // SEQUENCE (SPKI)
        if ($this->derRead($der, $offset, 0x30) === null) { return null; }   // SEQUENCE (AlgorithmIdentifier)
        $this->derRead($der, $offset, 0x06);                                 // OID
        if ($this->derRead($der, $offset, 0x05) === null) { /* NULL is optional for some encoders */ }
        if ($this->derRead($der, $offset, 0x03) === null) { return null; }   // BIT STRING
        if ($this->derRead($der, $offset, 0x30) === null) { return null; }   // SEQUENCE (RSAPublicKey)
        $modulus = $this->derRead($der, $offset, 0x02);                      // INTEGER modulus
        if ($modulus === null || $modulus === '') { return null; }
        $bytes = ltrim($modulus, "\x00");
        if ($bytes === '') { return 0; }
        $bits = (strlen($bytes) - 1) * 8;
        $first = ord($bytes[0]);
        while ($first > 0) { $bits++; $first >>= 1; }
        return $bits;
    }

    /** Read one DER TLV of the expected tag, returning its value and advancing the offset. */
    private function derRead($data, &$offset, $expectedTag)
    {
        if ($offset + 2 > strlen($data)) { return null; }
        $tag = ord($data[$offset]);
        if ($tag !== $expectedTag) { return null; }
        $offset++;
        $lengthByte = ord($data[$offset]);
        $offset++;
        $length = $lengthByte;
        if ($lengthByte & 0x80) {
            $count = $lengthByte & 0x7f;
            if ($count === 0 || $count > 4 || $offset + $count > strlen($data)) { return null; }
            $length = 0;
            for ($i = 0; $i < $count; $i++) {
                $length = ($length << 8) | ord($data[$offset + $i]);
            }
            $offset += $count;
        }
        if ($offset + $length > strlen($data)) { return null; }
        $value = substr($data, $offset, $length);
        $offset += $length;
        return $value;
    }
}
