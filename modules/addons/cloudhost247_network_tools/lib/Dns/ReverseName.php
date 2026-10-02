<?php
namespace CloudHost247\NetworkTools\Dns;

/**
 * Builder for the reverse-DNS name of an IPv4 or IPv6 address (RFC 1035 §3.5,
 * RFC 3596 §2.5). Kept separate from the service so both the PTR tool and the
 * resolver health checks build exactly the same name, and so the IPv6 nibble
 * expansion is unit-testable on its own.
 */
final class ReverseName
{
    /** @return string|null the reverse name, or null when the input is not an IP */
    public static function forIp($ip)
    {
        $ip = trim((string) $ip, " \t\n\r[]");
        $packed = @inet_pton($ip);
        if ($packed === false) {
            return null;
        }
        if (strlen($packed) === 4) {
            return implode('.', array_reverse(explode('.', $ip))) . '.in-addr.arpa';
        }
        $nibbles = str_split(bin2hex($packed));
        return implode('.', array_reverse($nibbles)) . '.ip6.arpa';
    }
}
