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
            'dedicated_ipmi_status' => array('family' => 'dedicated', 'kind' => 'read',  'label' => 'IPMI feature status',   'path' => '/features/ipmi'),
            'dedicated_templates'   => array('family' => 'dedicated', 'kind' => 'read',  'label' => 'Compatible install templates', 'path' => '/install/compatibleTemplates'),
            'dedicated_monitoring'  => array('family' => 'dedicated', 'kind' => 'write', 'label' => 'Enable/disable monitoring', 'destructive' => false, 'fields' => array('monitoring')),
            'dedicated_set_boot'    => array('family' => 'dedicated', 'kind' => 'write', 'label' => 'Select next boot (rescue/disk)', 'destructive' => false, 'fields' => array('boot_id')),
            'dedicated_ipmi_access' => array('family' => 'dedicated', 'kind' => 'write', 'label' => 'Request IPMI access',   'destructive' => false, 'fields' => array('ip_to_allow', 'ttl', 'type')),
            'dedicated_reinstall'   => array('family' => 'dedicated', 'kind' => 'write', 'label' => 'Reinstall operating system', 'destructive' => true,  'fields' => array('template_name', 'hostname')),
        );
    }

    public function read($serviceId, $action)
    {
        $def = $this->definition($serviceId, $action, 'read');
        return $this->manager->readSub($serviceId, $def['path']);
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

        list($method, $suffix, $body) = $this->request($action, $input);
        AuditLogger::record('cloudhost247_ovh', 'service.advanced.' . $action, 'service', (int) $serviceId, array(), array('requested' => true));
        return $this->manager->performSub($serviceId, 'adv_' . $action, $method, $suffix, $body);
    }

    private function definition($serviceId, $action, $kind)
    {
        $catalog = self::catalog();
        if (!isset($catalog[$action]) || $catalog[$action]['kind'] !== $kind) {
            throw new InvalidArgumentException('Unknown or unsupported OVH operation.');
        }
        $identity = $this->manager->identity($serviceId);
        if ($identity['family'] !== $catalog[$action]['family']) {
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
                return array('POST', '/createSnapshot', array('description' => $description));
            case 'vps_snapshot_revert':
                return array('POST', '/snapshot/revert', array());
            case 'vps_snapshot_delete':
                return array('DELETE', '/snapshot', array());
            case 'vps_reinstall':
                return array('POST', '/reinstall', array('templateId' => $this->positiveInt($in, 'template_id', 'Template ID')));
            case 'dedicated_monitoring':
                return array('PUT', '', array('monitoring' => !empty($in['monitoring']) && $in['monitoring'] !== 'false' && $in['monitoring'] !== '0'));
            case 'dedicated_set_boot':
                return array('PUT', '', array('bootId' => $this->positiveInt($in, 'boot_id', 'Boot ID')));
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
                return array('POST', '/features/ipmi/access', array('ipToAllow' => $ip, 'ttl' => $ttl, 'type' => $type));
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
                return array('POST', '/install/start', $body);
        }
        throw new InvalidArgumentException('Unknown or unsupported OVH operation.');
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
