<?php
namespace CloudHost247\Integrations\Api\Signers;

use InvalidArgumentException;

/**
 * AWS Signature Version 4 for S3-compatible object storage endpoints.
 *
 * The secret access key is used only to derive the signing key in memory; it is
 * never transmitted, never placed in a URL and never logged.
 */
final class AwsV4Signer
{
    const ALGORITHM = 'AWS4-HMAC-SHA256';

    /**
     * @return array list of "Name: value" header strings to add to the request
     */
    public static function headers($accessKeyId, $secretAccessKey, $region, $service, $method, $url, $payload, $timestamp = null)
    {
        if (!is_string($accessKeyId) || trim($accessKeyId) === '' || !is_string($secretAccessKey) || trim($secretAccessKey) === '') {
            throw new InvalidArgumentException('The storage access key is incomplete.');
        }
        $region = preg_replace('/[^a-z0-9-]/', '', strtolower((string) $region));
        if ($region === '') { throw new InvalidArgumentException('A storage region is required.'); }
        $service = preg_replace('/[^a-z0-9-]/', '', strtolower((string) $service));
        $parts = parse_url($url);
        if (!is_array($parts) || empty($parts['host'])) { throw new InvalidArgumentException('The storage endpoint is not valid.'); }

        $timestamp = $timestamp === null ? time() : (int) $timestamp;
        $amzDate = gmdate('Ymd\THis\Z', $timestamp);
        $dateStamp = gmdate('Ymd', $timestamp);
        $host = strtolower($parts['host']) . (isset($parts['port']) ? ':' . (int) $parts['port'] : '');
        $payload = (string) $payload;
        $payloadHash = hash('sha256', $payload);

        $canonicalUri = self::canonicalUri(isset($parts['path']) ? $parts['path'] : '/');
        $canonicalQuery = self::canonicalQuery(isset($parts['query']) ? $parts['query'] : '');
        $canonicalHeaders = "host:" . $host . "\n" . "x-amz-content-sha256:" . $payloadHash . "\n" . "x-amz-date:" . $amzDate . "\n";
        $signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

        $canonicalRequest = strtoupper($method) . "\n" . $canonicalUri . "\n" . $canonicalQuery . "\n" . $canonicalHeaders . "\n" . $signedHeaders . "\n" . $payloadHash;
        $scope = $dateStamp . '/' . $region . '/' . $service . '/aws4_request';
        $stringToSign = self::ALGORITHM . "\n" . $amzDate . "\n" . $scope . "\n" . hash('sha256', $canonicalRequest);
        $signature = hash_hmac('sha256', $stringToSign, self::signingKey($secretAccessKey, $dateStamp, $region, $service));

        return array(
            'x-amz-date: ' . $amzDate,
            'x-amz-content-sha256: ' . $payloadHash,
            'Authorization: ' . self::ALGORITHM . ' Credential=' . trim($accessKeyId) . '/' . $scope . ', SignedHeaders=' . $signedHeaders . ', Signature=' . $signature,
        );
    }

    /** Exposed for verification against the published AWS signature test vectors. */
    public static function signature($secretAccessKey, $dateStamp, $region, $service, $stringToSign)
    {
        return hash_hmac('sha256', $stringToSign, self::signingKey($secretAccessKey, $dateStamp, $region, $service));
    }

    public static function signingKey($secretAccessKey, $dateStamp, $region, $service)
    {
        $kDate = hash_hmac('sha256', $dateStamp, 'AWS4' . $secretAccessKey, true);
        $kRegion = hash_hmac('sha256', $region, $kDate, true);
        $kService = hash_hmac('sha256', $service, $kRegion, true);
        return hash_hmac('sha256', 'aws4_request', $kService, true);
    }

    private static function canonicalUri($path)
    {
        if ($path === '' || $path === null) { return '/'; }
        $segments = array();
        foreach (explode('/', $path) as $segment) {
            $segments[] = rawurlencode(rawurldecode($segment));
        }
        $canonical = implode('/', $segments);
        return $canonical === '' ? '/' : $canonical;
    }

    private static function canonicalQuery($query)
    {
        if ($query === '' || $query === null) { return ''; }
        $pairs = array();
        foreach (explode('&', $query) as $pair) {
            if ($pair === '') { continue; }
            $position = strpos($pair, '=');
            $name = $position === false ? $pair : substr($pair, 0, $position);
            $value = $position === false ? '' : substr($pair, $position + 1);
            $pairs[] = rawurlencode(rawurldecode($name)) . '=' . rawurlencode(rawurldecode($value));
        }
        sort($pairs, SORT_STRING);
        return implode('&', $pairs);
    }
}
