<?php
/**
 * Client-area view model and action handling.
 *
 * Guarantees:
 *   - the authenticated client must own the service (checked on every request,
 *     not just on render);
 *   - no provider API call happens during a plain page render - only in
 *     response to an explicit, CSRF-protected POST;
 *   - nothing sensitive reaches the template: no credentials, no service
 *     account JSON, no raw provider responses, no stack traces.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

namespace CloudHost247\Email\Service;

use CloudHost247\Email\Dns\RecordSet;
use CloudHost247\Email\Providers\ProviderFactory;
use CloudHost247\Email\Providers\ProviderInterface;
use CloudHost247\Email\Repository\AccountRepository;
use CloudHost247\Email\Support\Config;
use CloudHost247\Email\Support\Logger;
use CloudHost247\Email\Support\Result;
use CloudHost247\Email\Support\Validator;

final class ClientAreaPresenter
{
    /** @var Config */
    private $config;

    /** @var ProviderInterface */
    private $provider;

    public function __construct(Config $config, ?ProviderInterface $provider = null)
    {
        $this->config = $config;
        $this->provider = $provider ?: ProviderFactory::make($config);
    }

    /**
     * Build the template variables for the service overview.
     *
     * @return array<string,mixed>
     */
    public function overview(?array $notice = null): array
    {
        $serviceId = $this->config->serviceId();
        $clientId = $this->authenticatedClientId();

        if (!$this->ownsService($serviceId, $clientId)) {
            Logger::warning('clientarea.ownership_denied', [
                'service_id' => $serviceId,
                'client_id'  => $clientId,
            ]);

            return [
                'accessDenied' => true,
                'notice'       => [
                    'type'    => 'danger',
                    'message' => 'This service is not available on your account.',
                ],
            ];
        }

        $account = AccountRepository::find($serviceId);
        $dnsService = new DnsService($this->config, $this->provider);
        $records = $dnsService->stored($serviceId);
        $capabilities = $this->provider->capabilities();

        $status = $account ? (string) $account->status : 'pending';
        $storage = $this->storage($account);

        return [
            'accessDenied'     => false,
            'notice'           => $notice,
            'serviceId'        => $serviceId,
            'providerKey'      => $this->provider->key(),
            'providerLabel'    => $this->provider->label(),
            'planTier'         => ucfirst($this->config->planTier()),
            'planSku'          => $this->config->planSku(),
            'email'            => $account ? (string) $account->email : $this->config->mailboxAddress(),
            'domain'           => $account ? (string) $account->domain : $this->config->domain(),
            'status'           => $status,
            'statusLabel'      => $this->statusLabel($status),
            'statusClass'      => $this->statusClass($status),
            'remoteStatus'     => $account ? (string) $account->remote_status : '',
            'licenseState'     => $account ? (string) $account->license_state : 'unknown',
            'provisioned'      => (bool) ($account && $account->remote_id),
            'needsReconcile'   => (bool) ($account && (int) $account->needs_reconcile === 1),
            'storage'          => $storage,
            'lastSyncAt'       => $account && $account->last_sync_at ? (string) $account->last_sync_at : '',
            'lastSyncResult'   => $account ? (string) $account->last_sync_result : '',
            'dnsState'         => $account ? (string) $account->dns_state : DnsService::STATE_UNKNOWN,
            'dnsStateLabel'    => DnsService::stateLabel($account ? (string) $account->dns_state : DnsService::STATE_UNKNOWN),
            'dnsCheckedAt'     => $account && $account->dns_checked_at ? (string) $account->dns_checked_at : '',
            'dnsRecords'       => $this->renderRecords($records),
            'dnsCopyAll'       => $records->toClipboardAll(),
            'dnsSupported'     => !empty($capabilities['dns']),
            'loginUrl'         => $this->loginUrl($account),
            'loginLabel'       => $this->loginLabel(),
            'canChangePassword' => !empty($capabilities['change_password']),
            'canRefreshStatus' => !empty($capabilities['status']),
            'passwordPolicy'   => 'At least 12 characters, combining three of: lower case, upper case, digits, symbols.',
            'token'            => $this->csrfToken(),
            'moduleVersion'    => CH247_EMAIL_VERSION,
        ];
    }

    /**
     * Handle a client-area POST. Returns null when there is nothing to do.
     *
     * @param  array<string,mixed> $post
     * @return array{type:string,message:string}|null
     */
    public function handlePost(array $post): ?array
    {
        $submittedAction = $post['ch247_email_action'] ?? '';
        $action = Validator::oneOf($submittedAction, ['change_password', 'refresh_dns', 'refresh_status'], '');

        if ($action === '') {
            return null;
        }

        $serviceId = $this->config->serviceId();
        $clientId = $this->authenticatedClientId();

        if (!$this->ownsService($serviceId, $clientId)) {
            Logger::warning('clientarea.action_denied', ['service_id' => $serviceId, 'client_id' => $clientId]);

            return ['type' => 'danger', 'message' => 'This service is not available on your account.'];
        }

        if (!$this->verifyToken((string) ($post['token'] ?? ''))) {
            return ['type' => 'danger', 'message' => 'Your session has expired. Please reload the page and try again.'];
        }

        switch ($action) {
            case 'change_password':
                return $this->changePassword((string) ($post['new_password'] ?? ''), (string) ($post['confirm_password'] ?? ''));

            case 'refresh_dns':
                return $this->refreshDns();

            default:
                return $this->refreshStatus();
        }
    }

    /* ------------------------------------------------------------------
     | Actions
     * ----------------------------------------------------------------- */

    /**
     * @return array{type:string,message:string}
     */
    private function changePassword(string $password, string $confirmation): array
    {
        if ($password !== $confirmation) {
            return ['type' => 'danger', 'message' => 'The two passwords do not match.'];
        }

        $check = Validator::checkPassword($password);

        if (!$check['valid']) {
            return ['type' => 'danger', 'message' => $check['reason']];
        }

        $result = (new Provisioner($this->config, null, $this->provider))->changePassword($password);

        if (Result::isOk($result)) {
            return ['type' => 'success', 'message' => 'The mailbox password has been changed.'];
        }

        return ['type' => 'danger', 'message' => $this->safeMessage($result)];
    }

    /**
     * @return array{type:string,message:string}
     */
    private function refreshDns(): array
    {
        $result = (new DnsService($this->config, $this->provider))
            ->refresh($this->config->serviceId(), $this->config->domain());

        if (!Result::isOk($result)) {
            return ['type' => 'warning', 'message' => $this->safeMessage($result)];
        }

        // Independent confirmation, where the platform allows DNS lookups.
        $verification = (new DnsService($this->config, $this->provider))->verifyPublished($this->config->serviceId());

        if (Result::isOk($verification) && !empty($verification['data']['verified'])) {
            return ['type' => 'success', 'message' => 'DNS records refreshed and confirmed in your published zone.'];
        }

        return [
            'type'    => 'info',
            'message' => 'DNS records refreshed. They are not all visible in your published zone yet - '
                . 'add them at your DNS host and allow time for propagation.',
        ];
    }

    /**
     * @return array{type:string,message:string}
     */
    private function refreshStatus(): array
    {
        $result = (new Reconciler())->syncService($this->config->serviceId());

        if (Result::isOk($result)) {
            return ['type' => 'success', 'message' => 'Account status refreshed from the provider.'];
        }

        return ['type' => 'warning', 'message' => $this->safeMessage($result)];
    }

    /* ------------------------------------------------------------------
     | Helpers
     * ----------------------------------------------------------------- */

    /**
     * Only ever show the customer a curated message. Provider diagnostics stay
     * in the log, referenced by correlation id.
     *
     * @param array<string,mixed> $result
     */
    private function safeMessage(array $result): string
    {
        $code = (string) ($result['code'] ?? '');

        $customerSafe = [
            Result::CODE_VALIDATION,
            Result::CODE_NOT_SUPPORTED,
            Result::CODE_CONFLICT,
            Result::CODE_NOT_FOUND,
            Result::CODE_CAPACITY,
        ];

        if (in_array($code, $customerSafe, true)) {
            return (string) $result['message'];
        }

        Logger::error('clientarea.action_failed', [
            'service_id' => $this->config->serviceId(),
            'provider'   => $this->provider->key(),
            'code'       => $code,
            'message'    => (string) ($result['message'] ?? ''),
        ]);

        return 'We could not complete that request. Our team has been notified. Reference: ' . Logger::correlationId();
    }

    /**
     * @param  object|null $account
     * @return array<string,mixed>
     */
    private function storage($account): array
    {
        $used = $account && $account->storage_used_mb !== null ? (int) $account->storage_used_mb : null;
        $quota = $account && $account->storage_quota_mb !== null ? (int) $account->storage_quota_mb : null;

        if ($quota === null && $this->config->storageGb() > 0) {
            $quota = $this->config->storageGb() * 1024;
        }

        $percent = ($used !== null && $quota !== null && $quota > 0)
            ? min(100, (int) round(($used / $quota) * 100))
            : null;

        return [
            'reported'  => $used !== null,
            'used_mb'   => $used,
            'quota_mb'  => $quota,
            'used_label' => $used !== null ? $this->formatMb($used) : 'Not reported by the provider',
            'quota_label' => $quota !== null ? $this->formatMb($quota) : 'Not published',
            'percent'   => $percent,
        ];
    }

    private function formatMb(int $megabytes): string
    {
        if ($megabytes >= 1024) {
            return rtrim(rtrim(number_format($megabytes / 1024, 1), '0'), '.') . ' GB';
        }

        return $megabytes . ' MB';
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    private function renderRecords(RecordSet $records): array
    {
        $rows = [];

        foreach ($records->all() as $record) {
            $rows[] = $record + ['clipboard' => RecordSet::toClipboard($record)];
        }

        return $rows;
    }

    /**
     * @param object|null $account
     */
    private function loginUrl($account): string
    {
        $url = $this->provider->loginUrl([
            'email'  => $account ? (string) $account->email : '',
            'domain' => $account ? (string) $account->domain : $this->config->domain(),
        ]);

        return stripos($url, 'https://') === 0 ? $url : '';
    }

    private function loginLabel(): string
    {
        $labels = [
            Config::PROVIDER_MICROSOFT    => 'Open Outlook',
            Config::PROVIDER_GOOGLE       => 'Open Gmail',
            Config::PROVIDER_PROFESSIONAL => 'Open Webmail',
        ];

        return $labels[$this->provider->key()] ?? 'Open mailbox';
    }

    private function statusLabel(string $status): string
    {
        $labels = [
            AccountRepository::STATUS_ACTIVE     => 'Active',
            AccountRepository::STATUS_SUSPENDED  => 'Suspended',
            AccountRepository::STATUS_PENDING    => 'Awaiting provisioning',
            AccountRepository::STATUS_TERMINATED => 'Terminated',
            AccountRepository::STATUS_FAILED     => 'Provisioning failed',
            AccountRepository::STATUS_RECONCILE  => 'Being verified with the provider',
        ];

        return $labels[$status] ?? ucfirst($status);
    }

    private function statusClass(string $status): string
    {
        $classes = [
            AccountRepository::STATUS_ACTIVE     => 'success',
            AccountRepository::STATUS_SUSPENDED  => 'warning',
            AccountRepository::STATUS_PENDING    => 'info',
            AccountRepository::STATUS_TERMINATED => 'default',
            AccountRepository::STATUS_FAILED     => 'danger',
            AccountRepository::STATUS_RECONCILE  => 'warning',
        ];

        return $classes[$status] ?? 'default';
    }

    /**
     * The client id WHMCS authenticated for this request - never a value from
     * the request itself.
     */
    private function authenticatedClientId(): int
    {
        if (!empty($_SESSION['uid'])) {
            return (int) $_SESSION['uid'];
        }

        // Admin previewing a client service inside the admin area.
        if (!empty($_SESSION['adminid'])) {
            return $this->config->clientId();
        }

        return 0;
    }

    private function ownsService(int $serviceId, int $clientId): bool
    {
        if ($serviceId <= 0 || $clientId <= 0) {
            return false;
        }

        return AccountRepository::isOwnedBy($serviceId, $clientId);
    }

    private function csrfToken(): string
    {
        if (function_exists('generate_token')) {
            return (string) generate_token('plain');
        }

        if (empty($_SESSION['ch247_email_token'])) {
            $_SESSION['ch247_email_token'] = bin2hex(random_bytes(16));
        }

        return (string) $_SESSION['ch247_email_token'];
    }

    private function verifyToken(string $presented): bool
    {
        if ($presented === '') {
            return false;
        }

        return hash_equals($this->csrfToken(), $presented);
    }
}
