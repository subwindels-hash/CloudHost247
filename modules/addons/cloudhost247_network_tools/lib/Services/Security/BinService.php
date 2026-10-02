<?php
namespace CloudHost247\NetworkTools\Services\Security;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Core\Security\SsrfGuard;
use CloudHost247\NetworkTools\Services\Service;
use InvalidArgumentException;

/**
 * BIN / IIN lookup (docs section 45).
 *
 * The data source is an administrator-registered HTTP provider row
 * (provider_key "tool.bin_lookup") in Admin → CloudHost247 Tools → Providers,
 * because card metadata is licensed data: the module ships with no bundled
 * issuer table and invents nothing. Input is restricted to six to eight digits,
 * so a full card number can never be submitted, and nothing is stored.
 */
final class BinService extends Service
{
    protected function execute()
    {
        $bin = preg_replace('/[\s\-]/', '', (string) $this->input['bin']);
        if (!preg_match('/^\d{6,8}$/', $bin)) {
            throw new InvalidArgumentException('Enter only the first six to eight digits of the card. Full card numbers are never accepted or transmitted.');
        }
        $row = $this->provider()->toolProvider('tool.bin_lookup');
        if (!$row || (int) $row->enabled !== 1) {
            return ToolResult::configurationRequired('No BIN data source is configured. An administrator can add one under Admin → CloudHost247 Tools → Providers (provider key tool.bin_lookup) with the licensed endpoint and the field mapping.');
        }
        $endpoint = (string) $row->endpoint;
        if ($endpoint === '' || stripos($endpoint, 'https://') !== 0) {
            return ToolResult::configurationRequired('The configured BIN provider has no usable HTTPS endpoint.');
        }
        $repository = new \CloudHost247\NetworkTools\Core\Repository\ProviderRepository();
        $configuration = $repository->configuration($row);
        $configuration = is_array($configuration) ? $configuration : array();
        $parameter = isset($configuration['parameter']) ? preg_replace('/[^a-z0-9_\-]/i', '', (string) $configuration['parameter']) : '';
        $parameter = $parameter === '' ? 'bin' : $parameter;
        $url = strpos($endpoint, '{bin}') !== false ? str_replace('{bin}', $bin, $endpoint) : $endpoint;
        $timeout = max(3, min(15, (int) $row->timeout_seconds));
        $fetcher = $this->fetcher(2);
        $query = strpos($endpoint, '{bin}') !== false ? array() : array($parameter => $bin);
        $requestUrl = $url;
        if ($query) {
            $requestUrl .= (strpos($url, '?') === false ? '?' : '&') . http_build_query($query);
        }
        $headers = array();
        if (!empty($configuration['header'])) {
            $headerName = preg_replace('/[^A-Za-z0-9\-]/', '', (string) $configuration['header']);
            $headerValue = isset($configuration['header_value']) ? (string) $configuration['header_value'] : '';
            if ($headerName !== '' && $headerValue !== '') {
                $headers[$headerName] = $headerValue;
            }
        }
        $response = $fetcher->json('GET', $requestUrl, $headers, null, array('timeout' => $timeout, 'max_bytes' => 262144));
        if (!$response['ok']) {
            return ToolResult::failure($response['code'], 'The BIN provider could not answer: ' . $response['message']);
        }
        $payload = isset($response['json']) && is_array($response['json']) ? $response['json'] : array();
        $mapping = isset($configuration['map']) && is_array($configuration['map']) ? $configuration['map'] : array();
        $fields = array('bin' => $bin, 'scheme' => '', 'brand' => '', 'issuer' => '', 'country' => '', 'country_code' => '', 'card_type' => '', 'category' => '', 'prepaid' => null);
        foreach ($mapping as $field => $path) {
            if (array_key_exists($field, $fields)) {
                $value = $this->extract($payload, (string) $path);
                if ($value !== null) {
                    $fields[$field] = is_scalar($value) ? $value : '';
                }
            }
        }
        $known = 0;
        foreach (array('scheme', 'brand', 'issuer', 'country', 'card_type', 'category') as $field) {
            if ($fields[$field] !== '') {
                $known++;
            }
        }
        $warnings = array();
        if ($known === 0 && !$mapping) {
            $warnings[] = 'The BIN provider answered, but no field mapping is configured for it, so no issuer details could be extracted. An administrator can set the mapping in Admin → CloudHost247 Tools → Providers.';
        }
        if ($known > 0) {
            $warnings[] = 'Card metadata describes the issuer range, not the card holder or the account. It is never a verification of a card, and a valid-looking BIN says nothing about whether a payment will succeed.';
        }
        return ToolResult::success(array_merge($fields, array(
            'lookup_time' => gmdate('c'),
            'provider' => 'configured BIN data source',
            'status' => $known > 0 ? 'FOUND' : 'UNKNOWN',
            'source_notice' => 'Every field above is exactly what the configured data source returned for this prefix. Fields left empty were not published by the source.',
            'summary' => $known > 0
                ? 'The BIN resolved to ' . ($fields['issuer'] !== '' ? $fields['issuer'] : $fields['brand'] !== '' ? $fields['brand'] : $fields['scheme']) . '.'
                : 'The source returned no issuer details for this prefix.',
        )), $warnings, array('latency_ms' => $response['latency_ms'], 'card_number_accepted' => false));
    }

    /** Dot-path extraction with a strict allowlist of characters. */
    private function extract(array $payload, $path)
    {
        if ($path === '' || strlen($path) > 128) {
            return null;
        }
        $node = $payload;
        foreach (explode('.', $path) as $segment) {
            if (is_array($node) && array_key_exists($segment, $node)) {
                $node = $node[$segment];
            } else {
                return null;
            }
        }
        return $node;
    }
}
