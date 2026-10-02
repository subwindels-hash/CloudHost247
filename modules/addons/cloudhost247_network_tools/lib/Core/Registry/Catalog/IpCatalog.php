<?php
namespace CloudHost247\NetworkTools\Core\Registry\Catalog;

/**
 * IP tools (docs sections 16-20, 51).
 */
final class IpCatalog
{
    public static function definitions()
    {
        return array(
            'ip/lookup' => array(
                'name' => 'IP Address Lookup',
                'category' => 'ip',
                'icon' => 'map-pin',
                'summary' => 'Address intelligence: network, ASN, organisation, country and reverse DNS.',
                'description' => 'Combines the registry data CloudHost247 can read locally (reverse DNS, network/CIDR) with the geolocation and ASN provider configured in API & Integrations.',
                'explanation' => 'City-level geolocation is approximate: it reflects where the network provider registers the address block, not where a person or device is. When the geolocation provider is not configured the tool reports CONFIGURATION_REQUIRED instead of guessing.',
                'fields' => array(
                    array('name' => 'ip', 'type' => 'ip', 'label' => 'IP address', 'required' => true, 'placeholder' => '192.0.2.10', 'target' => true),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Ip\\LookupService',
                'method' => 'lookup',
                'providers' => array('ipinfo', 'ipwhoapi'),
                'target_field' => 'ip',
                'cache_seconds' => 3600,
                'exports' => array('json', 'csv', 'pdf'),
                'result_view' => 'details',
                'notes' => array('IPv4/IPv6 geolocation is approximate and must not be used as proof of a physical location.'),
            ),
            'ip/isp' => array(
                'name' => 'ISP Lookup',
                'category' => 'ip',
                'icon' => 'wifi',
                'summary' => 'Show the network operator, ASN and connection type recorded for an IP.',
                'description' => 'Reports the ISP/organisation, ASN, network name, registry and connection classification that the configured provider publishes for the address.',
                'explanation' => 'Organisation data comes from the regional internet registry through the provider. It describes the block holder, which is not always the retail ISP of the end user.',
                'fields' => array(
                    array('name' => 'ip', 'type' => 'ip', 'label' => 'IP address', 'required' => true, 'target' => true),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Ip\\LookupService',
                'method' => 'isp',
                'providers' => array('ipinfo', 'ipwhoapi'),
                'target_field' => 'ip',
                'cache_seconds' => 3600,
                'exports' => array('json', 'csv', 'pdf'),
                'result_view' => 'details',
            ),
            'ip/my-ip' => array(
                'name' => 'What Is My IP',
                'category' => 'ip',
                'icon' => 'eye',
                'summary' => 'Show the public address your connection is using, without third parties.',
                'description' => 'Reports the address the CloudHost247 web server sees, plus your browser user agent and connection details that are safe to show. Nothing is sent to a third party.',
                'explanation' => 'If the site is behind a proxy or CDN, the address shown depends on the trust configuration the administrator selected. Private details of the server are never exposed.',
                'fields' => array(),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Ip\\LookupService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'method' => 'myIp',
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'exports' => array('json'),
                'result_view' => 'details',
            ),
            'ip/whois' => array(
                'name' => 'IP WHOIS',
                'category' => 'ip',
                'icon' => 'file-text',
                'summary' => 'Read the registration data for an IPv4 or IPv6 address.',
                'description' => 'Queries the responsible regional internet registry over WHOIS port 43, or the configured WHOIS API when that is enabled, and shows the parsed objects.',
                'explanation' => 'WHOIS output is published by the registry. Fields that are not present are not shown; reserved and private ranges have no registry entry at all.',
                'fields' => array(
                    array('name' => 'ip', 'type' => 'public_ip', 'label' => 'IP address', 'required' => true, 'target' => true),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Ip\\WhoisService',
                'method' => 'ip',
                'providers' => array('whois'),
                'target_field' => 'ip',
                'cache_seconds' => 3600,
                'exports' => array('json', 'csv', 'pdf', 'txt'),
                'result_view' => 'whois',
            ),
            'ip/domain-to-ip' => array(
                'name' => 'Domain to IP',
                'category' => 'ip',
                'icon' => 'arrow-right',
                'summary' => 'Resolve a domain to its IPv4 and IPv6 addresses, including the CNAME chain.',
                'description' => 'Follows the CNAME chain and returns every A and AAAA address with the resolver, TTL and latency for each answer.',
                'explanation' => 'A domain can legitimately resolve to several addresses and can return different answers to different resolvers (round robin, geo-DNS or anycast).',
                'fields' => array(
                    array('name' => 'domain', 'type' => 'domain', 'label' => 'Domain', 'required' => true, 'target' => true),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Ip\\DomainIpService',
                'target_field' => 'domain',
                'cache_seconds' => 120,
                'exports' => array('json', 'csv', 'pdf'),
                'result_view' => 'records',
            ),
            'ip/ip-to-hostname' => array(
                'name' => 'IP to Hostname',
                'category' => 'ip',
                'icon' => 'arrow-left',
                'summary' => 'Turn an IP address back into a hostname through reverse DNS.',
                'description' => 'Performs the PTR lookup for the address and reports the hostname, plus forward confirmation when it can be checked.',
                'explanation' => 'Many addresses have no PTR record. That is normal for consumer connections and is reported as "no PTR record", not as an error.',
                'fields' => array(
                    array('name' => 'ip', 'type' => 'ip', 'label' => 'IP address', 'required' => true, 'target' => true),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Dns\\ReverseService',
                'method' => 'ptr',
                'target_field' => 'ip',
                'cache_seconds' => 300,
                'exports' => array('json', 'csv', 'pdf'),
                'result_view' => 'records',
            ),
            'ip/convert' => array(
                'name' => 'IP Converters',
                'category' => 'ip',
                'icon' => 'shuffle',
                'summary' => 'Convert between decimal, IPv4, IPv6, CIDR ranges and compressed forms.',
                'description' => 'Deterministic, offline conversions: IP to decimal, decimal to IP, IPv4 to IPv6-mapped, IPv6 compression and expansion, and IPv6 CIDR to range and back.',
                'explanation' => 'Every conversion is computed locally with 128-bit arithmetic, so the result is exact and reproducible. IPv6 cannot be converted to IPv4 unless it is an IPv4-mapped or NAT64 address, and the tool says so when it is not.',
                'fields' => array(
                    array('name' => 'operation', 'type' => 'select', 'label' => 'Conversion', 'required' => true, 'default' => 'ip_to_decimal', 'options' => array(
                        'ip_to_decimal' => 'IP → decimal', 'decimal_to_ip' => 'Decimal → IP', 'ipv4_to_ipv6' => 'IPv4 → IPv6 (mapped)',
                        'ipv6_to_ipv4' => 'IPv6 → IPv4 (mapped/NAT64 only)', 'ipv6_compress' => 'IPv6 compression',
                        'ipv6_expand' => 'IPv6 expansion', 'ipv6_cidr_to_range' => 'IPv6 CIDR → range', 'ipv6_range_to_cidr' => 'IPv6 range → CIDR',
                    )),
                    array('name' => 'value', 'type' => 'text', 'label' => 'Value', 'required' => true, 'placeholder' => '192.0.2.10, 3221226000, 2001:0db8::1/64', 'target' => true, 'maxlength' => 255),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Ip\\ConvertService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'exports' => array('json', 'csv'),
                'result_view' => 'details',
            ),
        );
    }
}
