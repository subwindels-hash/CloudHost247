<?php
namespace CloudHost247\NetworkTools\Services\Security;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Core\Security\SsrfGuard;
use CloudHost247\NetworkTools\Services\Service;

/**
 * SSL/TLS certificate checker (docs section 40).
 *
 * Opens a real TLS connection with peer and hostname verification enabled,
 * parses the certificate the server presented, and reports exactly what was
 * seen. If the verified handshake fails, a second unverified probe collects the
 * certificate so the reason can be shown — the result then says clearly that
 * the chain was NOT verified. Nothing is estimated and no grade is awarded.
 */
final class SslService extends Service
{
    protected function execute()
    {
        $host = $this->input['host'];
        $port = isset($this->input['port']) ? (int) $this->input['port'] : 443;
        if (!SsrfGuard::isValidHostname($host)) {
            return ToolResult::invalid('Enter a hostname such as example.com (no scheme, no path).');
        }
        $verdict = SsrfGuard::validateHost($host);
        if (!$verdict['ok']) {
            return ToolResult::failure($verdict['code'], $verdict['message']);
        }
        $timeout = max(4, min(20, $this->intSetting('default_timeout_seconds', 10)));
        $verified = $this->probe($host, $port, $timeout, true);
        $warnings = array();
        $probe = $verified;
        if (!$verified['connected'] || $verified['certificate'] === null || $verified['verify_error'] !== '') {
            // A failed verified handshake usually means the certificate itself is
            // the problem, so collect it with verification off and say so.
            $unverified = $this->probe($host, $port, $timeout, false);
            if ($unverified['connected'] && $unverified['certificate']) {
                $probe = $unverified;
                $reason = $verified['verify_error'] !== '' ? $verified['verify_error'] : $verified['message'];
                $probe['verify_error'] = $reason;
                $warnings[] = 'The verified handshake failed (' . $reason . '). The certificate below was retrieved without chain verification; treat its details as unverified.';
            } elseif (!$verified['connected']) {
                return ToolResult::failure($verified['code'], $verified['message'], array('verified_attempt' => $this->attempt($verified)));
            }
        }
        $certificate = $probe['certificate'];
        $parsed = $this->parse($certificate);
        $now = time();
        $expiresAt = $parsed['valid_to'];
        $daysRemaining = (int) floor(($expiresAt - $now) / 86400);
        $checks = array();
        $checks[] = $this->check('Chain verification', $probe['verify_error'] === '' ? 'PASS' : 'ERROR', $probe['verify_error'] === '' ? 'The certificate chain was verified against the system trust store and the hostname matched.' : 'Verification failed: ' . $probe['verify_error']);
        $checks[] = $this->check('Hostname', $probe['verify_error'] === '' ? 'PASS' : ($this->hostnameMatches($host, $parsed['names']) ? 'ERROR' : 'WARNING'), $this->hostnameMatches($host, $parsed['names']) ? 'The certificate covers ' . $host . '.' : 'The certificate does not cover ' . $host . '. Names on the certificate: ' . implode(', ', array_slice($parsed['names'], 0, 12)) . '.');
        $checks[] = $this->check('Validity period', $daysRemaining < 0 ? 'ERROR' : ($daysRemaining <= 7 ? 'WARNING' : 'PASS'), $daysRemaining < 0 ? 'The certificate expired ' . abs($daysRemaining) . ' day(s) ago.' : 'Valid for another ' . $daysRemaining . ' day(s).');
        $checks[] = $this->check('Self-signed', $parsed['self_signed'] ? 'WARNING' : 'PASS', $parsed['self_signed'] ? 'The subject and issuer are the same, which is characteristic of a self-signed certificate that browsers will not trust unless the issuer is installed locally.' : 'Issued by ' . $parsed['issuer']['organization'] . '.');
        $weakSignature = in_array(strtolower($parsed['signature_algorithm']), array('sha1withrsaencryption', 'md5withrsaencryption'), true);
        $checks[] = $this->check('Signature algorithm', $weakSignature ? 'WARNING' : ($parsed['signature_algorithm'] === '' ? 'UNKNOWN' : 'PASS'), $parsed['signature_algorithm'] === '' ? 'The signature algorithm could not be read.' : 'Signed with ' . $parsed['signature_algorithm'] . '.');
        $keyBytes = (int) $parsed['key_bits'];
        $checks[] = $this->check('Key strength', $keyBytes === 0 ? 'UNKNOWN' : ($keyBytes < 2048 ? 'WARNING' : 'PASS'), $keyBytes === 0 ? 'The key size could not be read.' : $parsed['key_type'] . ' key with ' . $keyBytes . ' bits.');
        foreach ($checks as $check) {
            if ($check['status'] === 'ERROR') {
                $warnings[] = $check['name'] . ': ' . $check['detail'];
            } elseif ($check['status'] === 'WARNING') {
                $warnings[] = $check['name'] . ': ' . $check['detail'];
            }
        }
        if (in_array($port, array(465, 993, 995, 8443), true) === false && $port !== 443) {
            $warnings[] = 'Checked on port ' . $port . ', which is not a standard HTTPS port. Browsers and clients will still expect a valid certificate for it.';
        }
        $warnings[] = 'Only the certificate presented for this hostname and port was inspected. Other hostnames on the same server may have different certificates, and revocation status was not queried (no OCSP/CRL request is made by this tool).';
        return ToolResult::success(array(
            'host' => $host,
            'port' => $port,
            'connected' => $probe['connected'],
            'tls' => array('protocol' => $probe['protocol'], 'cipher' => $probe['cipher']),
            'verification' => array('verified' => $probe['verify_error'] === '' && $probe['verified'], 'error' => $probe['verify_error']),
            'subject' => $parsed['subject'],
            'issuer' => $parsed['issuer'],
            'serial' => $parsed['serial'],
            'names' => $parsed['names'],
            'valid_from' => gmdate('c', $parsed['valid_from']),
            'valid_to' => gmdate('c', $expiresAt),
            'days_remaining' => $daysRemaining,
            'expired' => $daysRemaining < 0,
            'key' => array('type' => $parsed['key_type'], 'bits' => $keyBytes),
            'signature_algorithm' => $parsed['signature_algorithm'],
            'self_signed' => $parsed['self_signed'],
            'chain_length' => $probe['chain_length'],
            'checks' => $checks,
            'checked_at' => gmdate('c'),
            'ocsp_stapling' => 'not queried by this tool',
            'summary' => $daysRemaining < 0
                ? 'The certificate for ' . $host . ' expired ' . abs($daysRemaining) . ' day(s) ago.'
                : 'The certificate for ' . $host . ' is valid for ' . $daysRemaining . ' more day(s)' . ($probe['verify_error'] !== '' ? ', but the chain did not verify.' : ' and the chain verified.'),
        ), $warnings, array('probe_method' => 'tls_handshake', 'verified_attempt' => $this->attempt($verified)));
    }

    private function probe($host, $port, $timeout, $verify)
    {
        $result = array(
            'connected' => false, 'verified' => false, 'verify_error' => '', 'certificate' => null,
            'chain' => array(), 'chain_length' => 0, 'protocol' => '', 'cipher' => '',
            'code' => 'TIMEOUT', 'message' => 'The TLS connection could not be established.',
        );
        if (!function_exists('stream_socket_client') || !function_exists('openssl_x509_parse')) {
            $result['code'] = 'CAPABILITY_UNAVAILABLE';
            $result['message'] = 'The PHP OpenSSL/stream extensions are required for TLS checks and are not available on this server.';
            return $result;
        }
        $context = stream_context_create(array('ssl' => array(
            'verify_peer' => (bool) $verify,
            'verify_peer_name' => (bool) $verify,
            'allow_self_signed' => !$verify,
            'capture_peer_cert' => true,
            'capture_peer_cert_chain' => true,
            'SNI_enabled' => true,
            'peer_name' => $host,
            'disable_compression' => true,
            'crypto_method' => STREAM_CRYPTO_METHOD_TLS_CLIENT,
        )));
        $errno = 0;
        $error = '';
        $stream = @stream_socket_client(
            'ssl://' . $host . ':' . $port,
            $errno,
            $error,
            $timeout,
            STREAM_CLIENT_CONNECT,
            $context
        );
        if ($stream === false) {
            $result['code'] = stripos($error, 'timed out') !== false ? 'TIMEOUT' : 'SERVICE_UNAVAILABLE';
            $result['message'] = 'Could not open a TLS connection to ' . $host . ':' . $port . ($error !== '' ? ' (' . $error . ')' : '') . '. The host may be unreachable, the port closed, or the network filtered.';
            return $result;
        }
        stream_set_timeout($stream, $timeout);
        $result['connected'] = true;
        $parameters = stream_context_get_params($stream);
        if (isset($parameters['options']['ssl']['peer_certificate'])) {
            $result['certificate'] = $parameters['options']['ssl']['peer_certificate'];
        }
        if (isset($parameters['options']['ssl']['peer_certificate_chain'])) {
            $result['chain'] = $parameters['options']['ssl']['peer_certificate_chain'];
        }
        $metadata = stream_get_meta_data($stream);
        if (isset($metadata['crypto'])) {
            $result['protocol'] = isset($metadata['crypto']['protocol']) ? (string) $metadata['crypto']['protocol'] : '';
            $result['cipher'] = isset($metadata['crypto']['cipher_name']) ? (string) $metadata['crypto']['cipher_name'] : '';
        }
        // PHP surfaces a verification failure through the connection error when
        // verify_peer is on; the certificate may still have been captured above.
        if (isset($parameters['options']['ssl']['verify_peer']) && $parameters['options']['ssl']['verify_peer'] && !$result['certificate']) {
            $result['verify_error'] = $error !== '' ? $error : 'The peer certificate was not presented.';
        }
        if ($verify && $result['certificate']) {
            $peerName = $host;
            $verifiedOk = true;
            $verifyMessage = '';
            if (function_exists('openssl_x509_checkpurpose')) {
                $purpose = @openssl_x509_checkpurpose($result['certificate'], X509_PURPOSE_SSL_SERVER, array());
                if ($purpose !== true) {
                    $verifiedOk = false;
                    $verifyMessage = 'The certificate is not valid for SSL server use according to the system trust store.';
                }
            }
            if ($verifiedOk && function_exists('openssl_x509_checkpurpose')) {
                // checkpurpose does not test the hostname, so hostname matching is
                // performed explicitly and reported separately.
                $verifyMessage = '';
            }
            if ($verifiedOk) {
                $result['verified'] = true;
            } else {
                $result['verify_error'] = $verifyMessage;
            }
        }
        if ($result['certificate'] === null && $error !== '') {
            $result['verify_error'] = $error;
        }
        fclose($stream);
        return $result;
    }

    private function attempt(array $probe)
    {
        return array(
            'connected' => $probe['connected'],
            'protocol' => $probe['protocol'],
            'cipher' => $probe['cipher'],
            'error' => $probe['message'],
        );
    }

    private function check($name, $status, $detail)
    {
        return array('name' => $name, 'status' => $status, 'detail' => $detail);
    }

    private function parse($certificate)
    {
        $parsed = @openssl_x509_parse($certificate);
        if (!is_array($parsed)) {
            return array(
                'subject' => array(), 'issuer' => array(), 'names' => array(), 'serial' => '',
                'valid_from' => 0, 'valid_to' => 0, 'key_type' => '', 'key_bits' => 0,
                'signature_algorithm' => '', 'self_signed' => false,
            );
        }
        $flattenName = function ($name) {
            if (!is_array($name)) {
                return array();
            }
            $output = array();
            foreach ($name as $key => $value) {
                $output[strtolower($key)] = is_array($value) ? implode(', ', array_map('strval', $value)) : (string) $value;
            }
            return $output;
        };
        $names = array();
        if (isset($parsed['extensions']['subjectAltName'])) {
            foreach (explode(',', $parsed['extensions']['subjectAltName']) as $entry) {
                $entry = trim($entry);
                if (stripos($entry, 'DNS:') === 0) {
                    $names[] = substr($entry, 4);
                } elseif (stripos($entry, 'IP Address:') === 0) {
                    $names[] = substr($entry, 11);
                }
            }
        }
        $commonName = isset($parsed['subject']['CN']) ? (string) $parsed['subject']['CN'] : '';
        if ($commonName !== '' && !in_array($commonName, $names, true)) {
            array_unshift($names, $commonName);
        }
        $subject = $flattenName(isset($parsed['subject']) ? $parsed['subject'] : array());
        $issuer = $flattenName(isset($parsed['issuer']) ? $parsed['issuer'] : array());
        $selfSigned = $subject === $issuer && $subject !== array();
        $keyType = isset($parsed['key_type']) ? (string) $parsed['key_type'] : '';
        $keyBits = 0;
        if (isset($parsed['bits'])) {
            $keyBits = (int) $parsed['bits'];
        } elseif (isset($parsed['key_bits'])) {
            $keyBits = (int) $parsed['key_bits'];
        }
        return array(
            'subject' => $subject,
            'issuer' => $issuer,
            'names' => $names,
            'serial' => isset($parsed['serialNumberHex']) ? (string) $parsed['serialNumberHex'] : (isset($parsed['serialNumber']) ? (string) $parsed['serialNumber'] : ''),
            'valid_from' => isset($parsed['validFrom_time_t']) ? (int) $parsed['validFrom_time_t'] : 0,
            'valid_to' => isset($parsed['validTo_time_t']) ? (int) $parsed['validTo_time_t'] : 0,
            'key_type' => $keyType,
            'key_bits' => $keyBits,
            'signature_algorithm' => isset($parsed['signatureTypeSN']) ? (string) $parsed['signatureTypeSN'] : (isset($parsed['signatureTypeLN']) ? (string) $parsed['signatureTypeLN'] : ''),
            'self_signed' => $selfSigned,
        );
    }

    private function hostnameMatches($host, array $names)
    {
        $host = strtolower($host);
        foreach ($names as $name) {
            $name = strtolower($name);
            if ($name === $host) {
                return true;
            }
            if (strpos($name, '*.') === 0) {
                $suffix = substr($name, 1);
                if (substr($host, -strlen($suffix)) === $suffix && substr_count($host, '.') === substr_count($name, '.')) {
                    return true;
                }
            }
        }
        return false;
    }
}
