<?php
namespace CloudHost247\ModuleManager\Registry;

use WHMCS\Database\Capsule;

/**
 * What is actually using a module right now, counted from real WHMCS data.
 *
 * Before an administrator uninstalls a module we have to be able to answer
 * "who is still relying on this?" truthfully. Every number below comes from a
 * live query against WHMCS tables. Nothing is estimated and nothing is
 * fabricated: when a table cannot be read the row is reported as unknown so
 * the administrator is never shown a reassuring zero that was never measured.
 *
 * Only counts are collected. No customer name, domain, address or credential
 * is read, so the uninstall preview cannot leak customer data into logs.
 */
final class UsageCensus
{
    /** Service states that mean a customer is still relying on the module. */
    const LIVE_SERVICE_STATES = array('Active', 'Suspended', 'Pending');

    /** Domain states that mean a registrar module is still in use. */
    const LIVE_DOMAIN_STATES = array('Active', 'Pending', 'Pending Transfer', 'Grace', 'Redemption');

    /**
     * @param string $moduleId
     * @param string $moduleType
     * @return array array('rows' => array, 'live' => int|null, 'measured' => bool, 'unmeasured' => string[])
     */
    public function forModule($moduleId, $moduleType)
    {
        $moduleId = (string) $moduleId;
        $rows = array();

        switch ((string) $moduleType) {
            case 'server':
                $rows[] = $this->row('Server entries', 'tblservers', $this->count('tblservers', 'type', $moduleId), 'Setup → Products/Services → Servers');
                $rows[] = $this->row('Products using this module', 'tblproducts', $this->count('tblproducts', 'servertype', $moduleId), 'Setup → Products/Services');
                $rows[] = $this->row('Live customer services', 'tblhosting', $this->liveServices($moduleId), 'Active, suspended or pending services provisioned by this module', true);
                $rows[] = $this->row('Customers with those services', 'tblhosting', $this->liveServiceClients($moduleId), 'Distinct client accounts affected');
                break;
            case 'addon':
                $rows[] = $this->row('Activated in WHMCS', 'tbladdonmodules', $this->count('tbladdonmodules', 'module', $moduleId), 'Setup → Addon Modules', true);
                break;
            case 'gateway':
                $rows[] = $this->row('Activated payment gateway', 'tblpaymentgateways', $this->count('tblpaymentgateways', 'gateway', $moduleId), 'Setup → Payments → Payment Gateways', true);
                $rows[] = $this->row('Services billed through it', 'tblhosting', $this->count('tblhosting', 'paymentmethod', $moduleId), 'Services whose payment method is this gateway', true);
                $rows[] = $this->row('Unpaid invoices using it', 'tblinvoices', $this->count('tblinvoices', 'paymentmethod', $moduleId, array('status' => 'Unpaid')), 'Unpaid invoices that reference this gateway', true);
                break;
            case 'registrar':
                $rows[] = $this->row('Activated registrar', 'tblregistrars', $this->count('tblregistrars', 'registrar', $moduleId), 'Setup → Domain Registrars');
                $rows[] = $this->row('Live domains', 'tbldomains', $this->liveDomains($moduleId), 'Domains managed through this registrar', true);
                break;
            default:
                $rows[] = array(
                    'label' => 'Customer services',
                    'count' => 0,
                    'known' => true,
                    'detail' => 'This module type is not attached to products, services or domains.',
                    'blocking' => false,
                );
        }

        $live = 0;
        $measured = true;
        $unmeasured = array();
        foreach ($rows as $row) {
            if (!$row['known']) {
                $measured = false;
                $unmeasured[] = $row['label'];
                continue;
            }
            if ($row['blocking']) { $live += (int) $row['count']; }
        }

        return array(
            'rows' => $rows,
            'live' => $measured ? $live : null,
            'measured' => $measured,
            'unmeasured' => $unmeasured,
        );
    }

    /* ------------------------------------------------------------ queries */

    private function liveServices($moduleId)
    {
        return $this->guard(function () use ($moduleId) {
            return (int) Capsule::table('tblhosting')
                ->join('tblproducts', 'tblhosting.packageid', '=', 'tblproducts.id')
                ->where('tblproducts.servertype', $moduleId)
                ->whereIn('tblhosting.domainstatus', self::LIVE_SERVICE_STATES)
                ->count();
        }, array('tblhosting', 'tblproducts'));
    }

    private function liveServiceClients($moduleId)
    {
        return $this->guard(function () use ($moduleId) {
            return (int) Capsule::table('tblhosting')
                ->join('tblproducts', 'tblhosting.packageid', '=', 'tblproducts.id')
                ->where('tblproducts.servertype', $moduleId)
                ->whereIn('tblhosting.domainstatus', self::LIVE_SERVICE_STATES)
                ->distinct()
                ->count('tblhosting.userid');
        }, array('tblhosting', 'tblproducts'));
    }

    private function liveDomains($moduleId)
    {
        return $this->guard(function () use ($moduleId) {
            return (int) Capsule::table('tbldomains')
                ->where('registrar', $moduleId)
                ->whereIn('status', self::LIVE_DOMAIN_STATES)
                ->count();
        }, array('tbldomains'));
    }

    /**
     * Count rows of one fixed table matching a module id.
     *
     * Table and column names are constants of this class; only the module id
     * is variable and it is always bound as a parameter by the query builder.
     *
     * @return int|null null when the count could not be measured
     */
    private function count($table, $column, $moduleId, array $extra = array())
    {
        return $this->guard(function () use ($table, $column, $moduleId, $extra) {
            $query = Capsule::table($table)->where($column, $moduleId);
            foreach ($extra as $extraColumn => $value) {
                $query = $query->where($extraColumn, $value);
            }
            return (int) $query->count();
        }, array($table));
    }

    /**
     * Run a count, returning null instead of throwing when WHMCS or one of the
     * tables is not reachable. An unmeasured value is reported as unknown.
     *
     * @return int|null
     */
    private function guard($query, array $tables)
    {
        if (!class_exists('WHMCS\\Database\\Capsule')) { return null; }
        try {
            $schema = Capsule::schema();
            foreach ($tables as $table) {
                if (!$schema->hasTable($table)) { return null; }
            }
            return $query();
        } catch (\Throwable $unreachable) {
            return null;
        }
    }

    private function row($label, $table, $count, $detail, $blocking = false)
    {
        return array(
            'label' => $label,
            'count' => $count === null ? null : (int) $count,
            'known' => $count !== null,
            'detail' => $count === null
                ? 'Could not be measured: ' . $table . ' is not readable from here.'
                : $detail,
            'blocking' => (bool) $blocking,
        );
    }
}
