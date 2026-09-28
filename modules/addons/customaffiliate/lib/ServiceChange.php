<?php
/**
 * Upgrade / downgrade / package-change handling.
 *
 * A package change must never reset the commission state of a service: the
 * client is still the same client, and the service is still the same service,
 * so an upgrade invoice is a RECURRING payment, not a new first payment.
 *
 * This class keeps the ledger's product/group snapshot in step with reality and
 * records an audit note, so that:
 *
 *  - upgrading within the hosting group keeps earning the recurring rate;
 *  - moving a service out of the hosting group stops future commission (the
 *    group check in Rules does that automatically);
 *  - moving a service into the hosting group starts commission from the next
 *    payment, at the recurring rate for an existing customer.
 *
 * @package    WHMCS
 * @subpackage CustomAffiliate
 */

namespace CustomAffiliate;

use WHMCS\Database\Capsule;

class ServiceChange
{
    /**
     * Resolve a service id from whatever a WHMCS hook happened to provide.
     *
     * Different package-change hooks pass `upgradeid`, `serviceid` or a nested
     * `params` array; accepting all three keeps the handler robust across WHMCS
     * releases.
     *
     * @param array<string,mixed> $vars
     */
    public static function resolveServiceId(array $vars): int
    {
        if (!empty($vars['serviceid'])) {
            return (int) $vars['serviceid'];
        }

        if (!empty($vars['params']['serviceid'])) {
            return (int) $vars['params']['serviceid'];
        }

        if (!empty($vars['upgradeid'])) {
            try {
                $upgrade = Capsule::table('tblupgrades')->where('id', (int) $vars['upgradeid'])->first();
            } catch (\Throwable $e) {
                return 0;
            }

            if ($upgrade && in_array(strtolower((string) $upgrade->type), ['product', 'configoptions', 'package'], true)) {
                return (int) $upgrade->relid;
            }
        }

        return 0;
    }

    /**
     * Handle a package change for a service.
     *
     * @return array<string,mixed>
     */
    public static function handle(int $serviceId, string $event): array
    {
        $result = ['service_id' => $serviceId, 'event' => $event, 'action' => 'none'];

        if ($serviceId <= 0 || !Settings::isEnabled()) {
            return $result;
        }

        Catalog::clearCache();

        $service = Catalog::service($serviceId);

        if (!$service) {
            return $result;
        }

        $productId = (int) $service->packageid;
        $groupId = Catalog::productGroupId($productId);
        $commissionable = in_array($groupId, Settings::productGroupIds(), true);

        $referral = Affiliates::referralForService($serviceId);

        if (!$referral) {
            $result['action'] = 'not_referred';

            return $result;
        }

        $ledger = Ledger::find($serviceId, (int) $referral->affiliateid);

        if (!$ledger) {
            // No commission has ever been paid for this service; nothing to
            // preserve. The next paid invoice creates the ledger row.
            $result['action'] = $commissionable ? 'awaiting_first_payment' : 'not_commissionable';

            return $result;
        }

        $previousGroup = (int) $ledger->product_group_id;
        Ledger::syncProduct((int) $ledger->id, $productId, $groupId);

        if ($commissionable) {
            $note = sprintf(
                'Service %s (product %d, group %d). First-payment status preserved (%s).',
                $event,
                $productId,
                $groupId,
                $ledger->first_commission_paid ? 'already earned' : 'not yet earned'
            );
            $result['action'] = 'preserved';
        } elseif ($previousGroup !== $groupId) {
            $note = sprintf(
                'Service %s moved out of a commissionable group (product %d, group %d). Future commission suspended.',
                $event,
                $productId,
                $groupId
            );
            $result['action'] = 'suspended';
        } else {
            $note = sprintf('Service %s (product %d, group %d).', $event, $productId, $groupId);
            $result['action'] = 'noted';
        }

        Ledger::note((int) $ledger->id, $note);

        Logger::commission('service_change', $note, [
            'action'       => 'service_change',
            'service_id'   => $serviceId,
            'affiliate_id' => (int) $referral->affiliateid,
        ]);

        return $result;
    }
}
