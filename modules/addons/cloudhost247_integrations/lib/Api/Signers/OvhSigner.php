<?php
namespace CloudHost247\Integrations\Api\Signers;

use InvalidArgumentException;

/**
 * OVHcloud / SoYouStart request signature.
 *
 * Signature = "$1$" . sha1(secret + "+" + consumerKey + "+" + METHOD + "+" + url
 *             + "+" + body + "+" + timestamp)
 *
 * The application secret never leaves this class and is never placed in the
 * URL, the body or a log line.
 */
final class OvhSigner
{
    public static function headers($applicationKey, $applicationSecret, $consumerKey, $method, $url, $body, $timestamp)
    {
        foreach (array($applicationKey, $applicationSecret, $consumerKey) as $credential) {
            if (!is_string($credential) || strlen(trim($credential)) < 8) {
                throw new InvalidArgumentException('The OVH-style credentials are incomplete.');
            }
        }
        $timestamp = (int) $timestamp;
        $signature = '$1$' . sha1(trim($applicationSecret) . '+' . trim($consumerKey) . '+' . strtoupper($method) . '+' . $url . '+' . (string) $body . '+' . $timestamp);
        return array(
            'X-Ovh-Application: ' . trim($applicationKey),
            'X-Ovh-Consumer: ' . trim($consumerKey),
            'X-Ovh-Timestamp: ' . $timestamp,
            'X-Ovh-Signature: ' . $signature,
        );
    }
}
