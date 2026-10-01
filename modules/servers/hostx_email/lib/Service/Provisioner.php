<?php
/**
 * Provisioning workflow.
 *
 * Order of operations for every mutation (create, suspend, unsuspend,
 * terminate, password):
 *
 *   1. schema ready
 *   2. validate the WHMCS client / service / domain / plan
 *   3. validate provider configuration and permissions
 *   4. take a persistent per-service lock
 *   5. claim an idempotency key (replays short-circuit here)
 *   6. verify licence availability / mailbox capacity
 *   7. call the provider
 *   8. persist the remote id and state, or mark for reconciliation
 *   9. record the audit event
 *  10. return a WHMCS-shaped result
 *
 * An operation whose outcome is uncertain (timeout after the request was sent)
 * is NEVER retried automatically - the service is flagged and the reconciler
 * inspects the provider before anything else happens.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

namespace CloudHost247\Email\Service;

use CloudHost247\Email\Database\Migrator;
use CloudHost247\Email\Providers\ProviderFactory;
use CloudHost247\Email\Providers\ProviderInterface;
use CloudHost247\Email\Repository\AccountRepository;
use CloudHost247\Email\Repository\OperationRepository;
use CloudHost247\Email\Support\Config;
use CloudHost247\Email\Support\HttpClient;
use CloudHost247\Email\Support\Lock;
use CloudHost247\Email\Support\Logger;
use CloudHost247\Email\Support\Result;
use CloudHost247\Email\Support\Validator;
use WHMCS\Database\Capsule;

final class Provisioner
{
    /** @var Config */
    private $config;

    /** @var ProviderInterface */
    private $provider;

    public function __construct(Config $config, ?HttpClient $http = null, ?ProviderInterface $provider = null)
    {
        $this->config = $config;
        $this->provider = $provider ?: ProviderFactory::make($config, $http);
    }

    public function provider(): ProviderInterface
    {
        return $this->provider;
    }

    /* ==================================================================
     | Create
     * ================================================================= */

    /**
     * @return array<string,mixed>
     */
    public function create(): array
    {
        Migrator::ensureSchema();
        Logger::correlationId(true);

        $validated = $this->preflight('create');

        if (!Result::isOk($validated)) {
            return $validated;
        }

        $serviceId = $this->config->serviceId();
        $email = $this->config->mailboxAddress();
        $sku = $this->config->planSku();

        return Lock::withLock(Lock::serviceKey($serviceId), 180, function () use ($serviceId, $email, $sku) {
            $account = AccountRepository::ensure($serviceId, [
                'client_id' => $this->config->clientId(),
                'provider'  => $this->provider->key(),
                'email'     => $email,
                'domain'    => $this->config->domain(),
                'plan_tier' => $this->config->planTier(),
                'plan_sku'  => $sku,
            ]);

            // Already provisioned: this is the cheapest idempotency check.
            if ($account && !empty($account->remote_id) && $account->status !== AccountRepository::STATUS_TERMINATED) {
                Logger::info('create.already_provisioned', [
                    'service_id' => $serviceId,
                    'provider'   => $this->provider->key(),
                ]);

                return Result::ok(['remote_id' => $account->remote_id], 'The mailbox is already provisioned.');
            }

            if ($account && (int) $account->needs_reconcile === 1) {
                return Result::fail(
                    Result::CODE_CONFLICT,
                    'This service is awaiting reconciliation after an uncertain provider response and will not be '
                    . 'provisioned again automatically. Run the reconciler or inspect the provider first.'
                );
            }

            $claim = OperationRepository::begin($serviceId, $this->provider->key(), 'create', [
                'email' => $email,
                'sku'   => $sku,
            ]);

            if (!$claim['claimed']) {
                return $this->replayAnswer($claim, 'create');
            }

            // Licence / capacity check before anything is created.
            $availability = $this->provider->checkAvailability($sku);

            if (!Result::isOk($availability)) {
                OperationRepository::finish($claim['key'], $availability);
                AccountRepository::update($serviceId, ['status' => AccountRepository::STATUS_FAILED]);

                return $availability;
            }

            $password = $this->resolvePassword();

            if (!Result::isOk($password)) {
                OperationRepository::finish($claim['key'], $password);

                return $password;
            }

            $created = $this->provider->createAccount([
                'email'          => $email,
                'display_name'   => $this->config->displayName(),
                'password'       => $password['data']['password'],
                'sku'            => $sku,
                'usage_location' => $this->config->usageLocation(),
                'force_change'   => $this->config->forcePasswordChange(),
                'quota_mb'       => $this->config->storageGb() > 0 ? $this->config->storageGb() * 1024 : null,
                'reference'      => 'whmcs-service-' . $serviceId,
            ]);

            if (Result::isUncertain($created)) {
                OperationRepository::finish($claim['key'], $created);
                AccountRepository::markForReconciliation($serviceId, (string) $created['message']);

                return $created;
            }

            if (!Result::isOk($created)) {
                OperationRepository::finish($claim['key'], $created);
                AccountRepository::update($serviceId, [
                    'status'        => AccountRepository::STATUS_FAILED,
                    'license_state' => (string) ($created['data']['license_state'] ?? 'unknown'),
                    'remote_id'     => $created['data']['remote_id'] ?? null,
                ]);

                return $created;
            }

            $data = (array) $created['data'];

            AccountRepository::update($serviceId, [
                'remote_id'        => (string) ($data['remote_id'] ?? ''),
                'email'            => (string) ($data['email'] ?? $email),
                'status'           => AccountRepository::STATUS_ACTIVE,
                'remote_status'    => (string) ($data['status'] ?? 'active'),
                'license_state'    => (string) ($data['license_state'] ?? ($sku !== '' ? 'assigned' : 'n/a')),
                'storage_quota_mb' => isset($data['storage_quota_mb']) ? (int) $data['storage_quota_mb'] : null,
                'needs_reconcile'  => 0,
                'reconcile_reason' => null,
                'last_sync_at'     => date('Y-m-d H:i:s'),
                'last_sync_result' => 'created',
            ]);

            OperationRepository::finish($claim['key'], $created, (string) ($data['remote_id'] ?? ''));

            $this->persistGeneratedPassword($password['data']);

            // Best-effort DNS snapshot; never blocks provisioning.
            try {
                (new DnsService($this->config, $this->provider))->refresh($serviceId, $this->config->domain());
            } catch (\Throwable $e) {
                Logger::debug('create.dns_refresh_failed', ['service_id' => $serviceId, 'error' => $e->getMessage()]);
            }

            Logger::info('create.succeeded', [
                'service_id' => $serviceId,
                'provider'   => $this->provider->key(),
                'adopted'    => !empty($data['adopted']),
            ]);

            return Result::ok($data);
        });
    }

    /* ==================================================================
     | Lifecycle
     * ================================================================= */

    /**
     * @return array<string,mixed>
     */
    public function suspend(): array
    {
        return $this->lifecycle('suspend', 'suspend', AccountRepository::STATUS_SUSPENDED);
    }

    /**
     * @return array<string,mixed>
     */
    public function unsuspend(): array
    {
        return $this->lifecycle('unsuspend', 'unsuspend', AccountRepository::STATUS_ACTIVE);
    }

    /**
     * @return array<string,mixed>
     */
    public function terminate(): array
    {
        return $this->lifecycle('terminate', 'terminate', AccountRepository::STATUS_TERMINATED);
    }

    /**
     * Shared lifecycle path.
     *
     * @return array<string,mixed>
     */
    private function lifecycle(string $operation, string $capability, string $targetStatus): array
    {
        Migrator::ensureSchema();
        Logger::correlationId(true);

        $serviceId = $this->config->serviceId();

        if ($serviceId <= 0) {
            return Result::fail(Result::CODE_VALIDATION, 'The WHMCS service id is missing.');
        }

        $configured = $this->provider->validateConfiguration();

        if (!Result::isOk($configured)) {
            return $configured;
        }

        if (!$this->providerSupports($capability)) {
            return Result::fail(
                Result::CODE_NOT_SUPPORTED,
                sprintf('%s does not support %s through its API.', $this->provider->label(), $operation)
            );
        }

        $account = AccountRepository::find($serviceId);

        if (!$account || empty($account->remote_id)) {
            if ($operation === 'terminate') {
                // Nothing was ever created: termination is a no-op success.
                AccountRepository::update($serviceId, ['status' => AccountRepository::STATUS_TERMINATED]);

                return Result::ok([], 'No remote mailbox was provisioned for this service.');
            }

            return Result::fail(
                Result::CODE_NOT_FOUND,
                'No provisioned mailbox is recorded for this service. Create the account first.'
            );
        }

        return Lock::withLock(Lock::serviceKey($serviceId), 120, function () use ($account, $operation, $serviceId, $targetStatus) {
            $claim = OperationRepository::begin($serviceId, $this->provider->key(), $operation, [
                'remote_id' => (string) $account->remote_id,
            ]);

            if (!$claim['claimed']) {
                return $this->replayAnswer($claim, $operation);
            }

            $payload = $this->accountPayload($account);

            switch ($operation) {
                case 'suspend':
                    $result = $this->provider->suspendAccount($payload);
                    break;

                case 'unsuspend':
                    $result = $this->provider->unsuspendAccount($payload);
                    break;

                default:
                    $result = $this->provider->terminateAccount($payload);
                    break;
            }

            if (Result::isUncertain($result)) {
                OperationRepository::finish($claim['key'], $result);
                AccountRepository::markForReconciliation($serviceId, (string) $result['message']);

                return $result;
            }

            OperationRepository::finish($claim['key'], $result);

            if (!Result::isOk($result)) {
                return $result;
            }

            $update = [
                'status'           => $targetStatus,
                'last_sync_at'     => date('Y-m-d H:i:s'),
                'last_sync_result' => $operation,
            ];

            if ($operation === 'terminate') {
                $update['remote_id'] = null;
                $update['license_state'] = 'released';
            }

            AccountRepository::update($serviceId, $update);

            Logger::info($operation . '.succeeded', [
                'service_id' => $serviceId,
                'provider'   => $this->provider->key(),
            ]);

            return $result;
        });
    }

    /* ==================================================================
     | Password
     * ================================================================= */

    /**
     * Change the mailbox password.
     *
     * @param string $newPassword empty = use the password WHMCS already holds
     * @return array<string,mixed>
     */
    public function changePassword(string $newPassword = ''): array
    {
        Migrator::ensureSchema();
        Logger::correlationId(true);

        $serviceId = $this->config->serviceId();
        $configured = $this->provider->validateConfiguration();

        if (!Result::isOk($configured)) {
            return $configured;
        }

        if (!$this->providerSupports('change_password')) {
            return Result::fail(
                Result::CODE_NOT_SUPPORTED,
                sprintf('%s does not allow password changes through its API.', $this->provider->label())
            );
        }

        $account = AccountRepository::find($serviceId);

        if (!$account || empty($account->remote_id)) {
            return Result::fail(Result::CODE_NOT_FOUND, 'No provisioned mailbox is recorded for this service.');
        }

        $password = $newPassword !== '' ? $newPassword : $this->config->password();
        $check = Validator::checkPassword($password);

        if (!$check['valid']) {
            return Result::fail(Result::CODE_VALIDATION, $check['reason']);
        }

        return Lock::withLock(Lock::serviceKey($serviceId), 90, function () use ($account, $password, $serviceId) {
            // The idempotency key includes a hash of the password so that
            // setting the SAME password twice is a replay, while setting a
            // different one is a new operation. The password itself is never
            // stored - only an unkeyed digest used for comparison.
            $claim = OperationRepository::begin($serviceId, $this->provider->key(), 'change_password', [
                'remote_id' => (string) $account->remote_id,
                'digest'    => substr(hash('sha256', $password . '|' . $serviceId), 0, 32),
            ]);

            if (!$claim['claimed']) {
                return $this->replayAnswer($claim, 'change_password');
            }

            $result = $this->provider->changePassword(
                $this->accountPayload($account),
                $password,
                $this->config->forcePasswordChange()
            );

            if (Result::isUncertain($result)) {
                OperationRepository::finish($claim['key'], $result);
                AccountRepository::markForReconciliation($serviceId, (string) $result['message']);

                return $result;
            }

            OperationRepository::finish($claim['key'], $result);

            if (Result::isOk($result)) {
                AccountRepository::mergeMetadata($serviceId, ['password_changed_at' => date('c')]);

                Logger::info('change_password.succeeded', [
                    'service_id' => $serviceId,
                    'provider'   => $this->provider->key(),
                ]);
            }

            return $result;
        });
    }

    /* ==================================================================
     | Helpers
     * ================================================================= */

    /**
     * Validate everything that does not require a network call.
     *
     * @return array<string,mixed>
     */
    public function preflight(string $operation): array
    {
        $service = $this->config->validateService();

        if (!Result::isOk($service)) {
            return $service;
        }

        $configured = $this->provider->validateConfiguration();

        if (!Result::isOk($configured)) {
            return $configured;
        }

        if (!$this->providerSupports($operation)) {
            return Result::fail(
                Result::CODE_NOT_SUPPORTED,
                sprintf('%s does not support %s through its API.', $this->provider->label(), $operation)
            );
        }

        // Microsoft cannot license a user without a usage location.
        if ($this->provider->key() === Config::PROVIDER_MICROSOFT
            && $this->config->planSku() !== ''
            && $this->config->usageLocation() === '') {
            return Result::fail(
                Result::CODE_CONFIG,
                'Set the usage location (ISO country code) on the product before provisioning Microsoft 365.'
            );
        }

        return Result::ok();
    }

    private function providerSupports(string $capability): bool
    {
        $capabilities = $this->provider->capabilities();

        return !empty($capabilities[$capability]);
    }

    /**
     * @param  object $account
     * @return array<string,mixed>
     */
    private function accountPayload($account): array
    {
        return [
            'remote_id' => (string) ($account->remote_id ?? ''),
            'email'     => (string) ($account->email ?? ''),
            'domain'    => (string) ($account->domain ?? ''),
            'plan_sku'  => (string) ($account->plan_sku ?? ''),
        ];
    }

    /**
     * Use the password WHMCS holds for the service, or generate a compliant one.
     *
     * @return array<string,mixed> data: password, generated
     */
    private function resolvePassword(): array
    {
        $password = $this->config->password();

        if ($password !== '') {
            $check = Validator::checkPassword($password);

            if (!$check['valid']) {
                return Result::fail(
                    Result::CODE_VALIDATION,
                    'The password stored on the service does not meet the provider policy: ' . $check['reason']
                );
            }

            return Result::ok(['password' => $password, 'generated' => false]);
        }

        return Result::ok(['password' => Validator::generatePassword(18), 'generated' => true]);
    }

    /**
     * Store a generated password back onto the WHMCS service, encrypted by
     * WHMCS itself. Nothing is written to this module's tables or logs.
     *
     * @param array<string,mixed> $password
     */
    private function persistGeneratedPassword(array $password): void
    {
        if (empty($password['generated']) || !function_exists('encrypt')) {
            return;
        }

        try {
            Capsule::table('tblhosting')
                ->where('id', $this->config->serviceId())
                ->update(['password' => encrypt($password['password'])]);
        } catch (\Throwable $e) {
            Logger::warning('create.password_persist_failed', [
                'service_id' => $this->config->serviceId(),
                'error'      => $e->getMessage(),
            ]);
        }
    }

    /**
     * Answer for an operation that was already claimed elsewhere.
     *
     * @param  array{claimed:bool,state:string,row:object|null,key:string} $claim
     * @return array<string,mixed>
     */
    private function replayAnswer(array $claim, string $operation): array
    {
        if ($claim['state'] === OperationRepository::STATE_SUCCEEDED) {
            Logger::info($operation . '.replay_ignored', [
                'service_id' => $this->config->serviceId(),
                'provider'   => $this->provider->key(),
            ]);

            return Result::ok(
                ['replayed' => true, 'remote_id' => (string) ($claim['row']->remote_id ?? '')],
                'This operation has already been completed; the duplicate request was ignored.'
            );
        }

        if ($claim['state'] === OperationRepository::STATE_RECONCILE) {
            return Result::fail(
                Result::CODE_UNCERTAIN,
                'A previous attempt at this operation returned an uncertain result. It is queued for reconciliation '
                . 'and will not be repeated automatically.',
                [],
                true
            );
        }

        return Result::fail(
            Result::CODE_CONFLICT,
            'The same operation is already running for this service. Please wait for it to finish.'
        );
    }
}
