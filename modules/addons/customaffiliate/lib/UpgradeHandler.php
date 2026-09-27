<?php

/**
 * Custom Affiliate Commission - Upgrade/Downgrade Handler
 *
 * This file provides additional handling for package changes
 * that may not be fully captured by the AfterModuleUpgrade/Downgrade hooks.
 * It can be called manually or integrated into custom workflows.
 */

namespace CustomAffiliate;

use WHMCS\Database\Capsule;
use Exception;

class UpgradeHandler
{
    /** @var CommissionManager */
    private $manager;

    public function __construct()
    {
        $this->manager = new CommissionManager();
    }

    /**
     * Process a package change for an existing service
     *
     * @param int $serviceId
     * @param int $oldProductId
     * @param int $newProductId
     * @return array Result details
     */
    public function processPackageChange($serviceId, $oldProductId, $newProductId)
    {
        $oldIsHosting = $this->manager->isWebHostingProduct($oldProductId);
        $newIsHosting = $this->manager->isWebHostingProduct($newProductId);

        $result = [
            'service_id' => $serviceId,
            'old_product_id' => $oldProductId,
            'new_product_id' => $newProductId,
            'old_is_hosting' => $oldIsHosting,
            'new_is_hosting' => $newIsHosting,
            'action_taken' => 'none',
        ];

        if ($oldIsHosting && $newIsHosting) {
            // Stayed in hosting group - preserve first commission status
            $this->updateNotes($serviceId, "Product changed within hosting group: {$oldProductId} -> {$newProductId}");
            $result['action_taken'] = 'preserved';
            $result['message'] = 'First commission status preserved. Recurring commissions continue at configured rate.';
        } elseif ($oldIsHosting && !$newIsHosting) {
            // Moved out of hosting group
            $this->updateNotes($serviceId, "Product moved OUT of hosting group: {$oldProductId} -> {$newProductId}. Future commissions blocked.");
            $result['action_taken'] = 'blocked';
            $result['message'] = 'Product moved out of hosting group. Future commissions will not apply.';
        } elseif (!$oldIsHosting && $newIsHosting) {
            // Moved INTO hosting group - treat as new service for commission purposes
            $this->resetCommissionStatus($serviceId);
            $this->updateNotes($serviceId, "Product moved INTO hosting group: {$oldProductId} -> {$newProductId}. Commission tracking reset.");
            $result['action_taken'] = 'reset';
            $result['message'] = 'Product moved into hosting group. Next payment will be treated as first payment (50% commission).';
        } else {
            // Was not hosting, still not hosting - no change needed
            $result['action_taken'] = 'ignored';
            $result['message'] = 'Neither old nor new product is in hosting group. No commission impact.';
        }

        $this->manager->logDebug('UpgradeHandler processed package change', $result);
        return $result;
    }

    /**
     * Reset commission status for a service
     *
     * @param int $serviceId
     * @return void
     */
    private function resetCommissionStatus($serviceId)
    {
        try {
            Capsule::table('mod_customaffiliate_commissions')
                ->where('service_id', $serviceId)
                ->update([
                    'first_commission_paid' => false,
                    'first_commission_paid_at' => null,
                    'first_commission_invoice_id' => null,
                    'total_recurring_commission' => Capsule::raw('total_recurring_commission'),
                    'notes' => Capsule::raw("CONCAT(notes, ' | Commission tracking reset on " . date('Y-m-d H:i:s') . "')"),
                ]);
        } catch (Exception $e) {
            $this->manager->logDebug('Error resetting commission status', [
                'error' => $e->getMessage(),
                'service_id' => $serviceId,
            ]);
        }
    }

    /**
     * Update notes on commission record
     *
     * @param int $serviceId
     * @param string $note
     * @return void
     */
    private function updateNotes($serviceId, $note)
    {
        try {
            Capsule::table('mod_customaffiliate_commissions')
                ->where('service_id', $serviceId)
                ->update([
                    'notes' => Capsule::raw("CONCAT(notes, ' | " . addslashes($note) . "')"),
                ]);
        } catch (Exception $e) {
            $this->manager->logDebug('Error updating notes', [
                'error' => $e->getMessage(),
                'service_id' => $serviceId,
            ]);
        }
    }

    /**
     * Audit all services and fix commission records
     * Can be called periodically or after bulk product group changes
     *
     * @return array Statistics of fixes applied
     */
    public function auditAllServices()
    {
        $stats = [
            'checked' => 0,
            'fixed' => 0,
            'errors' => [],
        ];

        try {
            $records = Capsule::table('mod_customaffiliate_commissions')->get();

            foreach ($records as $record) {
                $stats['checked']++;
                $serviceId = $record->service_id;

                // Get current service product
                $service = Capsule::table('tblhosting')
                    ->where('id', $serviceId)
                    ->first();

                if (!$service) {
                    // Service no longer exists - mark record
                    $this->updateNotes($serviceId, "Service ID {$serviceId} no longer exists in tblhosting");
                    $stats['fixed']++;
                    continue;
                }

                // Verify product is still in hosting group
                if (!$this->manager->isWebHostingProduct($service->packageid)) {
                    $this->updateNotes($serviceId, "Audit: Product {$service->packageid} is not in hosting group. Future commissions blocked.");
                    $stats['fixed']++;
                }
            }
        } catch (Exception $e) {
            $stats['errors'][] = $e->getMessage();
        }

        $this->manager->logDebug('Audit completed', $stats);
        return $stats;
    }
}
