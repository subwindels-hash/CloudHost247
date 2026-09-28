<?php
/**
 * Provisioning bridge.
 *
 * Shared logic behind the four thin WHMCS provisioning modules
 * (phoneservices_numbers / _voip / _sms / _esim). Keeping the behaviour here
 * means the server modules stay a handful of lines each and every lifecycle
 * event is handled consistently, logged, and mirrored into the subscription
 * ledger used by billing and the admin UI.
 *
 * Every public method returns the literal string 'success' or a human readable
 * error message, which is exactly the contract WHMCS expects from a server
 * module function.
 *
 * @package PhoneServices
 */

namespace PhoneServices\Core;

use PhoneServices\Services\EsimService;
use PhoneServices\Services\NumberService;
use Throwable;

class Provisioning
{
    public const SERVICE_NUMBERS = 'number';
    public const SERVICE_VOIP    = 'voip';
    public const SERVICE_SMS     = 'sms';
    public const SERVICE_ESIM    = 'esim';

    private const SUBSCRIPTION_TABLE = 'mod_phoneservices_subscriptions';

    /**
     * Provision a service.
     *
     * @param array<string,mixed> $params WHMCS module params
     */
    public static function create(string $serviceType, array $params): string
    {
        return self::guard($serviceType, 'create', $params, static function (int $serviceId, int $userId, array $params) use ($serviceType) {
            $options = self::options($params);

            $subscriptionId = self::upsertSubscription($serviceType, $serviceId, $userId, [
                'plan_code'     => (string) ($options['plan'] ?? ''),
                'billing_cycle' => self::billingCycle((string) ($params['model']['billingcycle'] ?? 'Monthly')),
                'amount'        => (float) ($params['model']['amount'] ?? 0),
                'currency'      => (string) Config::get('currency', 'USD'),
                'status'        => 'active',
                'started_at'    => date('Y-m-d H:i:s'),
                'next_due_date' => (string) ($params['model']['nextduedate'] ?? date('Y-m-d', strtotime('+1 month'))),
            ]);

            // Auto-provision the underlying resource where the product carries
            // enough information to do so unattended. Anything else is left for
            // the client to order from the client area, which is the normal
            // flow for number/plan selection.
            if ($serviceType === self::SERVICE_NUMBERS && !empty($options['country'])) {
                $numbers = new NumberService();
                $candidates = $numbers->searchNumbers(
                    (string) $options['country'],
                    (string) ($options['type'] ?? 'local'),
                    ['limit' => 1]
                );

                $first = $candidates['numbers'][0] ?? ($candidates[0] ?? null);

                if (is_array($first) && !empty($first['number'])) {
                    $result = $numbers->purchaseNumber(
                        $userId,
                        (string) $first['number'],
                        (string) $options['country'],
                        (string) ($options['type'] ?? 'local')
                    );

                    if (!empty($result['error'])) {
                        throw new \RuntimeException((string) $result['error']);
                    }

                    if (!empty($result['id'])) {
                        $numbers->assignNumber((int) $result['id'], $serviceId);
                        Database::update(self::SUBSCRIPTION_TABLE, ['resource_id' => (int) $result['id']], ['id' => $subscriptionId]);
                    }
                }
            }

            if ($serviceType === self::SERVICE_ESIM && !empty($options['plan'])) {
                $result = (new EsimService())->purchasePlan($userId, (string) $options['plan'], ['service_id' => $serviceId]);

                if (!empty($result['error'])) {
                    throw new \RuntimeException((string) $result['error']);
                }

                if (!empty($result['id'])) {
                    Database::update(self::SUBSCRIPTION_TABLE, ['resource_id' => (int) $result['id']], ['id' => $subscriptionId]);
                }
            }

            return 'success';
        });
    }

    /**
     * @param array<string,mixed> $params
     */
    public static function suspend(string $serviceType, array $params): string
    {
        return self::guard($serviceType, 'suspend', $params, static function (int $serviceId, int $userId, array $params) use ($serviceType) {
            self::setSubscriptionStatus($serviceType, $serviceId, 'suspended');

            if ($serviceType === self::SERVICE_NUMBERS) {
                $numbers = new NumberService();

                foreach (Database::select('mod_phoneservices_numbers', 'id', ['assigned_service_id' => $serviceId, 'status' => 'active']) as $row) {
                    $numbers->suspendNumber((int) $row['id'], (string) ($params['suspendreason'] ?? 'Service suspended'));
                }
            }

            return 'success';
        });
    }

    /**
     * @param array<string,mixed> $params
     */
    public static function unsuspend(string $serviceType, array $params): string
    {
        return self::guard($serviceType, 'unsuspend', $params, static function (int $serviceId, int $userId, array $params) use ($serviceType) {
            self::setSubscriptionStatus($serviceType, $serviceId, 'active');

            if ($serviceType === self::SERVICE_NUMBERS) {
                $numbers = new NumberService();

                foreach (Database::select('mod_phoneservices_numbers', 'id', ['assigned_service_id' => $serviceId, 'status' => 'suspended']) as $row) {
                    $numbers->activateNumber((int) $row['id']);
                }
            }

            return 'success';
        });
    }

    /**
     * @param array<string,mixed> $params
     */
    public static function terminate(string $serviceType, array $params): string
    {
        return self::guard($serviceType, 'terminate', $params, static function (int $serviceId, int $userId, array $params) use ($serviceType) {
            self::setSubscriptionStatus($serviceType, $serviceId, 'cancelled');

            if ($serviceType === self::SERVICE_NUMBERS) {
                $numbers = new NumberService();

                foreach (Database::select('mod_phoneservices_numbers', 'id', ['assigned_service_id' => $serviceId]) as $row) {
                    $numbers->releaseNumber((int) $row['id']);
                }
            }

            if ($serviceType === self::SERVICE_ESIM) {
                $esims = new EsimService();

                foreach (self::subscriptionResources($serviceType, $serviceId) as $esimId) {
                    $esims->expireEsim($esimId);
                }
            }

            return 'success';
        });
    }

    /**
     * Data for the client area "overview" tab of a provisioned service.
     *
     * @param array<string,mixed> $params
     * @return array<string,mixed>
     */
    public static function clientAreaVariables(string $serviceType, array $params): array
    {
        $serviceId = (int) ($params['serviceid'] ?? 0);
        $userId = (int) ($params['userid'] ?? 0);

        $subscription = Database::row(self::SUBSCRIPTION_TABLE, '*', [
            'service_id'   => $serviceId,
            'service_type' => self::normaliseType($serviceType),
        ]);

        $variables = [
            'serviceType'   => $serviceType,
            'status'        => $subscription['status'] ?? 'pending',
            'portalUrl'     => 'index.php?m=phoneservices&action=' . self::portalAction($serviceType),
            'nextDueDate'   => $subscription['next_due_date'] ?? null,
            'planCode'      => $subscription['plan_code'] ?? null,
            'currency'      => (string) Config::get('currency', 'USD'),
        ];

        if ($serviceType === self::SERVICE_NUMBERS) {
            $variables['numbers'] = Database::select(
                'mod_phoneservices_numbers',
                '*',
                ['assigned_service_id' => $serviceId, 'user_id' => $userId]
            );
        }

        if ($serviceType === self::SERVICE_ESIM) {
            $variables['esims'] = Database::select('mod_phoneservices_esims', '*', ['user_id' => $userId]);
        }

        return $variables;
    }

    /**
     * Admin "Services" tab summary rows.
     *
     * @param array<string,mixed> $params
     * @return array<string,string>
     */
    public static function adminTabFields(string $serviceType, array $params): array
    {
        $serviceId = (int) ($params['serviceid'] ?? 0);

        $subscription = Database::row(self::SUBSCRIPTION_TABLE, '*', [
            'service_id'   => $serviceId,
            'service_type' => self::normaliseType($serviceType),
        ]);

        if (!$subscription) {
            return ['Phone Services' => 'No subscription record for this service.'];
        }

        return [
            'Subscription'  => '#' . (int) $subscription['id'] . ' (' . htmlspecialchars((string) $subscription['status'], ENT_QUOTES, 'UTF-8') . ')',
            'Plan'          => htmlspecialchars((string) ($subscription['plan_code'] ?: '—'), ENT_QUOTES, 'UTF-8'),
            'Billing cycle' => htmlspecialchars((string) $subscription['billing_cycle'], ENT_QUOTES, 'UTF-8'),
            'Next due'      => htmlspecialchars((string) ($subscription['next_due_date'] ?: '—'), ENT_QUOTES, 'UTF-8'),
        ];
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /**
     * Shared validation, logging and exception shielding for every action.
     *
     * @param array<string,mixed> $params
     */
    private static function guard(string $serviceType, string $action, array $params, callable $callback): string
    {
        $serviceId = (int) ($params['serviceid'] ?? 0);
        $userId = (int) ($params['userid'] ?? 0);

        try {
            if ($serviceId <= 0 || $userId <= 0) {
                return 'A valid WHMCS service and client context is required.';
            }

            if (!Config::isServiceEnabled(self::toggleFor($serviceType))) {
                return ucfirst($serviceType) . ' services are disabled in the Phone Services configuration.';
            }

            $result = $callback($serviceId, $userId, $params);

            Logger::info('Provisioning action completed', [
                'service_type' => $serviceType,
                'action'       => $action,
                'service_id'   => $serviceId,
            ]);

            return is_string($result) ? $result : 'success';
        } catch (Throwable $e) {
            Logger::exception($e, [
                'service_type' => $serviceType,
                'action'       => $action,
                'service_id'   => $serviceId,
            ]);

            return Config::isSandbox()
                ? $e->getMessage()
                : 'The operation could not be completed. See the Phone Services log for details.';
        }
    }

    /**
     * @param array<string,mixed> $data
     */
    private static function upsertSubscription(string $serviceType, int $serviceId, int $userId, array $data): int
    {
        $type = self::normaliseType($serviceType);
        $existing = Database::row(self::SUBSCRIPTION_TABLE, 'id', ['service_id' => $serviceId, 'service_type' => $type]);

        if ($existing) {
            Database::update(self::SUBSCRIPTION_TABLE, $data, ['id' => (int) $existing['id']]);

            return (int) $existing['id'];
        }

        return Database::insert(self::SUBSCRIPTION_TABLE, array_merge($data, [
            'user_id'      => $userId,
            'service_id'   => $serviceId,
            'service_type' => $type,
        ]));
    }

    private static function setSubscriptionStatus(string $serviceType, int $serviceId, string $status): void
    {
        $update = ['status' => $status];

        if ($status === 'cancelled') {
            $update['cancelled_at'] = date('Y-m-d H:i:s');
            $update['auto_renew'] = 0;
        }

        Database::update(self::SUBSCRIPTION_TABLE, $update, [
            'service_id'   => $serviceId,
            'service_type' => self::normaliseType($serviceType),
        ]);
    }

    /**
     * @return array<int,int>
     */
    private static function subscriptionResources(string $serviceType, int $serviceId): array
    {
        $rows = Database::select(self::SUBSCRIPTION_TABLE, 'resource_id', [
            'service_id'   => $serviceId,
            'service_type' => self::normaliseType($serviceType),
        ]);

        return array_values(array_filter(array_map(static function (array $row): int {
            return (int) $row['resource_id'];
        }, $rows)));
    }

    /**
     * Config options are positional in WHMCS; normalise them into names.
     *
     * @param array<string,mixed> $params
     * @return array<string,string>
     */
    private static function options(array $params): array
    {
        return [
            'country' => strtoupper(trim((string) ($params['configoption1'] ?? ''))),
            'type'    => strtolower(trim((string) ($params['configoption2'] ?? 'local'))) ?: 'local',
            'plan'    => trim((string) ($params['configoption3'] ?? '')),
            'quota'   => trim((string) ($params['configoption4'] ?? '')),
        ];
    }

    private static function billingCycle(string $whmcsCycle): string
    {
        $map = [
            'monthly'      => 'monthly',
            'quarterly'    => 'quarterly',
            'semiannually' => 'quarterly',
            'annually'     => 'annually',
            'biennially'   => 'annually',
            'triennially'  => 'annually',
            'onetime'      => 'onetime',
            'free account' => 'onetime',
        ];

        return $map[strtolower($whmcsCycle)] ?? 'monthly';
    }

    private static function normaliseType(string $serviceType): string
    {
        return $serviceType === self::SERVICE_NUMBERS ? 'number' : $serviceType;
    }

    private static function toggleFor(string $serviceType): string
    {
        $map = [
            self::SERVICE_NUMBERS => 'numbers',
            self::SERVICE_VOIP    => 'voip',
            self::SERVICE_SMS     => 'sms',
            self::SERVICE_ESIM    => 'esim',
        ];

        return $map[$serviceType] ?? $serviceType;
    }

    private static function portalAction(string $serviceType): string
    {
        $map = [
            self::SERVICE_NUMBERS => 'numbers',
            self::SERVICE_VOIP    => 'voip',
            self::SERVICE_SMS     => 'sms',
            self::SERVICE_ESIM    => 'esim',
        ];

        return $map[$serviceType] ?? 'dashboard';
    }
}
