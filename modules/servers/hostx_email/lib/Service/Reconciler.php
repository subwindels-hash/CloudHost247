<?php
/**
 * Bounded background work: status synchronisation and reconciliation.
 *
 * Invoked from the WHMCS cron (hooks.php -> DailyCronJob) and from cron.php for
 * more frequent runs. Never from page rendering.
 *
 * Reconciliation answers one question: "an operation returned an uncertain
 * result - what does the provider actually say?" It repairs local state from
 * the remote truth instead of retrying a mutation that may already have been
 * applied.
 *
 * @package    WHMCS
 * @subpackage hostx_email
 */

namespace HostxEmail\Service;

use HostxEmail\Database\Migrator;
use HostxEmail\Providers\ProviderFactory;
use HostxEmail\Repository\AccountRepository;
use HostxEmail\Repository\OperationRepository;
use HostxEmail\Support\Config;
use HostxEmail\Support\HttpClient;
use HostxEmail\Support\Lock;
use HostxEmail\Support\Logger;
use HostxEmail\Support\Result;
use WHMCS\Database\Capsule;

final class Reconciler
{
    /** @var HttpClient|null */
    private $http;

    public function __construct(?HttpClient $http = null)
    {
        $this->http = $http;
    }

    /**
     * One bounded pass: sweep stalled operations, reconcile uncertain services,
     * then refresh a batch of statuses.
     *
     * @return array<string,int>
     */
    public function run(int $syncBatch = 25, int $reconcileBatch = 10, int $staleMinutes = 360): array
    {
        Migrator::ensureSchema();

        $summary = ['stalled' => 0, 'reconciled' => 0, 'synced' => 0, 'skipped' => 0, 'errors' => 0];

        if (!Lock::acquire('cron:reconciler', 900)) {
            Logger::info('cron.skipped_locked');
            $summary['skipped'] = 1;

            return $summary;
        }

        try {
            $summary['stalled'] = OperationRepository::sweepStale(30);

            foreach (AccountRepository::needingReconciliation($reconcileBatch) as $account) {
                $outcome = $this->reconcile((int) $account->service_id);
                $summary[Result::isOk($outcome) ? 'reconciled' : 'errors']++;
            }

            foreach (AccountRepository::dueForSync($syncBatch, $staleMinutes) as $account) {
                $outcome = $this->syncService((int) $account->service_id);
                $summary[Result::isOk($outcome) ? 'synced' : 'errors']++;
            }
        } finally {
            Lock::release('cron:reconciler');
        }

        Logger::info('cron.completed', $summary);

        return $summary;
    }

    /**
     * Reconcile a single service against the provider.
     *
     * @return array<string,mixed>
     */
    public function reconcile(int $serviceId): array
    {
        $context = $this->context($serviceId);

        if (!Result::isOk($context)) {
            return $context;
        }

        /** @var Config $config */
        $config = $context['data']['config'];
        $account = $context['data']['account'];
        $provider = ProviderFactory::make($config, $this->http);

        $capabilities = $provider->capabilities();

        if (empty($capabilities['status'])) {
            return Result::fail(Result::CODE_NOT_SUPPORTED, 'Status lookup is not supported by this provider.');
        }

        $email = (string) $account->email;
        $remoteId = (string) $account->remote_id;

        // With no remote id the uncertain operation was a create: look the
        // mailbox up by address instead of creating a second one.
        if ($remoteId === '' && !empty($capabilities['find_by_email']) && $email !== '') {
            $found = $provider->findByEmail($email);

            if (Result::isOk($found)) {
                AccountRepository::update($serviceId, [
                    'remote_id'     => (string) ($found['data']['remote_id'] ?? ''),
                    'remote_status' => (string) ($found['data']['status'] ?? ''),
                    'status'        => ($found['data']['status'] ?? '') === 'suspended'
                        ? AccountRepository::STATUS_SUSPENDED
                        : AccountRepository::STATUS_ACTIVE,
                ]);

                AccountRepository::clearReconciliation(
                    $serviceId,
                    ($found['data']['status'] ?? '') === 'suspended'
                        ? AccountRepository::STATUS_SUSPENDED
                        : AccountRepository::STATUS_ACTIVE
                );

                Logger::info('reconcile.adopted_remote_account', [
                    'service_id' => $serviceId,
                    'provider'   => $provider->key(),
                ]);

                return Result::ok(['action' => 'adopted']);
            }

            if (($found['code'] ?? '') === Result::CODE_NOT_FOUND) {
                // The uncertain create never landed: it is safe to retry now.
                AccountRepository::clearReconciliation($serviceId, AccountRepository::STATUS_PENDING);

                Logger::info('reconcile.no_remote_account', [
                    'service_id' => $serviceId,
                    'provider'   => $provider->key(),
                ]);

                return Result::ok(['action' => 'cleared_for_retry']);
            }

            return $found;
        }

        return $this->syncService($serviceId);
    }

    /**
     * Refresh one service's status from the provider.
     *
     * @return array<string,mixed>
     */
    public function syncService(int $serviceId): array
    {
        $context = $this->context($serviceId);

        if (!Result::isOk($context)) {
            return $context;
        }

        /** @var Config $config */
        $config = $context['data']['config'];
        $account = $context['data']['account'];
        $provider = ProviderFactory::make($config, $this->http);

        if (empty($provider->capabilities()['status'])) {
            return Result::fail(Result::CODE_NOT_SUPPORTED, 'Status lookup is not supported by this provider.');
        }

        if (empty($account->remote_id)) {
            return Result::fail(Result::CODE_NOT_FOUND, 'No remote account is recorded.');
        }

        $status = $provider->getStatus([
            'remote_id' => (string) $account->remote_id,
            'email'     => (string) $account->email,
            'domain'    => (string) $account->domain,
        ]);

        if (!Result::isOk($status)) {
            AccountRepository::update($serviceId, [
                'last_sync_at'     => date('Y-m-d H:i:s'),
                'last_sync_result' => 'error',
            ]);

            return $status;
        }

        $data = (array) $status['data'];

        if (empty($data['exists'])) {
            AccountRepository::update($serviceId, [
                'status'           => AccountRepository::STATUS_RECONCILE,
                'needs_reconcile'  => 1,
                'reconcile_reason' => 'The provider no longer has this account.',
                'last_sync_at'     => date('Y-m-d H:i:s'),
                'last_sync_result' => 'missing',
            ]);

            Logger::warning('sync.remote_missing', ['service_id' => $serviceId, 'provider' => $provider->key()]);

            return Result::ok(['action' => 'flagged_missing']);
        }

        AccountRepository::update($serviceId, [
            'remote_status'    => (string) ($data['status'] ?? ''),
            'status'           => ($data['status'] ?? '') === 'suspended'
                ? AccountRepository::STATUS_SUSPENDED
                : AccountRepository::STATUS_ACTIVE,
            'license_state'    => (string) ($data['license_state'] ?? 'unknown'),
            'storage_used_mb'  => isset($data['storage_used_mb']) ? (int) $data['storage_used_mb'] : null,
            'storage_quota_mb' => isset($data['storage_quota_mb']) ? (int) $data['storage_quota_mb'] : null,
            'needs_reconcile'  => 0,
            'reconcile_reason' => null,
            'last_sync_at'     => date('Y-m-d H:i:s'),
            'last_sync_result' => 'synced',
        ]);

        return Result::ok(['action' => 'synced']);
    }

    /**
     * Rebuild the WHMCS $params-equivalent context for a stored service.
     *
     * @return array<string,mixed> Result; data.config, data.account
     */
    private function context(int $serviceId): array
    {
        $account = AccountRepository::find($serviceId);

        if (!$account) {
            return Result::fail(Result::CODE_NOT_FOUND, 'No account row for service ' . $serviceId . '.');
        }

        try {
            $service = Capsule::table('tblhosting')->where('id', $serviceId)->first();

            if (!$service) {
                return Result::fail(Result::CODE_NOT_FOUND, 'WHMCS service ' . $serviceId . ' no longer exists.');
            }

            $product = Capsule::table('tblproducts')->where('id', (int) $service->packageid)->first();
            $server = Capsule::table('tblservers')->where('id', (int) $service->server)->first();
        } catch (\Throwable $e) {
            return Result::fail(Result::CODE_REMOTE, 'Could not load the WHMCS service: ' . $e->getMessage());
        }

        if (!$product || !$server) {
            return Result::fail(
                Result::CODE_CONFIG,
                'Service ' . $serviceId . ' has no product or no assigned server; background sync skipped.'
            );
        }

        $params = [
            'serviceid'        => $serviceId,
            'userid'           => (int) $service->userid,
            'pid'              => (int) $service->packageid,
            'domain'           => (string) $service->domain,
            'username'         => (string) $service->username,
            'serverhostname'   => (string) $server->hostname,
            'serverusername'   => (string) $server->username,
            'serverpassword'   => self::decryptServerField((string) $server->password),
            'serveraccesshash' => self::decryptServerField((string) $server->accesshash),
        ];

        foreach (Config::CONFIG_OPTIONS as $index => $name) {
            $params['configoption' . $index] = (string) ($product->{'configoption' . $index} ?? '');
        }

        return Result::ok(['config' => new Config($params), 'account' => $account]);
    }

    /**
     * WHMCS stores server credentials encrypted; decrypt() is provided by the
     * WHMCS runtime. Outside it (tests) the value is returned untouched.
     */
    public static function decryptServerField(string $value): string
    {
        if ($value === '') {
            return '';
        }

        if (function_exists('decrypt')) {
            try {
                $plain = decrypt($value);

                return is_string($plain) && $plain !== '' ? $plain : $value;
            } catch (\Throwable $e) {
                return '';
            }
        }

        return $value;
    }
}
