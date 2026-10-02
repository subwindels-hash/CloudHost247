<?php
namespace CloudHost247\NetworkTools\Services\Dns;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Dns\DnsClient;
use CloudHost247\NetworkTools\Services\Service;

/**
 * BIMI Checker (docs section 49): reads the BIMI record, validates its tags,
 * checks that the DMARC policy can satisfy BIMI's enforcement requirement and
 * verifies the logo URL over HTTPS.
 */
final class BimiService extends Service
{
    protected function execute()
    {
        $domain = $this->input['domain'];
        $selector = isset($this->input['selector']) && $this->input['selector'] !== '' ? $this->input['selector'] : 'default';
        $name = $selector . '._bimi.' . $domain;
        $response = $this->querySystem($name, 'TXT');
        $record = '';
        if ($response['ok']) {
            foreach (DnsClient::values($response['records'], 'TXT') as $value) {
                if (stripos(trim($value), 'v=BIMI1') === 0) {
                    $record = trim($value);
                    break;
                }
            }
        }
        $checks = array();
        if ($record === '') {
            $checks[] = array('id' => 'bimi_present', 'label' => 'BIMI record', 'status' => 'ERROR',
                'message' => 'No BIMI record was found at ' . $name . '.', 'evidence' => array());
            return ToolResult::success(array(
                'domain' => $domain, 'selector' => $selector, 'query_name' => $name, 'record' => '',
                'checks' => $checks, 'status' => 'ERROR', 'logo_url' => '', 'certificate_url' => '',
                'summary' => 'No BIMI record published.',
                'explanation' => 'BIMI requires an authenticated sending domain, a DMARC policy of quarantine or reject, and (at most mailbox providers) a Verified Mark Certificate.',
            ), array(), $this->meta($response));
        }
        $tags = array();
        foreach (explode(';', $record) as $part) {
            $part = trim($part);
            if ($part === '' || strpos($part, '=') === false) { continue; }
            list($key, $value) = array_map('trim', explode('=', $part, 2));
            $tags[strtolower($key)] = $value;
        }
        $status = 'PASS';
        if (!isset($tags['v']) || strtoupper($tags['v']) !== 'BIMI1') {
            $checks[] = array('id' => 'bimi_version', 'label' => 'Version', 'status' => 'ERROR', 'message' => 'The version tag must be v=BIMI1.', 'evidence' => array($record));
            $status = 'ERROR';
        } else {
            $checks[] = array('id' => 'bimi_version', 'label' => 'Version', 'status' => 'PASS', 'message' => 'v=BIMI1.', 'evidence' => array());
        }
        $logoUrl = isset($tags['l']) ? $tags['l'] : '';
        if ($logoUrl === '') {
            $checks[] = array('id' => 'bimi_logo', 'label' => 'Logo (l)', 'status' => 'WARNING', 'message' => 'No logo URL is published (l= is empty), so no logo can be shown. An empty l= is the documented way to declare "no logo".');
            if ($status !== 'ERROR') { $status = 'WARNING'; }
        } elseif (stripos($logoUrl, 'https://') !== 0) {
            $checks[] = array('id' => 'bimi_logo', 'label' => 'Logo (l)', 'status' => 'ERROR', 'message' => 'The logo URL must use HTTPS (SVG Tiny PS or a small square raster image).', 'evidence' => array($logoUrl));
            $status = 'ERROR';
        } else {
            $fetch = $this->fetcher(2)->request('GET', $logoUrl, array('Accept: image/svg+xml,image/*'), null, array('max_bytes' => 131072, 'timeout' => (int) $this->setting('default_timeout_seconds', 10)));
            if ($fetch['ok']) {
                $contentType = isset($fetch['headers']['content-type']) ? strtolower($fetch['headers']['content-type']) : '';
                $checks[] = array('id' => 'bimi_logo', 'label' => 'Logo (l)', 'status' => 'PASS',
                    'message' => 'The logo URL answered HTTP ' . $fetch['status'] . ' with content type ' . ($contentType === '' ? 'unknown' : $contentType) . '.',
                    'evidence' => array('url' => $logoUrl, 'status' => $fetch['status'], 'content_type' => $contentType, 'bytes' => $fetch['bytes']));
                if ($contentType !== '' && strpos($contentType, 'svg') === false) {
                    $checks[] = array('id' => 'bimi_logo_type', 'label' => 'Logo format', 'status' => 'WARNING',
                        'message' => 'BIMI expects SVG Tiny PS for full support; the served content type is ' . $contentType . '.', 'evidence' => array());
                    if ($status !== 'ERROR') { $status = 'WARNING'; }
                }
            } else {
                $checks[] = array('id' => 'bimi_logo', 'label' => 'Logo (l)', 'status' => 'ERROR',
                    'message' => 'The logo URL could not be fetched: ' . $fetch['message'], 'evidence' => array('url' => $logoUrl));
                $status = 'ERROR';
            }
        }
        $certificateUrl = isset($tags['a']) ? $tags['a'] : '';
        if ($certificateUrl === '') {
            $checks[] = array('id' => 'bimi_certificate', 'label' => 'Certificate (a)', 'status' => 'WARNING',
                'message' => 'No Verified Mark Certificate URL is published. Most large mailbox providers require a VMC before they display a BIMI logo.', 'evidence' => array());
            if ($status !== 'ERROR') { $status = 'WARNING'; }
        } elseif (stripos($certificateUrl, 'https://') !== 0) {
            $checks[] = array('id' => 'bimi_certificate', 'label' => 'Certificate (a)', 'status' => 'ERROR', 'message' => 'The certificate URL must use HTTPS.', 'evidence' => array($certificateUrl));
            $status = 'ERROR';
        } else {
            $checks[] = array('id' => 'bimi_certificate', 'label' => 'Certificate (a)', 'status' => 'PASS', 'message' => 'A certificate URL is published.', 'evidence' => array($certificateUrl));
        }
        $dmarc = (new DmarcService())->run(array('domain' => $domain), $this->context);
        $dmarcData = $dmarc->isOk() ? $dmarc->data() : array();
        $dmarcPolicy = isset($dmarcData['policy']) ? strtolower((string) $dmarcData['policy']) : '';
        if ($dmarcPolicy === '' ) {
            $checks[] = array('id' => 'bimi_dmarc', 'label' => 'DMARC requirement', 'status' => 'ERROR', 'message' => 'BIMI requires a DMARC policy. No DMARC record could be read for ' . $domain . '.', 'evidence' => array());
            $status = 'ERROR';
        } elseif ($dmarcPolicy === 'none') {
            $checks[] = array('id' => 'bimi_dmarc', 'label' => 'DMARC requirement', 'status' => 'ERROR', 'message' => 'BIMI requires p=quarantine or p=reject; the published policy is p=none.', 'evidence' => array('p' => 'none'));
            $status = 'ERROR';
        } else {
            $checks[] = array('id' => 'bimi_dmarc', 'label' => 'DMARC requirement', 'status' => 'PASS', 'message' => 'DMARC policy p=' . $dmarcPolicy . ' satisfies the BIMI requirement.', 'evidence' => array('p' => $dmarcPolicy));
        }
        return ToolResult::success(array(
            'domain' => $domain,
            'selector' => $selector,
            'query_name' => $name,
            'record' => $record,
            'tags' => $tags,
            'logo_url' => $logoUrl,
            'certificate_url' => $certificateUrl,
            'checks' => $checks,
            'status' => $status,
            'summary' => 'BIMI record found with ' . count($tags) . ' tag(s); overall ' . strtolower($status) . '.',
            'explanation' => 'BIMI is honoured only when the message authenticates, DMARC is enforced and the logo (and usually a VMC) validates.',
        ), array(), $this->meta($response));
    }
}
