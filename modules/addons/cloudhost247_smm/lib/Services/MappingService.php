<?php
namespace CloudHost247\Smm\Services;

use CloudHost247\Smm\Repositories\ProviderRepository;
use CloudHost247\Smm\Support\Validator;
use RuntimeException;

/**
 * WHMCS product <-> provider service mapping management.
 *
 * Rules:
 *  - one WHMCS product maps to at most one provider service (unique index
 *    plus a pre-check with a friendly message);
 *  - the module NEVER creates or modifies WHMCS products or pricing — the
 *    administrator selects an existing product id;
 *  - deleting a mapping never touches existing orders (they carry snapshot
 *    columns) and never cancels anything at the provider.
 */
final class MappingService
{
    private $providers;

    public function __construct(ProviderRepository $providers)
    {
        $this->providers = $providers;
    }

    /**
     * @return array array('ok' => bool, 'message' => string, 'id' => int|null)
     */
    public function save(array $input, $adminId)
    {
        $id = (int) (isset($input['id']) ? $input['id'] : 0);
        $providerId = (int) (isset($input['provider_id']) ? $input['provider_id'] : 0);
        $serviceId = (int) (isset($input['service_id']) ? $input['service_id'] : 0);
        $productId = (int) (isset($input['product_id']) ? $input['product_id'] : 0);
        $name = trim((string) (isset($input['name']) ? $input['name'] : ''));
        $min = isset($input['min_quantity']) && $input['min_quantity'] !== '' ? (int) $input['min_quantity'] : null;
        $max = isset($input['max_quantity']) && $input['max_quantity'] !== '' ? (int) $input['max_quantity'] : null;
        $cost = isset($input['provider_cost']) && $input['provider_cost'] !== '' ? (string) $input['provider_cost'] : null;
        $sell = isset($input['sell_price']) && $input['sell_price'] !== '' ? (string) $input['sell_price'] : null;
        $currency = mb_substr(trim((string) (isset($input['currency']) ? $input['currency'] : '')), 0, 8);
        $enabled = !empty($input['enabled']) ? 1 : 0;

        if ($productId <= 0) {
            return array('ok' => false, 'message' => 'A WHMCS product must be selected. The module never creates products.');
        }
        if ($name === '' || mb_strlen($name) > 250) {
            return array('ok' => false, 'message' => 'A display name (max 250 characters) is required.');
        }
        $provider = $this->providers->find($providerId);
        if ($provider === null) {
            return array('ok' => false, 'message' => 'Provider not found.');
        }
        $service = $this->providers->findService($serviceId);
        if ($service === null || (int) $service->provider_id !== $providerId) {
            return array('ok' => false, 'message' => 'The selected service does not belong to the selected provider.');
        }
        try {
            $providerServiceId = Validator::providerServiceId((string) $service->provider_service_id);
        } catch (RuntimeException $e) {
            return array('ok' => false, 'message' => $e->getMessage());
        }
        if ($min !== null && $min < 1) {
            return array('ok' => false, 'message' => 'Minimum quantity must be at least 1.');
        }
        if ($max !== null && $max < 1) {
            return array('ok' => false, 'message' => 'Maximum quantity must be at least 1.');
        }
        if ($min !== null && $max !== null && $min > $max) {
            return array('ok' => false, 'message' => 'Minimum quantity cannot exceed maximum quantity.');
        }
        foreach (array('cost' => $cost, 'sell' => $sell) as $label => $value) {
            if ($value !== null && !is_numeric($value)) {
                return array('ok' => false, 'message' => ucfirst($label === 'cost' ? 'provider cost' : 'selling price') . ' must be a number.');
            }
        }
        if ($cost !== null && (float) $cost < 0) {
            return array('ok' => false, 'message' => 'Provider cost cannot be negative.');
        }
        if ($sell !== null && (float) $sell < 0) {
            return array('ok' => false, 'message' => 'Selling price cannot be negative.');
        }
        // Pre-check duplicates with a friendly message (the unique index is the hard guarantee).
        if ($this->providers->productHasOtherMapping($productId, $id)) {
            return array('ok' => false, 'message' => 'This WHMCS product is already mapped to another provider service. One product maps to exactly one provider service.');
        }

        $data = array(
            'provider_id' => $providerId,
            'service_id' => $serviceId,
            'product_id' => $productId,
            'provider_service_id' => $providerServiceId,
            'name' => $name,
            'min_quantity' => $min,
            'max_quantity' => $max,
            'provider_cost' => $cost !== null ? (float) $cost : null,
            'sell_price' => $sell !== null ? (float) $sell : null,
            'currency' => $currency !== '' ? $currency : (string) $service->currency,
            'enabled' => $enabled,
        );
        if ($data['provider_cost'] !== null && $data['sell_price'] !== null && (float) $data['sell_price'] < (float) $data['provider_cost']) {
            // Allowed, but margin goes negative — surface it in the margin field only.
            $data['margin_percent'] = null;
        } elseif ($data['provider_cost'] !== null && $data['sell_price'] !== null && (float) $data['provider_cost'] > 0) {
            $data['margin_percent'] = round((((float) $data['sell_price'] - (float) $data['provider_cost']) / (float) $data['provider_cost']) * 100, 2);
        } else {
            $data['margin_percent'] = null;
        }

        $existing = $id > 0 ? $this->providers->mappingById($id) : null;
        if ($id > 0 && $existing === null) {
            return array('ok' => false, 'message' => 'Mapping not found.');
        }
        if ($existing === null) {
            $newId = $this->providers->createMapping($data);
            \CloudHost247\Foundation\Support\AuditLogger::record('cloudhost247_smm', 'mapping.create', 'mapping', $newId, array(), $data, 'success', null, $adminId);
            return array('ok' => true, 'message' => 'Mapping created.', 'id' => $newId);
        }
        $this->providers->updateMapping($id, $data);
        \CloudHost247\Foundation\Support\AuditLogger::record('cloudhost247_smm', 'mapping.update', 'mapping', $id,
            array('product_id' => (int) $existing->product_id, 'service_id' => (int) $existing->service_id, 'enabled' => (int) $existing->enabled),
            $data, 'success', null, $adminId);
        return array('ok' => true, 'message' => 'Mapping updated.', 'id' => $id);
    }

    public function toggle($id, $enabled, $adminId)
    {
        $mapping = $this->providers->mappingById((int) $id);
        if ($mapping === null) {
            return array('ok' => false, 'message' => 'Mapping not found.');
        }
        $enabled = $enabled ? 1 : 0;
        $this->providers->updateMapping((int) $id, array('enabled' => $enabled));
        \CloudHost247\Foundation\Support\AuditLogger::record('cloudhost247_smm', 'mapping.toggle', 'mapping', (int) $id,
            array('enabled' => (int) $mapping->enabled), array('enabled' => $enabled), 'success', null, $adminId);
        return array('ok' => true, 'message' => $enabled ? 'Mapping enabled.' : 'Mapping disabled. New orders for the product will not submit until re-enabled.');
    }

    /** Deleting a mapping is always safe: orders keep snapshots. */
    public function delete($id, $confirm, $adminId)
    {
        $mapping = $this->providers->mappingById((int) $id);
        if ($mapping === null) {
            return array('ok' => false, 'message' => 'Mapping not found.');
        }
        if (!$confirm) {
            return array('ok' => false, 'message' => 'Deletion requires the confirmation checkbox.');
        }
        $this->providers->deleteMapping((int) $id);
        \CloudHost247\Foundation\Support\AuditLogger::record('cloudhost247_smm', 'mapping.delete', 'mapping', (int) $id,
            array('product_id' => (int) $mapping->product_id, 'service_id' => (int) $mapping->service_id), array(), 'success', null, $adminId);
        return array('ok' => true, 'message' => 'Mapping deleted. Existing orders are untouched.');
    }
}
