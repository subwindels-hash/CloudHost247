<?php
namespace CloudHost247\NetworkTools\Services\Productivity;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;

/**
 * QR code generator and scanner (docs sections 57, 58).
 *
 * Both run in the browser: the module bundles no QR encoder server-side and no
 * image library, so the client-side implementation is the authority for drawing
 * and for camera decoding (where the browser supports the BarcodeDetector API).
 * The server's job is to validate the payload, build the standard URI formats
 * (WiFi, vCard, mailto, tel, sms) and to be explicit about what it did not do.
 * A decoded value is only written to history if the customer asks for it.
 */
final class QrService extends Service
{
    protected function execute()
    {
        $slug = $this->tool() ? $this->tool()->slug() : '';
        if ($slug === 'productivity/qr-scanner') {
            return ToolResult::success(array(
                'client_side' => true,
                'supported' => true,
                'decoder' => 'BarcodeDetector API in your browser, with an image-upload fallback where the API is missing',
                'store_requested' => !empty($this->input['store']),
                'instructions' => 'Point your camera at a code, or upload an image that contains one. Decoding happens on your device: no image and no decoded value is sent to CloudHost247. If your browser has no BarcodeDetector support, the scanner says so instead of failing silently.',
                'privacy' => 'A QR code often contains a password, a Wi-Fi key or a payment link. Because decoding is local, the value never leaves your device; the history entry (only if you asked for one) records the tool and the time, not the decoded value.',
                'summary' => 'Ready to scan locally in your browser.',
            ), array(), array('client_only' => true, 'server_decoded' => false));
        }
        $kind = isset($this->input['kind']) ? $this->input['kind'] : 'url';
        $payload = trim((string) $this->input['payload']);
        $errorCorrection = isset($this->input['error_correction']) ? strtoupper($this->input['error_correction']) : 'M';
        $formatted = $this->format($kind, $payload);
        $warnings = array();
        if (strlen($formatted['value']) > 1000) {
            $warnings[] = 'The payload is long (' . strlen($formatted['value']) . ' bytes). Very long payloads need a dense QR code that many phone cameras struggle to read; a short link is easier to scan.';
        }
        if (!in_array($errorCorrection, array('L', 'M', 'Q', 'H'), true)) {
            $errorCorrection = 'M';
        }
        return ToolResult::success(array(
            'kind' => $kind,
            'value' => $formatted['value'],
            'human_readable' => $formatted['human'],
            'error_correction' => $errorCorrection,
            'bytes' => strlen($formatted['value']),
            'render' => array(
                'engine' => 'browser',
                'note' => 'The code is drawn on your device by the module\'s client-side encoder. It is never uploaded, and the server stores none of it.',
                'verify' => 'Scan the drawn code with a phone camera to confirm it decodes to the value shown above — that is the only verification that matters for a QR code.',
                'exports' => array('png', 'svg'),
            ),
            'privacy' => $kind === 'wifi'
                ? 'A Wi-Fi QR code contains your network password. The value below exists only in this page; do not share a screenshot of it with people you would not give the password to.'
                : 'The value below was not stored. If you want it in your history, use the explicit history option on the result.',
            'summary' => 'Prepared a ' . $kind . ' payload of ' . strlen($formatted['value']) . ' byte(s) for local encoding.',
        ), $warnings, array('client_only' => true, 'server_encoded' => false));
    }

    private function format($kind, $payload)
    {
        switch ($kind) {
            case 'url':
                $value = $this->normaliseUrl($payload);
                return array('value' => $value, 'human' => $value);
            case 'email':
                $address = $this->firstLine($payload);
                $subject = $this->secondLine($payload);
                $value = 'mailto:' . $address . ($subject !== '' ? '?subject=' . rawurlencode($subject) : '');
                return array('value' => $value, 'human' => 'Email to ' . $address . ($subject !== '' ? ' — subject: ' . $subject : ''));
            case 'phone':
                $number = preg_replace('/[^0-9+]/', '', $payload);
                return array('value' => 'tel:' . $number, 'human' => 'Call ' . $number);
            case 'sms':
                $number = preg_replace('/[^0-9+]/', '', $this->firstLine($payload));
                $message = $this->secondLine($payload);
                return array('value' => 'SMSTO:' . $number . ':' . $message, 'human' => 'SMS to ' . $number . ($message !== '' ? ' — “' . $message . '”' : ''));
            case 'wifi':
                return $this->wifi($payload);
            case 'vcard':
                return $this->vcard($payload);
            default:
                return array('value' => $payload, 'human' => $payload);
        }
    }

    private function wifi($payload)
    {
        $lines = preg_split('/\R/', $payload);
        $ssid = isset($lines[0]) ? trim($lines[0]) : '';
        $password = isset($lines[1]) ? trim($lines[1]) : '';
        $encryption = isset($lines[2]) ? strtoupper(trim($lines[2])) : 'WPA';
        if ($ssid === '') {
            $ssid = 'Network';
        }
        if (!in_array($encryption, array('WPA', 'WEP', 'NOPASS'), true)) {
            $encryption = 'WPA';
        }
        $escape = function ($value) {
            return str_replace(array('\\', ';', ',', ':', '"'), array('\\\\', '\\;', '\\,', '\\:', '\\"'), $value);
        };
        $value = 'WIFI:T:' . $encryption . ';S:' . $escape($ssid) . ';';
        if ($encryption !== 'NOPASS') {
            $value .= 'P:' . $escape($password) . ';';
        }
        $value .= ';';
        return array('value' => $value, 'human' => 'Wi-Fi network “' . $ssid . '” (' . $encryption . ')');
    }

    private function vcard($payload)
    {
        $lines = preg_split('/\R/', $payload);
        $name = isset($lines[0]) ? trim($lines[0]) : '';
        $organisation = isset($lines[1]) ? trim($lines[1]) : '';
        $title = isset($lines[2]) ? trim($lines[2]) : '';
        $phone = isset($lines[3]) ? trim($lines[3]) : '';
        $email = isset($lines[4]) ? trim($lines[4]) : '';
        $escape = function ($value) {
            return str_replace(array('\\', ';', ',', "\n"), array('\\\\', '\\;', '\\,', ' '), $value);
        };
        $card = array('BEGIN:VCARD', 'VERSION:3.0', 'N:' . $escape($name));
        if ($organisation !== '') { $card[] = 'ORG:' . $escape($organisation); }
        if ($title !== '') { $card[] = 'TITLE:' . $escape($title); }
        if ($phone !== '') { $card[] = 'TEL;TYPE=CELL:' . $escape($phone); }
        if ($email !== '') { $card[] = 'EMAIL:' . $escape($email); }
        $card[] = 'END:VCARD';
        return array('value' => implode("\r\n", $card), 'human' => 'Contact card' . ($name !== '' ? ' for ' . $name : ''));
    }

    private function normaliseUrl($payload)
    {
        if (preg_match('#^[a-z][a-z0-9+.\-]*://#i', $payload)) {
            return $payload;
        }
        return 'https://' . ltrim($payload, '/');
    }

    private function firstLine($payload)
    {
        $lines = preg_split('/\R/', $payload);
        return isset($lines[0]) ? trim($lines[0]) : '';
    }

    private function secondLine($payload)
    {
        $lines = preg_split('/\R/', $payload);
        return isset($lines[1]) ? trim($lines[1]) : '';
    }
}
