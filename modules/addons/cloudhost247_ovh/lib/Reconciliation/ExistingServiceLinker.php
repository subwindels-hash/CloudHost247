<?php
namespace CloudHost247\Ovh\Reconciliation;

use CloudHost247\Ovh\Services\ConnectionResolver;
use WHMCS\Database\Capsule;
use InvalidArgumentException;
use RuntimeException;

/**
 * Binds an OVH service that already exists to the WHMCS service that represents
 * it.
 *
 * Three rules, because this is the step where an operator can attach the wrong
 * remote server to a customer:
 *
 *   - the remote name must exist and belong to the selected family;
 *   - one remote service is bound to at most one WHMCS service;
 *   - replacing an existing binding is a *different* action and needs its own
 *     explicit confirmation, so a stray link cannot silently move a customer.
 *
 * `directory()` is the read side: a bounded, paginated view of what OVH owns and
 * what the local bindings say, with ranked WHMCS suggestions but no writes.
 */
final class ExistingServiceLinker
{
    const PAGE_SIZE = 25;
    const MAX_REMOTE = 2000;

    private $resolver;
    private $endpointFactory;

    /**
     * $endpointFactory is a test seam: when supplied, it hands back the client for
     * an endpoint instead of the vault-backed resolver. Production code omits it,
     * and nothing else in this class changes behaviour.
     */
    public function __construct(ConnectionResolver $resolver, ?callable $endpointFactory = null)
    {
        $this->resolver = $resolver;
        $this->endpointFactory = $endpointFactory;
    }

    private function client($endpointId)
    {
        if ($this->endpointFactory !== null) { return call_user_func($this->endpointFactory, $endpointId); }
        return $this->resolver->endpoint($endpointId);
    }

    /** The bounded existing-service directory used by the admin screen. */
    public function directory($endpointId, array $filters = array())
    {
        $familyFilter = isset($filters['family']) && in_array($filters['family'], array('dedicated', 'vps'), true) ? $filters['family'] : 'all';
        $linkState = isset($filters['link_state']) && in_array($filters['link_state'], array('linked', 'unlinked', 'all'), true) ? $filters['link_state'] : 'all';
        $query = strtolower(substr(trim(strip_tags((string) (isset($filters['query']) ? $filters['query'] : ''))), 0, 100));
        $page = max(1, (int) (isset($filters['page']) ? $filters['page'] : 1));

        $families = $familyFilter === 'all' ? array('dedicated', 'vps') : array($familyFilter);
        $client = $this->client($endpointId);
        $remote = array();
        $truncated = false;
        foreach ($families as $family) {
            $names = (array) $client->get($family === 'vps' ? '/vps' : '/dedicated/server');
            foreach ($names as $name) {
                if (!is_string($name) || $name === '') { continue; }
                if (count($remote) >= self::MAX_REMOTE) { $truncated = true; break 2; }
                if ($query !== '' && strpos(strtolower($name), $query) === false) { continue; }
                $remote[] = array('family' => $family, 'name' => $name);
            }
        }

        $bindings = array();
        foreach (Capsule::table('mod_cloudhost247_ovh_services')->where('endpoint_id', (int) $endpointId)->select('id', 'remote_service_name', 'whmcs_service_id', 'status')->get() as $binding) {
            $bindings[(string) $binding->remote_service_name] = $binding;
        }
        $local = array();
        foreach (Capsule::table('tblhosting')->select('id', 'userid', 'domain', 'dedicatedip', 'domainstatus')->limit(2000)->get() as $hosting) {
            $local[] = array('id' => (int) $hosting->id, 'userid' => (int) $hosting->userid, 'domain' => (string) $hosting->domain, 'dedicatedip' => (string) $hosting->dedicatedip, 'status' => (string) $hosting->domainstatus);
        }
        $matcher = new ServiceMatcher();

        $rows = array();
        foreach ($remote as $service) {
            $binding = isset($bindings[$service['name']]) ? $bindings[$service['name']] : null;
            $linked = $binding !== null;
            if ($linkState === 'linked' && !$linked) { continue; }
            if ($linkState === 'unlinked' && $linked) { continue; }
            $ranked = $matcher->rank($service['name'], $local);
            $rows[] = array(
                'family' => $service['family'],
                'remote_service_name' => $service['name'],
                'already_linked' => $linked,
                'linked_whmcs_service_id' => $linked ? (int) $binding->whmcs_service_id : 0,
                'binding_status' => $linked ? (string) $binding->status : '',
                'suggestions' => array_slice($ranked, 0, 5),
            );
        }

        $total = count($rows);
        $pages = max(1, (int) ceil($total / self::PAGE_SIZE));
        $page = min($page, $pages);
        return array(
            'rows' => array_slice($rows, ($page - 1) * self::PAGE_SIZE, self::PAGE_SIZE),
            'endpoint_id' => (int) $endpointId,
            'page' => $page,
            'pages' => $pages,
            'total' => $total,
            'family' => $familyFilter,
            'link_state' => $linkState,
            'query' => $query,
            'truncated' => $truncated,
            'note' => $truncated
                ? 'The remote listing was cut at ' . self::MAX_REMOTE . ' services; narrow the search to see the rest.'
                : 'Read-only view of what OVH owns and what is bound locally. Nothing was changed.',
        );
    }

    /**
     * The legacy read-only search kept for callers that pass a plain query.
     * Retained because the admin screen used it before the directory existed.
     */
    public function search($endpointId, $query = '')
    {
        return $this->directory($endpointId, array('query' => $query))['rows'];
    }

    /** What a confirmed link would change, without changing it. */
    public function preview($endpointId, $name, $family, $whmcsServiceId)
    {
        $this->validate($name, $family);
        $hosting = Capsule::table('tblhosting')->where('id', (int) $whmcsServiceId)->first();
        if (!$hosting) { throw new InvalidArgumentException('WHMCS service does not exist.'); }
        $path = $family === 'vps' ? '/vps/' . rawurlencode($name) : '/dedicated/server/' . rawurlencode($name);
        $remote = $this->client($endpointId)->get($path);
        $existing = Capsule::table('mod_cloudhost247_ovh_services')->where('whmcs_service_id', (int) $whmcsServiceId)->first();
        $claimed = Capsule::table('mod_cloudhost247_ovh_services')->where('endpoint_id', (int) $endpointId)->where('remote_service_name', $name)->where('whmcs_service_id', '!=', (int) $whmcsServiceId)->first();
        return array(
            'whmcs' => array('id' => (int) $hosting->id, 'client_id' => (int) $hosting->userid, 'product_id' => (int) $hosting->packageid, 'status' => (string) $hosting->domainstatus),
            'remote' => $remote,
            'family' => $family,
            'remote_service_name' => $name,
            'current_binding' => $existing ? array('remote_service_name' => (string) $existing->remote_service_name, 'family' => (string) $existing->family, 'status' => (string) $existing->status) : null,
            'replacement_required' => $existing && (string) $existing->remote_service_name !== $name,
            'claimed_elsewhere' => $claimed ? (int) $claimed->whmcs_service_id : 0,
        );
    }

    /**
     * Binds the remote service to the WHMCS service.
     *
     * $replace must be true when the WHMCS service is already bound to a
     * *different* remote name; the caller obtains that from the operator, and the
     * audit trail records the previous identity either way.
     */
    public function link($endpointId, $name, $family, $whmcsServiceId, $confirmed, $adminId, $replace = false)
    {
        if (!$confirmed) { throw new InvalidArgumentException('Explicit link confirmation is required.'); }
        $preview = $this->preview($endpointId, $name, $family, $whmcsServiceId);
        if ($preview['claimed_elsewhere'] > 0) {
            throw new InvalidArgumentException('OVH service is already linked to another WHMCS service.');
        }
        if ($preview['replacement_required'] && !$replace) {
            throw new InvalidArgumentException('This WHMCS service is already linked to "' . $preview['current_binding']['remote_service_name'] . '". Confirm the replacement explicitly to rebind it.');
        }
        $before = Capsule::table('mod_cloudhost247_ovh_services')->where('whmcs_service_id', (int) $whmcsServiceId)->first();
        Capsule::table('mod_cloudhost247_ovh_services')->updateOrInsert(
            array('whmcs_service_id' => (int) $whmcsServiceId),
            array(
                'endpoint_id' => (int) $endpointId,
                'family' => $family,
                'remote_service_name' => $name,
                'status' => 'active',
                'details_json' => json_encode($preview['remote']),
                'last_synced_at' => date('Y-m-d H:i:s'),
                'updated_at' => date('Y-m-d H:i:s'),
            )
        );
        Capsule::table('mod_cloudhost247_ovh_audit')->insert(array(
            'admin_id' => (int) $adminId,
            'action' => $preview['replacement_required'] ? 'service.relink' : 'service.link',
            'target_type' => 'hosting',
            'target_id' => (int) $whmcsServiceId,
            'before_json' => json_encode($before),
            'after_json' => json_encode(array('endpoint_id' => (int) $endpointId, 'family' => $family, 'remote_service_name' => $name, 'replaced' => (bool) $preview['replacement_required'])),
            'created_at' => date('Y-m-d H:i:s'),
        ));
        return $preview;
    }

    /**
     * Binds a remote service that an order delivered but could not be resolved
     * automatically (`intervention_required`), and clears the intervention.
     *
     * The operator supplies the name after reading the evidence; this method
     * refuses to invent it, refuses a name another binding owns, and records the
     * order reference it was reconciled against.
     */
    public function resolveIntervention($bindingId, $name, $family, $confirmed, $adminId)
    {
        if (!$confirmed) { throw new InvalidArgumentException('Explicit reconciliation confirmation is required.'); }
        $binding = Capsule::table('mod_cloudhost247_ovh_services')->where('id', (int) $bindingId)->first();
        if (!$binding) { throw new InvalidArgumentException('Service binding does not exist.'); }
        if ((string) $binding->status !== 'intervention_required') {
            throw new RuntimeException('Only a binding awaiting intervention can be reconciled by hand.');
        }
        if (trim((string) $binding->remote_order_id) === '') {
            throw new RuntimeException('There is no order reference to reconcile against.');
        }
        $this->validate($name, $family);
        if (Capsule::table('mod_cloudhost247_ovh_services')->where('endpoint_id', (int) $binding->endpoint_id)->where('remote_service_name', $name)->where('id', '!=', (int) $binding->id)->exists()) {
            throw new InvalidArgumentException('OVH service is already linked to another binding.');
        }
        $path = $family === 'vps' ? '/vps/' . rawurlencode($name) : '/dedicated/server/' . rawurlencode($name);
        $remote = $this->client((int) $binding->endpoint_id)->get($path);
        Capsule::table('mod_cloudhost247_ovh_services')->where('id', (int) $binding->id)->update(array(
            'remote_service_name' => $name,
            'family' => $family,
            'status' => 'active',
            'details_json' => json_encode($remote),
            'last_synced_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        ));
        Capsule::table('mod_cloudhost247_ovh_operations')->where('whmcs_service_id', (int) $binding->whmcs_service_id)->where('operation', 'provision')->update(array(
            'status' => 'completed',
            'remote_id' => $name,
            'updated_at' => date('Y-m-d H:i:s'),
        ));
        Capsule::table('mod_cloudhost247_ovh_audit')->insert(array(
            'admin_id' => (int) $adminId,
            'action' => 'service.reconcile',
            'target_type' => 'ovh_service',
            'target_id' => (int) $binding->id,
            'before_json' => json_encode(array('status' => (string) $binding->status, 'remote_service_name' => (string) $binding->remote_service_name)),
            'after_json' => json_encode(array('order_id' => (string) $binding->remote_order_id, 'family' => $family, 'remote_service_name' => $name)),
            'created_at' => date('Y-m-d H:i:s'),
        ));
        return array('binding_id' => (int) $binding->id, 'remote_service_name' => $name, 'family' => $family, 'order_id' => (string) $binding->remote_order_id);
    }

    private function validate($name, $family)
    {
        if (!in_array($family, array('dedicated', 'vps'), true) || !preg_match('/^[A-Za-z0-9._-]{2,191}$/', (string) $name)) {
            throw new InvalidArgumentException('Invalid OVH service identity.');
        }
    }
}
