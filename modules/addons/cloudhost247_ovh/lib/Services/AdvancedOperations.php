<?php
namespace CloudHost247\Ovh\Services;

use CloudHost247\Foundation\Support\AuditLogger;
use InvalidArgumentException;
use RuntimeException;

/**
 * Administrator-only advanced operations for linked OVH VPS and dedicated services:
 * snapshots, automated-backup status, task history, reinstall, rescue boot selection,
 * IPMI access, and monitoring.
 *
 * Safety model
 *  - Only actions in catalog() exist; the family must match the service's linked family.
 *  - Reads are plain allowlisted GETs and change nothing.
 *  - Every write requires explicit confirmation, runs through ServiceManager's ledgered,
 *    idempotent, never-auto-retried mutation path (uncertain results become
 *    reconciliation_required) and is audited.
 *  - Destructive writes (reinstall, snapshot revert/delete) additionally require the
 *    administrator to type the exact OVH service name.
 *  - Inputs are validated against strict patterns; nothing from a request is placed in a
 *    path, and no value is guessed or defaulted for a destructive action.
 *
 * The endpoint shapes follow OVH's public API reference. They have not been exercised
 * against a live OVH account (see docs/independent-rebuild/OVH-INTEGRATION.md).
 */
final class AdvancedOperations
{
    /** @var ServiceManager (any object exposing identity(), readSub() and performSub()) */
    private $manager;

    public function __construct($manager)
    {
        $this->manager = $manager;
    }

    /**
     * @return array<string,array<string,mixed>> action => definition
     */
    public static function catalog()
    {
        return array(
            // ---- VPS
            'vps_snapshot_status'   => array('family' => 'vps', 'kind' => 'read',  'label' => 'Snapshot status',            'path' => '/snapshot'),
            'vps_backup_status'     => array('family' => 'vps', 'kind' => 'read',  'label' => 'Automated backup status',    'path' => '/automatedBackup'),
            'vps_tasks'             => array('family' => 'vps', 'kind' => 'read',  'label' => 'Task history',               'path' => '/tasks'),
            'vps_templates'         => array('family' => 'vps', 'kind' => 'read',  'label' => 'Reinstall templates',        'path' => '/templates'),
            'vps_snapshot_create'   => array('family' => 'vps', 'kind' => 'write', 'label' => 'Create snapshot',            'destructive' => false, 'fields' => array('description')),
            'vps_snapshot_revert'   => array('family' => 'vps', 'kind' => 'write', 'label' => 'Revert to snapshot',         'destructive' => true,  'fields' => array()),
            'vps_snapshot_delete'   => array('family' => 'vps', 'kind' => 'write', 'label' => 'Delete snapshot',            'destructive' => true,  'fields' => array()),
            'vps_reinstall'         => array('family' => 'vps', 'kind' => 'write', 'label' => 'Reinstall operating system', 'destructive' => true,  'fields' => array('template_id')),
            // ---- Dedicated
            'dedicated_tasks'       => array('family' => 'dedicated', 'kind' => 'read',  'label' => 'Task history',          'path' => '/task'),
            'dedicated_rescue_boot' => array('family' => 'dedicated', 'kind' => 'read',  'label' => 'Rescue boot options',   'path' => '/boot?bootType=rescue'),
            'dedicated_boot_options' => array('family' => 'dedicated', 'kind' => 'read', 'label' => 'All boot options (disk/rescue/netboot)', 'path' => '/boot'),
            'dedicated_interventions' => array('family' => 'dedicated', 'kind' => 'read', 'label' => 'Intervention history', 'path' => '/intervention'),
            'dedicated_intervention' => array('family' => 'dedicated', 'kind' => 'read', 'label' => 'Intervention detail', 'path_template' => '/intervention/{intervention_id}', 'fields' => array('intervention_id')),
            'dedicated_ipmi_status' => array('family' => 'dedicated', 'kind' => 'read',  'label' => 'IPMI feature status',   'path' => '/features/ipmi'),
            'dedicated_templates'   => array('family' => 'dedicated', 'kind' => 'read',  'label' => 'Compatible install templates', 'path' => '/install/compatibleTemplates'),
            'dedicated_monitoring'  => array('family' => 'dedicated', 'kind' => 'write', 'label' => 'Enable/disable monitoring', 'destructive' => false, 'fields' => array('monitoring')),
            'dedicated_set_boot'    => array('family' => 'dedicated', 'kind' => 'write', 'label' => 'Select next boot (boot id, optional type/kernel)', 'destructive' => false, 'fields' => array('boot_id', 'boot_type', 'kernel')),
            'dedicated_ipmi_access' => array('family' => 'dedicated', 'kind' => 'write', 'label' => 'Request IPMI access',   'destructive' => false, 'fields' => array('ip_to_allow', 'ttl', 'type')),
            'dedicated_reinstall'   => array('family' => 'dedicated', 'kind' => 'write', 'label' => 'Reinstall operating system', 'destructive' => true,  'fields' => array('template_name', 'hostname')),
            // ---- Firewall Network (address-scoped on both families; the address
            // must be one OVH reports for the linked service — see ServiceManager).
            'firewall_status'       => array('family' => array('vps', 'dedicated'), 'kind' => 'read', 'label' => 'Addresses on the network firewall', 'path' => '/firewall', 'address' => true, 'fields' => array('ip')),
            'firewall_rules'        => array('family' => array('vps', 'dedicated'), 'kind' => 'read', 'label' => 'Firewall rules for one protected IP', 'path_template' => '/firewall/{firewall}/rule', 'address' => true, 'fields' => array('ip', 'firewall')),
            'firewall_rule_add'     => array('family' => array('vps', 'dedicated'), 'kind' => 'write', 'label' => 'Add a firewall rule (changes network reachability)', 'destructive' => true, 'address' => true, 'fields' => array('ip', 'firewall', 'action', 'protocol', 'source', 'destination_port', 'source_port', 'sequence')),
            'firewall_rule_delete'  => array('family' => array('vps', 'dedicated'), 'kind' => 'write', 'label' => 'Delete a firewall rule (changes network reachability)', 'destructive' => true, 'address' => true, 'fields' => array('ip', 'firewall', 'sequence')),
        );
    }

    /**
     * Run a read-only action.
     *
     * Actions with a static path ignore $input. Actions whose path carries a
     * validated identifier (an intervention id, a firewall name) build it from
     * the validated value — never from the raw request.
     *
     * @param array<string,mixed> $input
     */
    public function read($serviceId, $action, array $input = array())
    {
        $def = $this->definition($serviceId, $action, 'read');
        $suffix = isset($def['path_template'])
            ? $this->fillPath($def['path_template'], $action, $input)
            : $def['path'];
        if (!empty($def['address'])) {
            return $this->manager->ipSub($serviceId, $this->address($input), $suffix);
        }
        return $this->manager->readSub($serviceId, $suffix);
    }

    /**
     * @param array<string,mixed> $input     Raw administrator input; validated here.
     * @param bool                $confirmed Explicit confirmation checkbox.
     * @param string              $typedName Service name typed by the administrator (destructive only).
     */
    public function run($serviceId, $action, array $input, $confirmed, $typedName = '')
    {
        $def = $this->definition($serviceId, $action, 'write');
        if (!$confirmed) {
            throw new InvalidArgumentException('Explicit confirmation is required for this OVH operation.');
        }
        $identity = $this->manager->identity($serviceId);
        if (!empty($def['destructive']) && !hash_equals($identity['service_name'], trim((string) $typedName))) {
            throw new InvalidArgumentException('Type the exact OVH service name to confirm this destructive operation.');
        }

        list($method, $suffix, $body, $address) = $this->request($action, $input);
        AuditLogger::record('cloudhost247_ovh', 'service.advanced.' . $action, 'service', (int) $serviceId, array(), array('requested' => true, 'address' => $address));
        if ($address !== null) {
            return $this->manager->performIpSub($serviceId, $address, 'adv_' . $action, $method, $suffix, $body);
        }
        return $this->manager->performSub($serviceId, 'adv_' . $action, $method, $suffix, $body);
    }

    private function definition($serviceId, $action, $kind)
    {
        $catalog = self::catalog();
        if (!isset($catalog[$action]) || $catalog[$action]['kind'] !== $kind) {
            throw new InvalidArgumentException('Unknown or unsupported OVH operation.');
        }
        $identity = $this->manager->identity($serviceId);
        if (!in_array($identity['family'], (array) $catalog[$action]['family'], true)) {
            throw new RuntimeException('This operation is not available for the linked OVH service family.');
        }
        return $catalog[$action];
    }

    /**
     * Build the validated request. Returns array(method, suffix beneath the service base, body).
     */
    private function request($action, array $in)
    {
        switch ($action) {
            case 'vps_snapshot_create':
                $description = trim((string) ($in['description'] ?? ''));
                if ($description === '' || strlen($description) > 255 || !preg_match('/^[\p{L}\p{N} ._:,()\/-]+$/u', $description)) {
                    throw new InvalidArgumentException('Snapshot description is required (max 255 letters, digits and basic punctuation).');
                }
                return array('POST', '/createSnapshot', array('description' => $description), null);
            case 'vps_snapshot_revert':
                return array('POST', '/snapshot/revert', array(), null);
            case 'vps_snapshot_delete':
                return array('DELETE', '/snapshot', array(), null);
            case 'vps_reinstall':
                return array('POST', '/reinstall', array('templateId' => $this->positiveInt($in, 'template_id', 'Template ID')), null);
            case 'dedicated_monitoring':
                return array('PUT', '', array('monitoring' => !empty($in['monitoring']) && $in['monitoring'] !== 'false' && $in['monitoring'] !== '0'), null);
            case 'dedicated_set_boot':
                $body = array('bootId' => $this->positiveInt($in, 'boot_id', 'Boot ID'));
                $bootType = trim((string) ($in['boot_type'] ?? ''));
                $kernel = trim((string) ($in['kernel'] ?? ''));
                if ($bootType !== '') {
                    if (!in_array($bootType, self::BOOT_TYPES, true)) {
                        throw new InvalidArgumentException('Unsupported boot type; use harddisk, rescue or netboot.');
                    }
                    $body['bootType'] = $bootType;
                }
                if ($kernel !== '') {
                    if (!preg_match('/^[A-Za-z0-9._-]{1,128}$/', $kernel)) {
                        throw new InvalidArgumentException('Invalid kernel identifier.');
                    }
                    // A kernel only means anything for a netboot selection.
                    if ($bootType !== 'netboot') {
                        throw new InvalidArgumentException('A kernel can only be set together with the netboot boot type.');
                    }
                    $body['kernel'] = $kernel;
                }
                return array('PUT', '', $body, null);
            case 'dedicated_ipmi_access':
                $ip = trim((string) ($in['ip_to_allow'] ?? ''));
                if (!filter_var($ip, FILTER_VALIDATE_IP)) {
                    throw new InvalidArgumentException('A valid IP address to allow is required.');
                }
                $ttl = (int) ($in['ttl'] ?? 0);
                if (!in_array($ttl, array(1, 3, 5, 10, 15), true)) {
                    throw new InvalidArgumentException('IPMI access time-to-live must be 1, 3, 5, 10 or 15 minutes.');
                }
                $type = (string) ($in['type'] ?? '');
                if (!in_array($type, array('kvmipHtml5URL', 'kvmipJnlp', 'serialOverLanURL', 'serialOverLanSshKey'), true)) {
                    throw new InvalidArgumentException('Unsupported IPMI access type.');
                }
                return array('POST', '/features/ipmi/access', array('ipToAllow' => $ip, 'ttl' => $ttl, 'type' => $type), null);
            case 'dedicated_reinstall':
                $template = trim((string) ($in['template_name'] ?? ''));
                if (!preg_match('/^[A-Za-z0-9._-]{1,128}$/', $template)) {
                    throw new InvalidArgumentException('A valid install template name is required.');
                }
                $body = array('templateName' => $template);
                $hostname = trim((string) ($in['hostname'] ?? ''));
                if ($hostname !== '') {
                    if (!filter_var($hostname, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME)) {
                        throw new InvalidArgumentException('Invalid hostname.');
                    }
                    $body['details'] = array('customHostname' => $hostname);
                }
                return array('POST', '/install/start', $body, null);
            case 'firewall_rule_add':
                $rule = array(
                    'action' => $this->enumValue($in, 'action', self::FIREWALL_ACTIONS, 'Rule action'),
                    'protocol' => $this->enumValue($in, 'protocol', self::FIREWALL_PROTOCOLS, 'Rule protocol'),
                    'source' => $this->source($in),
                );
                $destination = trim((string) ($in['destination_port'] ?? ''));
                if ($destination !== '') {
                    if (!in_array($rule['protocol'], array('tcp', 'udp'), true)) {
                        throw new InvalidArgumentException('A destination port only applies to TCP or UDP rules.');
                    }
                    $rule['destinationPort'] = $this->portNumber($destination, 'Destination port');
                } elseif (in_array($rule['protocol'], array('tcp', 'udp'), true)) {
                    throw new InvalidArgumentException('A TCP or UDP rule requires a destination port.');
                }
                $sourcePort = trim((string) ($in['source_port'] ?? ''));
                if ($sourcePort !== '') {
                    if (!in_array($rule['protocol'], array('tcp', 'udp'), true)) {
                        throw new InvalidArgumentException('A source port only applies to TCP or UDP rules.');
                    }
                    $rule['sourcePort'] = $this->portNumber($sourcePort, 'Source port');
                }
                if (trim((string) ($in['sequence'] ?? '')) !== '') {
                    $rule['sequence'] = $this->ruleSequence($in['sequence']);
                }
                return array('POST', '/firewall/' . $this->firewallAddress($in) . '/rule', $rule, $this->address($in));
            case 'firewall_rule_delete':
                return array('DELETE', '/firewall/' . $this->firewallAddress($in) . '/rule/' . $this->ruleSequence($in['sequence'] ?? ''), array(), $this->address($in));
        }
        throw new InvalidArgumentException('Unknown or unsupported OVH operation.');
    }

    /** Boot types OVH exposes for a dedicated server's next boot. */
    const BOOT_TYPES = array('harddisk', 'rescue', 'netboot');
    /** OVH's own enums for a network-firewall rule. */
    const FIREWALL_ACTIONS = array('permit', 'deny');
    const FIREWALL_PROTOCOLS = array('ah', 'esp', 'gre', 'icmp', 'ipv4', 'tcp', 'udp');
    const MAX_RULE_SEQUENCE = 19;

    /**
     * The address an address-scoped action names. Validated for shape here and
     * for ownership by ServiceManager before any request is made.
     */
    private function address(array $in)
    {
        $ip = trim((string) ($in['ip'] ?? ''));
        if (!filter_var($ip, FILTER_VALIDATE_IP)) {
            throw new InvalidArgumentException('A valid IP address is required for this operation.');
        }
        return $ip;
    }

    /**
     * The address on the firewall (OVH's `ipOnFirewall`). It is scoped by the
     * verified /ip/{address} base, so a value from another block can only ever
     * produce a provider-side error, never touch another account's traffic.
     */
    private function firewallAddress(array $in)
    {
        $address = trim((string) ($in['firewall'] ?? ''));
        if (!filter_var($address, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            throw new InvalidArgumentException('The address on the firewall must be an IPv4 address.');
        }
        return $address;
    }

    private function enumValue(array $in, $key, array $allowed, $label)
    {
        $value = strtolower(trim((string) ($in[$key] ?? '')));
        if (!in_array($value, $allowed, true)) {
            throw new InvalidArgumentException($label . ' must be one of: ' . implode(', ', $allowed) . '.');
        }
        return $value;
    }

    /** A source is an address, a CIDR block, or the literal "any". */
    private function source(array $in)
    {
        $source = strtolower(trim((string) ($in['source'] ?? '')));
        if ($source === 'any') {
            return 'any';
        }
        $parts = explode('/', $source);
        if (count($parts) > 2 || !filter_var($parts[0], FILTER_VALIDATE_IP)) {
            throw new InvalidArgumentException('A rule source must be an IP address, a CIDR block or "any".');
        }
        if (count($parts) === 2) {
            if (!preg_match('/^[0-9]{1,3}$/', $parts[1])) {
                throw new InvalidArgumentException('Invalid CIDR prefix.');
            }
            $prefix = (int) $parts[1];
            $max = strpos($parts[0], ':') !== false ? 128 : 32;
            if ($prefix < 0 || $prefix > $max) {
                throw new InvalidArgumentException('CIDR prefix is out of range for the address family.');
            }
        }
        return $source;
    }

    /** OVH takes a single port number, not a range. */
    private function portNumber($value, $label)
    {
        $value = trim((string) $value);
        if (!preg_match('/^[0-9]{1,5}$/', $value)) {
            throw new InvalidArgumentException($label . ' must be a single port number between 1 and 65535.');
        }
        $port = (int) $value;
        if ($port < 1 || $port > 65535) {
            throw new InvalidArgumentException($label . ' must be between 1 and 65535.');
        }
        return $port;
    }

    /** A rule sequence is a position in the rule array, 0 to 19. */
    private function ruleSequence($value)
    {
        $value = trim((string) $value);
        if (!preg_match('/^[0-9]{1,2}$/', $value) || (int) $value > self::MAX_RULE_SEQUENCE) {
            throw new InvalidArgumentException('The rule sequence must be a whole number between 0 and ' . self::MAX_RULE_SEQUENCE . '.');
        }
        return (int) $value;
    }

    /**
     * Substitute validated identifiers into a read path template. Every
     * placeholder must be a declared field of the action and must validate.
     */
    private function fillPath($template, $action, array $input)
    {
        $catalog = self::catalog();
        $allowed = isset($catalog[$action]['fields']) ? $catalog[$action]['fields'] : array();
        return preg_replace_callback('/\{([a-z_]+)\}/', function ($m) use ($allowed, $input) {
            $key = $m[1];
            if (!in_array($key, $allowed, true)) {
                throw new RuntimeException('The path template references a field the action does not declare.');
            }
            if ($key === 'firewall') {
                return $this->firewallAddress($input);
            }
            return (string) $this->positiveInt($input, $key, ucwords(str_replace('_', ' ', $key)));
        }, $template);
    }

    private function positiveInt(array $in, $key, $label)
    {
        $v = $in[$key] ?? '';
        if (!is_scalar($v) || !preg_match('/^[1-9][0-9]{0,11}$/', (string) $v)) {
            throw new InvalidArgumentException($label . ' must be a positive whole number.');
        }
        return (int) $v;
    }
}
