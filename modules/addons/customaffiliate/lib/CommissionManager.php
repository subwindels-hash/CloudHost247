<?php

/**
 * Custom Affiliate Commission Manager
 *
 * Core business logic for:
 * - Determining commission eligibility
 * - Calculating first vs recurring commissions
 * - Handling refunds and upgrades/downgrades
 * - Data persistence
 */

namespace CustomAffiliate;

use WHMCS\Database\Capsule;
use Exception;

class CommissionManager
{
    /** @var int Product group ID configured for web hosting */
    private $productGroupId;

    /** @var float First commission percentage */
    private $firstPercent;

    /** @var float Recurring commission percentage */
    private $recurringPercent;

    /** @var bool Debug logging enabled */
    private $debugLogging;

    /** @var array Cached module settings */
    private static $settings = null;

    /**
     * Constructor - load module settings
     */
    public function __construct()
    {
        $settings = $this->getModuleSettings();
        $this->productGroupId     = (int) ($settings['product_group_id'] ?? 0);
        $this->firstPercent       = (float) ($settings['first_commission_percent'] ?? 50);
        $this->recurringPercent   = (float) ($settings['recurring_commission_percent'] ?? 20);
        $this->debugLogging       = (bool) ($settings['enable_logging'] ?? true);
    }

    /**
     * Get module settings from database
     *
     * @return array
     */
    private function getModuleSettings()
    {
        if (self::$settings !== null) {
            return self::$settings;
        }

        try {
            $result = Capsule::table('tbladdonmodules')
                ->where('module', 'customaffiliate')
                ->pluck('value', 'setting');

            self::$settings = $result ? $result->toArray() : [];
        } catch (Exception $e) {
            self::$settings = [];
        }

        return self::$settings;
    }

    /**
     * Log debug message to WHMCS Activity Log if enabled
     *
     * @param string $message
     * @param array $data
     * @return void
     */
    public function logDebug($message, array $data = [])
    {
        if (!$this->debugLogging) {
            return;
        }

        $description = '[CustomAffiliate] ' . $message;
        if (!empty($data)) {
            $description .= ' | Data: ' . json_encode($data);
        }

        try {
            Capsule::table('tblactivitylog')->insert([
                'date'        => date('Y-m-d H:i:s'),
                'description' => $description,
                'user'        => 'System',
                'ipaddr'      => $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1',
            ]);
        } catch (Exception $e) {
            // Silently fail to avoid disrupting payment flow
        }
    }

    /**
     * Main entry point: Process invoice payment for affiliate commission
     *
     * @param int $invoiceId
     * @return bool|array Returns commission details or false if not applicable
     */
    public function processInvoicePaid($invoiceId)
    {
        $this->logDebug('Processing invoice payment', ['invoice_id' => $invoiceId]);

        // Validate basic requirements
        if (!$this->productGroupId) {
            $this->logDebug('Product group not configured - skipping');
            return false;
        }

        // Load invoice data
        $invoice = $this->getInvoiceData($invoiceId);
        if (!$invoice) {
            $this->logDebug('Invoice not found', ['invoice_id' => $invoiceId]);
            return false;
        }

        // Only process paid invoices
        if ($invoice['status'] !== 'Paid') {
            $this->logDebug('Invoice not paid - skipping', ['status' => $invoice['status']]);
            return false;
        }

        // Check if client has an affiliate referrer
        $affiliateId = $this->getClientAffiliate($invoice['userid']);
        if (!$affiliateId) {
            $this->logDebug('No affiliate referrer found', ['client_id' => $invoice['userid']]);
            return false;
        }

        $this->logDebug('Affiliate found', ['affiliate_id' => $affiliateId, 'client_id' => $invoice['userid']]);

        // Process each invoice item
        $commissions = [];
        foreach ($invoice['items'] as $item) {
            $commission = $this->processInvoiceItem($item, $invoice, $affiliateId);
            if ($commission) {
                $commissions[] = $commission;
            }
        }

        return !empty($commissions) ? $commissions : false;
    }

    /**
     * Process a single invoice item for commission
     *
     * @param array $item
     * @param array $invoice
     * @param int $affiliateId
     * @return array|false
     */
    private function processInvoiceItem(array $item, array $invoice, $affiliateId)
    {
        $serviceId = $this->extractServiceId($item);
        if (!$serviceId) {
            return false;
        }

        // Get service details
        $service = $this->getServiceData($serviceId);
        if (!$service) {
            $this->logDebug('Service not found', ['service_id' => $serviceId]);
            return false;
        }

        // Check if product is in the configured Web Hosting group
        $productGroupId = $this->getProductGroupId($service['packageid']);
        if ((int)$productGroupId !== (int)$this->productGroupId) {
            $this->logDebug('Product not in configured group - skipping', [
                'service_id' => $serviceId,
                'product_id' => $service['packageid'],
                'product_group' => $productGroupId,
                'configured_group' => $this->productGroupId,
            ]);
            return false;
        }

        // Determine if this is first payment or recurring
        $isFirstPayment = $this->isFirstPayment($serviceId, $affiliateId);
        $commissionPercent = $isFirstPayment ? $this->firstPercent : $this->recurringPercent;

        // Calculate commission amount
        $itemAmount = (float) $item['amount'];
        $commissionAmount = $this->calculateCommissionAmount($itemAmount, $commissionPercent);

        if ($commissionAmount <= 0) {
            $this->logDebug('Commission amount is zero - skipping', [
                'item_amount' => $itemAmount,
                'percent' => $commissionPercent,
            ]);
            return false;
        }

        $commissionType = $isFirstPayment ? 'first' : 'recurring';

        $this->logDebug('Commission calculated', [
            'service_id' => $serviceId,
            'type' => $commissionType,
            'percent' => $commissionPercent,
            'amount' => $commissionAmount,
            'item_amount' => $itemAmount,
        ]);

        return [
            'service_id'         => $serviceId,
            'affiliate_id'       => $affiliateId,
            'client_id'          => $invoice['userid'],
            'product_id'         => $service['packageid'],
            'invoice_id'         => $invoice['id'],
            'invoice_item_id'    => $item['id'],
            'commission_type'    => $commissionType,
            'commission_percent' => $commissionPercent,
            'commission_amount'  => $commissionAmount,
            'item_amount'        => $itemAmount,
            'is_first_payment'   => $isFirstPayment,
        ];
    }

    /**
     * Check if this is the first successful payment for this service/affiliate combo
     *
     * @param int $serviceId
     * @param int $affiliateId
     * @return bool True if first payment, false if recurring
     */
    public function isFirstPayment($serviceId, $affiliateId)
    {
        try {
            $record = Capsule::table('mod_customaffiliate_commissions')
                ->where('service_id', $serviceId)
                ->where('affiliate_id', $affiliateId)
                ->first();

            // If no record exists, this is the first payment
            if (!$record) {
                return true;
            }

            // If record exists but first commission not paid yet, this is first payment
            if (!$record->first_commission_paid) {
                return true;
            }

            return false;
        } catch (Exception $e) {
            $this->logDebug('Error checking first payment status', [
                'error' => $e->getMessage(),
                'service_id' => $serviceId,
                'affiliate_id' => $affiliateId,
            ]);
            // Conservative approach: assume first payment to avoid underpaying
            return true;
        }
    }

    /**
     * Record commission payment in custom table
     *
     * @param array $commissionData
     * @return bool
     */
    public function recordCommission(array $commissionData)
    {
        $serviceId   = $commissionData['service_id'];
        $affiliateId = $commissionData['affiliate_id'];

        try {
            $record = Capsule::table('mod_customaffiliate_commissions')
                ->where('service_id', $serviceId)
                ->where('affiliate_id', $affiliateId)
                ->first();

            if (!$record) {
                // Create new record
                Capsule::table('mod_customaffiliate_commissions')->insert([
                    'service_id'                => $serviceId,
                    'affiliate_id'              => $affiliateId,
                    'client_id'                 => $commissionData['client_id'],
                    'product_id'                => $commissionData['product_id'],
                    'first_commission_amount'   => $commissionData['commission_amount'],
                    'first_commission_paid'     => true,
                    'first_commission_invoice_id' => $commissionData['invoice_id'],
                    'first_commission_paid_at'  => date('Y-m-d H:i:s'),
                    'total_recurring_commission' => 0.00,
                    'recurring_count'           => 0,
                    'last_commission_at'        => date('Y-m-d H:i:s'),
                    'notes'                     => 'First commission recorded via InvoicePaid hook',
                ]);
            } else {
                // Update existing record for recurring
                Capsule::table('mod_customaffiliate_commissions')
                    ->where('id', $record->id)
                    ->update([
                        'total_recurring_commission' => Capsule::raw('total_recurring_commission + ' . $commissionData['commission_amount']),
                        'recurring_count'            => Capsule::raw('recurring_count + 1'),
                        'last_commission_at'         => date('Y-m-d H:i:s'),
                        'notes'                      => Capsule::raw("CONCAT(notes, ' | Recurring commission recorded: " . $commissionData['commission_amount'] . "')"),
                    ]);
            }

            // Log to activity table
            $this->logCommissionActivity($commissionData);

            return true;
        } catch (Exception $e) {
            $this->logDebug('Error recording commission', [
                'error' => $e->getMessage(),
                'data'  => $commissionData,
            ]);
            return false;
        }
    }

    /**
     * Apply affiliate commission override during AffiliateCommission hook
     *
     * @param array $params WHMCS hook parameters
     * @return float|false New commission amount or false to skip
     */
    public function handleAffiliateCommissionHook(array $params)
    {
        $this->logDebug('AffiliateCommission hook triggered', $params);

        // Get required parameters
        $affiliateId = $params['affiliateid'] ?? 0;
        $clientId    = $params['clientid'] ?? 0;
        $serviceId   = $params['serviceid'] ?? 0;
        $productId   = $params['productid'] ?? 0;
        $amount      = $params['amount'] ?? 0;
        $invoiceId   = $params['invoiceid'] ?? 0;

        if (!$serviceId || !$affiliateId) {
            $this->logDebug('Missing service_id or affiliate_id - using default commission');
            return false; // Use default WHMCS calculation
        }

        // Check if product is in configured group
        $productGroupId = $this->getProductGroupId($productId);
        if ((int)$productGroupId !== (int)$this->productGroupId) {
            $this->logDebug('Product not in web hosting group - zeroing commission', [
                'product_id' => $productId,
                'product_group' => $productGroupId,
                'configured_group' => $this->productGroupId,
            ]);
            return 0; // Zero commission for non-hosting products
        }

        // Determine commission type
        $isFirstPayment = $this->isFirstPayment($serviceId, $affiliateId);
        $commissionPercent = $isFirstPayment ? $this->firstPercent : $this->recurringPercent;
        $commissionAmount = $this->calculateCommissionAmount($amount, $commissionPercent);

        $this->logDebug('Commission hook override applied', [
            'service_id' => $serviceId,
            'is_first' => $isFirstPayment,
            'percent' => $commissionPercent,
            'original_amount' => $amount,
            'commission_amount' => $commissionAmount,
        ]);

        // Record in our tracking system
        $commissionData = [
            'service_id'         => $serviceId,
            'affiliate_id'       => $affiliateId,
            'client_id'          => $clientId,
            'product_id'         => $productId,
            'invoice_id'         => $invoiceId,
            'commission_type'    => $isFirstPayment ? 'first' : 'recurring',
            'commission_percent' => $commissionPercent,
            'commission_amount'  => $commissionAmount,
            'item_amount'        => $amount,
            'is_first_payment'   => $isFirstPayment,
        ];

        $this->recordCommission($commissionData);

        return $commissionAmount;
    }

    /**
     * Handle invoice refund - reverse commission
     *
     * @param int $invoiceId
     * @return bool
     */
    public function handleInvoiceRefund($invoiceId)
    {
        $this->logDebug('Processing refund for invoice', ['invoice_id' => $invoiceId]);

        try {
            // Find commission records linked to this invoice
            $records = Capsule::table('mod_customaffiliate_commissions')
                ->where('first_commission_invoice_id', $invoiceId)
                ->get();

            foreach ($records as $record) {
                // Mark first commission as refunded by resetting flag
                // Note: We reset first_commission_paid so if client repays, commission applies again
                Capsule::table('mod_customaffiliate_commissions')
                    ->where('id', $record->id)
                    ->update([
                        'first_commission_paid'    => false,
                        'first_commission_paid_at' => null,
                        'first_commission_invoice_id' => null,
                        'notes'                    => Capsule::raw("CONCAT(notes, ' | First commission refunded on " . date('Y-m-d H:i:s') . "')"),
                    ]);

                // Log the refund action
                Capsule::table('mod_customaffiliate_log')->insert([
                    'service_id'   => $record->service_id,
                    'affiliate_id' => $record->affiliate_id,
                    'invoice_id'   => $invoiceId,
                    'action'       => 'refund',
                    'amount'       => -$record->first_commission_amount,
                    'percentage'   => 0,
                    'description'  => 'First commission reversed due to refund',
                ]);

                $this->logDebug('First commission reversed for refund', [
                    'service_id' => $record->service_id,
                    'affiliate_id' => $record->affiliate_id,
                    'amount' => $record->first_commission_amount,
                ]);
            }

            return true;
        } catch (Exception $e) {
            $this->logDebug('Error processing refund', [
                'error' => $e->getMessage(),
                'invoice_id' => $invoiceId,
            ]);
            return false;
        }
    }

    /**
     * Handle service upgrade/downgrade
     *
     * @param int $serviceId
     * @param string $type 'upgrade' or 'downgrade'
     * @return void
     */
    public function handleServiceChange($serviceId, $type)
    {
        $this->logDebug('Processing service ' . $type, ['service_id' => $serviceId]);

        try {
            $service = $this->getServiceData($serviceId);
            if (!$service) {
                return;
            }

            // Check if new product is still in web hosting group
            $newGroupId = $this->getProductGroupId($service['packageid']);
            if ((int)$newGroupId !== (int)$this->productGroupId) {
                // Service moved out of web hosting group - we keep the record
                // but future commissions won't apply due to group check
                Capsule::table('mod_customaffiliate_commissions')
                    ->where('service_id', $serviceId)
                    ->update([
                        'notes' => Capsule::raw("CONCAT(notes, ' | Product changed to non-hosting on " . date('Y-m-d H:i:s') . "')"),
                    ]);
            } else {
                // Still in hosting group - maintain existing commission logic
                Capsule::table('mod_customaffiliate_commissions')
                    ->where('service_id', $serviceId)
                    ->update([
                        'notes' => Capsule::raw("CONCAT(notes, ' | Service " . $type . " on " . date('Y-m-d H:i:s') . "')"),
                    ]);
            }
        } catch (Exception $e) {
            $this->logDebug('Error processing service change', [
                'error' => $e->getMessage(),
                'service_id' => $serviceId,
                'type' => $type,
            ]);
        }
    }

    /**
     * Check if product ID belongs to configured web hosting group
     *
     * @param int $productId
     * @return bool
     */
    public function isWebHostingProduct($productId)
    {
        if (!$this->productGroupId) {
            return false;
        }

        $groupId = $this->getProductGroupId($productId);
        return (int)$groupId === (int)$this->productGroupId;
    }

    /**
     * Get product group ID for a product
     *
     * @param int $productId
     * @return int
     */
    public function getProductGroupId($productId)
    {
        try {
            $product = Capsule::table('tblproducts')
                ->where('id', $productId)
                ->first();

            return $product ? (int) $product->gid : 0;
        } catch (Exception $e) {
            return 0;
        }
    }

    /**
     * Get service ID from invoice item description
     *
     * @param array $item
     * @return int|false
     */
    private function extractServiceId(array $item)
    {
        // WHMCS stores service ID in the 'relid' field for product items
        if ($item['type'] === 'Hosting' && !empty($item['relid'])) {
            return (int) $item['relid'];
        }

        // Fallback: try to parse from description
        if (preg_match('/Service ID:\s*(\d+)/i', $item['description'] ?? '', $matches)) {
            return (int) $matches[1];
        }

        return false;
    }

    /**
     * Get full invoice data with items
     *
     * @param int $invoiceId
     * @return array|false
     */
    private function getInvoiceData($invoiceId)
    {
        try {
            $invoice = Capsule::table('tblinvoices')
                ->where('id', $invoiceId)
                ->first();

            if (!$invoice) {
                return false;
            }

            $items = Capsule::table('tblinvoiceitems')
                ->where('invoiceid', $invoiceId)
                ->get();

            return [
                'id'       => $invoice->id,
                'userid'   => $invoice->userid,
                'status'   => $invoice->status,
                'total'    => $invoice->total,
                'items'    => json_decode(json_encode($items), true),
            ];
        } catch (Exception $e) {
            return false;
        }
    }

    /**
     * Get service data
     *
     * @param int $serviceId
     * @return array|false
     */
    private function getServiceData($serviceId)
    {
        try {
            $service = Capsule::table('tblhosting')
                ->where('id', $serviceId)
                ->first();

            if (!$service) {
                return false;
            }

            return [
                'id'         => $service->id,
                'userid'     => $service->userid,
                'packageid'  => $service->packageid,
                'domain'     => $service->domain,
                'status'     => $service->domainstatus,
            ];
        } catch (Exception $e) {
            return false;
        }
    }

    /**
     * Get affiliate ID for a client (the referring affiliate)
     *
     * @param int $clientId
     * @return int|false
     */
    private function getClientAffiliate($clientId)
    {
        try {
            // Check if client was referred by an affiliate via affiliate ID stored on client record
            $client = Capsule::table('tblclients')
                ->where('id', $clientId)
                ->first();

            if ($client && !empty($client->affiliateid)) {
                return (int) $client->affiliateid;
            }

            // Alternative: Check if there's an active affiliate relationship via tblaffiliates
            $affiliate = Capsule::table('tblaffiliates')
                ->where('clientid', $clientId)
                ->first();

            if ($affiliate) {
                return (int) $affiliate->id;
            }

            return false;
        } catch (Exception $e) {
            return false;
        }
    }

    /**
     * Calculate commission amount from percentage
     *
     * @param float $amount
     * @param float $percent
     * @return float
     */
    private function calculateCommissionAmount($amount, $percent)
    {
        if ($amount <= 0 || $percent <= 0) {
            return 0.00;
        }

        return round(($amount * $percent) / 100, 2);
    }

    /**
     * Log commission activity to audit table
     *
     * @param array $commissionData
     * @return void
     */
    private function logCommissionActivity(array $commissionData)
    {
        try {
            Capsule::table('mod_customaffiliate_log')->insert([
                'service_id'   => $commissionData['service_id'],
                'affiliate_id' => $commissionData['affiliate_id'],
                'invoice_id'   => $commissionData['invoice_id'] ?? null,
                'action'       => $commissionData['commission_type'] . '_commission',
                'amount'       => $commissionData['commission_amount'],
                'percentage'   => $commissionData['commission_percent'],
                'description'  => sprintf(
                    '%s commission of $%s (%s%%) on $%s for service %s',
                    ucfirst($commissionData['commission_type']),
                    number_format($commissionData['commission_amount'], 2),
                    $commissionData['commission_percent'],
                    number_format($commissionData['item_amount'], 2),
                    $commissionData['service_id']
                ),
            ]);
        } catch (Exception $e) {
            // Silently fail
        }
    }

    /**
     * Check for duplicate commission payment (prevention)
     *
     * @param int $invoiceId
     * @param int $serviceId
     * @param int $affiliateId
     * @return bool True if duplicate detected
     */
    public function isDuplicateCommission($invoiceId, $serviceId, $affiliateId)
    {
        try {
            $exists = Capsule::table('mod_customaffiliate_log')
                ->where('invoice_id', $invoiceId)
                ->where('service_id', $serviceId)
                ->where('affiliate_id', $affiliateId)
                ->where('action', 'like', '%_commission')
                ->exists();

            return $exists;
        } catch (Exception $e) {
            return false;
        }
    }

    /**
     * Get configured product group ID
     *
     * @return int
     */
    public function getConfiguredGroupId()
    {
        return (int) $this->productGroupId;
    }

    /**
     * Get first commission percentage
     *
     * @return float
     */
    public function getFirstPercent()
    {
        return (float) $this->firstPercent;
    }

    /**
     * Get recurring commission percentage
     *
     * @return float
     */
    public function getRecurringPercent()
    {
        return (float) $this->recurringPercent;
    }
}
