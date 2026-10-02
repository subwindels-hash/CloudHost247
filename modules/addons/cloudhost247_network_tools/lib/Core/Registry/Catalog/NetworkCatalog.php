<?php
namespace CloudHost247\NetworkTools\Core\Registry\Catalog;

/**
 * Network tools (docs sections 23-29, 52).
 */
final class NetworkCatalog
{
    public static function definitions()
    {
        return array(
            'network/subnet-calculator' => array(
                'name' => 'Subnet Calculator',
                'category' => 'network',
                'icon' => 'grid',
                'summary' => 'IPv4 and IPv6 subnet maths: network, range, masks, binary and splitting.',
                'description' => 'Computes network and broadcast addresses, usable host range, host counts, subnet and wildcard masks and the binary form, and can split a network into equal subnets.',
                'explanation' => 'All values are derived arithmetically from the address and prefix length, and are exact for the address family shown. IPv6 host counts are reported as powers of two because the decimal form is impractical.',
                'fields' => array(
                    array('name' => 'cidr', 'type' => 'cidr', 'label' => 'Network in CIDR notation', 'required' => true, 'placeholder' => '192.0.2.0/24 or 2001:db8::/48', 'target' => true),
                    array('name' => 'split', 'type' => 'number', 'label' => 'Split into subnets', 'required' => false, 'default' => 0, 'min' => 0, 'max' => 256, 'help' => '0 or 1 keeps the network as entered. Up to 256 equal subnets are listed.'),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Network\\SubnetService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'exports' => array('json', 'csv', 'pdf'),
                'result_view' => 'details',
            ),
            'network/ping' => array(
                'name' => 'Ping Test',
                'category' => 'network',
                'icon' => 'radio',
                'summary' => 'Measure packet loss and latency to a host, within strict limits.',
                'description' => 'Sends a small, fixed number of echo probes and reports packets sent/received, loss and min/average/max latency. Uses ICMP when the hosting environment permits raw sockets and a clearly-labelled TCP handshake probe otherwise.',
                'explanation' => 'A TCP probe measures reachability of a port, not ICMP echo: it is labelled as such in the result and must not be read as an ICMP ping. Targets are validated, private ranges are blocked, and each caller has a strict request budget.',
                'fields' => array(
                    array('name' => 'target', 'type' => 'hostname', 'label' => 'Host or IP', 'required' => true, 'placeholder' => 'example.com', 'target' => true),
                    array('name' => 'count', 'type' => 'number', 'label' => 'Probes', 'required' => false, 'default' => 4, 'min' => 1, 'max' => 5),
                    array('name' => 'port', 'type' => 'port', 'label' => 'Port for the TCP probe', 'required' => false, 'default' => 443, 'help' => 'Only used when ICMP is unavailable in this environment.'),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Network\\PingService',
                'rate_tier' => 'high_risk',
                'high_risk' => true,
                'target_field' => 'target',
                'timeout_seconds' => 20,
                'cache_seconds' => 0,
                'exports' => array('json', 'csv', 'pdf'),
                'result_view' => 'latency',
                'capabilities' => array('tcp_outbound'),
                'notes' => array('ICMP echo requires raw sockets, which most cPanel shared hosts do not grant; the TCP fallback is labelled in the result.'),
            ),
            'network/traceroute' => array(
                'name' => 'Traceroute',
                'category' => 'network',
                'icon' => 'route',
                'summary' => 'Trace the network path to a host, hop by hop, where the environment allows it.',
                'description' => 'Sends time-limited probes and records each hop\'s address, hostname and latency. Requires raw ICMP sockets; when the hosting environment does not permit them the tool reports UNAVAILABLE_IN_THIS_ENVIRONMENT and never invents a path.',
                'explanation' => 'Traceroute paths depend on routing at the moment of the test and can change minute to minute. Hops that do not answer are shown as timeouts, which is common and not itself a fault.',
                'fields' => array(
                    array('name' => 'target', 'type' => 'hostname', 'label' => 'Host or IP', 'required' => true, 'target' => true),
                    array('name' => 'max_hops', 'type' => 'number', 'label' => 'Maximum hops', 'required' => false, 'default' => 15, 'min' => 1, 'max' => 20),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Network\\TracerouteService',
                'rate_tier' => 'high_risk',
                'high_risk' => true,
                'target_field' => 'target',
                'timeout_seconds' => 30,
                'cache_seconds' => 0,
                'exports' => array('json', 'csv', 'pdf'),
                'result_view' => 'hops',
                'capabilities' => array('raw_icmp'),
            ),
            'network/port-checker' => array(
                'name' => 'Port Checker',
                'category' => 'network',
                'icon' => 'plug',
                'summary' => 'Check whether specific TCP ports accept a connection.',
                'description' => 'Attempts a TCP connection to one port or a small range on a validated public host and reports open, closed, filtered/timeout or unreachable with the time taken.',
                'explanation' => 'A closed result means the host answered and refused; a timeout usually means a firewall dropped the packet. UDP ports cannot be checked reliably this way and are not offered. Port checks are rate limited and limited to a small range to prevent abuse.',
                'fields' => array(
                    array('name' => 'host', 'type' => 'hostname', 'label' => 'Host or IP', 'required' => true, 'placeholder' => 'example.com', 'target' => true),
                    array('name' => 'ports', 'type' => 'ports', 'label' => 'Ports', 'required' => true, 'default' => '443', 'placeholder' => '80,443 or 8000-8010', 'max' => 16),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Network\\PortCheckService',
                'rate_tier' => 'high_risk',
                'high_risk' => true,
                'target_field' => 'host',
                'timeout_seconds' => 25,
                'cache_seconds' => 0,
                'exports' => array('json', 'csv', 'pdf'),
                'result_view' => 'ports',
                'capabilities' => array('tcp_outbound'),
            ),
            'network/mac-lookup' => array(
                'name' => 'MAC Address Lookup',
                'category' => 'network',
                'icon' => 'ethernet',
                'summary' => 'Identify the organisation a MAC address was assigned to.',
                'description' => 'Parses the address, extracts the OUI and reports the assignee from the OUI data file shipped with the platform, plus the address type bits.',
                'explanation' => 'The OUI identifies the manufacturer that registered the prefix. Randomized and locally administered addresses intentionally do not identify a vendor, and the tool says so rather than returning a wrong company.',
                'fields' => array(
                    array('name' => 'mac', 'type' => 'mac', 'label' => 'MAC address', 'required' => true, 'placeholder' => '00:1B:44:11:3A:B7', 'target' => true),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Network\\MacService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'method' => 'lookup',
                'rate_tier' => 'local',
                'cache_seconds' => 86400,
                'exports' => array('json', 'csv'),
                'result_view' => 'details',
            ),
            'network/mac-generator' => array(
                'name' => 'MAC Address Generator',
                'category' => 'network',
                'icon' => 'random',
                'summary' => 'Generate valid, correctly formatted MAC addresses.',
                'description' => 'Produces universally administered or locally administered addresses with cryptographically secure randomness, and explains the bit that distinguishes them.',
                'explanation' => 'The tool returns addresses that a network stack will accept structurally. It does not assign them to anything: an address must not be used to impersonate a device on a network you do not own.',
                'fields' => array(
                    array('name' => 'count', 'type' => 'number', 'label' => 'How many', 'required' => false, 'default' => 5, 'min' => 1, 'max' => 20),
                    array('name' => 'kind', 'type' => 'select', 'label' => 'Type', 'required' => false, 'default' => 'universal', 'options' => array('universal' => 'Universally administered', 'local' => 'Locally administered', 'random' => 'Random (any)')),
                    array('name' => 'separator', 'type' => 'select', 'label' => 'Separator', 'required' => false, 'default' => ':', 'options' => array(':' => 'Colon (00:1B:44)', '-' => 'Hyphen (00-1B-44)', '.' => 'Cisco style (001b.4411.3ab7)')),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Network\\MacService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'method' => 'generate',
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'exports' => array('json', 'csv'),
                'result_view' => 'generated',
            ),
            'network/asn' => array(
                'name' => 'ASN Lookup',
                'category' => 'network',
                'icon' => 'sitemap',
                'summary' => 'Look up an autonomous system and the prefixes it announces.',
                'description' => 'Resolves the ASN name, country and registry from the configured ASN provider and, where the provider publishes them, the announced prefixes.',
                'explanation' => 'Prefix lists change constantly. When a provider does not return prefixes the tool shows the ASN record only — it never fills the gap with guesses.',
                'fields' => array(
                    array('name' => 'asn', 'type' => 'asn', 'label' => 'ASN', 'required' => true, 'placeholder' => 'AS15169', 'target' => true),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Ip\\AsnService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'providers' => array('ipinfo', 'ipwhoapi'),
                'cache_seconds' => 3600,
                'exports' => array('json', 'csv', 'pdf'),
                'result_view' => 'details',
            ),
            'network/speed-test' => array(
                'name' => 'Internet Speed Test',
                'category' => 'network',
                'icon' => 'gauge',
                'summary' => 'Measure download, upload, latency and jitter from this browser, within a fixed budget.',
                'description' => 'Transfers a bounded amount of data to and from the CloudHost247 speed-test endpoint to estimate throughput, and reports latency and jitter from the same series of requests.',
                'explanation' => 'The result describes the connection between this browser and the CloudHost247 server that served it — not the whole internet path, and not another provider\'s speed test. The transfer is capped by both size and duration, so a test cannot consume unlimited bandwidth.',
                'fields' => array(
                    array('name' => 'size_megabytes', 'type' => 'number', 'label' => 'Maximum transfer size (MB)', 'required' => false, 'default' => 3, 'min' => 1, 'max' => 8),
                    array('name' => 'duration_seconds', 'type' => 'number', 'label' => 'Maximum duration (seconds)', 'required' => false, 'default' => 12, 'min' => 3, 'max' => 20),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Network\\SpeedTestService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'rate_tier' => 'high_risk',
                'high_risk' => true,
                'timeout_seconds' => 30,
                'cache_seconds' => 0,
                'exports' => array('json'),
                'result_view' => 'speedtest',
                'notes' => array('Bandwidth is capped per test and per caller; the endpoint serves generated data and never reads from disk or the network.'),
            ),
        );
    }
}
