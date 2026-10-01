<?php
/**
 * CloudHost247 Email Hosting - shared procedural helpers for the WHMCS entry points.
 *
 * Keeps the WHMCS entry point declarative: each WHMCS function is one line, and the
 * cross-cutting concerns (schema readiness, exception safety, WHMCS result
 * shaping, admin tab rendering) live here.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

require_once __DIR__ . '/bootstrap.php';

use CloudHost247\Email\Database\Migrator;
use CloudHost247\Email\Providers\ProviderFactory;
use CloudHost247\Email\Repository\AccountRepository;
use CloudHost247\Email\Repository\OperationRepository;
use CloudHost247\Email\Service\ClientAreaPresenter;
use CloudHost247\Email\Service\DnsService;
use CloudHost247\Email\Support\Config;
use CloudHost247\Email\Support\Logger;
use CloudHost247\Email\Support\Result;
use CloudHost247\Email\Service\Provisioner;

/**
 * Run a provisioning action with the standard safety net.
 *
 * WHMCS expects the literal string 'success', or an error message that it
 * displays and logs. An uncaught exception inside a provisioning module shows
 * a raw stack trace to an admin, so everything is wrapped.
 *
 * @param  array<string,mixed> $params
 * @param  callable            $callback fn(Provisioner, Config): array
 * @return string
 */
function hostx_email_run(string $action, array $params, callable $callback)
{
    $config = new Config($params);

    try {
        Migrator::ensureSchema();

        $provisioner = new Provisioner($config);
        $result = $callback($provisioner, $config);

        if (!is_array($result)) {
            $result = Result::fail(Result::CODE_REMOTE, 'The module returned an unexpected result.');
        }

        Logger::info(strtolower($action) . '.result', [
            'service_id' => $config->serviceId(),
            'provider'   => $config->provider(),
            'success'    => !empty($result['success']),
            'code'       => (string) ($result['code'] ?? ''),
        ]);

        return Result::toWhmcs($result);
    } catch (\Throwable $e) {
        Logger::error(strtolower($action) . '.exception', [
            'service_id' => $config->serviceId(),
            'provider'   => $config->provider(),
            'error'      => $e->getMessage(),
            'file'       => basename($e->getFile()) . ':' . $e->getLine(),
        ]);

        return 'The email provisioning module failed unexpectedly. Reference: ' . Logger::correlationId();
    }
}

/**
 * Licence swap on package change.
 *
 * @return array<string,mixed>
 */
function hostx_email_change_package(Provisioner $provisioner, Config $config)
{
    $provider = $provisioner->provider();
    $capabilities = $provider->capabilities();

    $account = AccountRepository::find($config->serviceId());

    if (!$account || empty($account->remote_id)) {
        return Result::fail(Result::CODE_NOT_FOUND, 'No provisioned mailbox is recorded for this service.');
    }

    $newSku = $config->planSku();
    $oldSku = (string) $account->plan_sku;

    if ($newSku === $oldSku) {
        AccountRepository::update($config->serviceId(), ['plan_tier' => $config->planTier()]);

        return Result::ok([], 'The plan changed but the provider SKU is unchanged; nothing to do remotely.');
    }

    if (empty($capabilities['assign_license'])) {
        AccountRepository::update($config->serviceId(), [
            'plan_tier' => $config->planTier(),
            'plan_sku'  => $newSku,
        ]);

        return Result::ok([], 'This provider has no licence API; the recorded plan was updated.');
    }

    $payload = [
        'remote_id' => (string) $account->remote_id,
        'email'     => (string) $account->email,
        'plan_sku'  => $oldSku,
    ];

    $assigned = $provider->assignLicense($payload, $newSku);

    if (!Result::isOk($assigned)) {
        return $assigned;
    }

    if ($oldSku !== '' && !empty($capabilities['remove_license'])) {
        $provider->removeLicense($payload, $oldSku);
    }

    AccountRepository::update($config->serviceId(), [
        'plan_tier'     => $config->planTier(),
        'plan_sku'      => $newSku,
        'license_state' => 'assigned',
    ]);

    return Result::ok([], 'Licence updated.');
}

/**
 * Client-area service page: handle the POST (if any), then render.
 *
 * @param  array<string,mixed> $params
 * @return array<string,mixed>
 */
function hostx_email_client_area(array $params)
{
    $config = new Config($params);

    try {
        Migrator::ensureSchema();

        $presenter = new ClientAreaPresenter($config);
        $notice = null;

        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST'
            && (!empty($_POST['ch247_email_action']) || !empty($_POST['hostx_email_action']))) {
            $notice = $presenter->handlePost($_POST);
        }

        return [
            'tabOverviewReplacementTemplate' => 'templates/overview',
            'templateVariables'              => $presenter->overview($notice),
        ];
    } catch (\Throwable $e) {
        Logger::error('clientarea.exception', [
            'service_id' => $config->serviceId(),
            'error'      => $e->getMessage(),
        ]);

        return [
            'tabOverviewReplacementTemplate' => 'templates/error',
            'templateVariables'              => [
                'message'       => 'This page is temporarily unavailable. Please try again shortly.',
                'correlationId' => Logger::correlationId(),
            ],
        ];
    }
}

/**
 * Admin service tab.
 *
 * @param  array<string,mixed> $params
 * @return array<string,string>
 */
function hostx_email_admin_tab_fields(array $params)
{
    $config = new Config($params);

    try {
        Migrator::ensureSchema();

        $account = AccountRepository::find($config->serviceId());
        $escape = static function ($value) {
            return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
        };

        if (!$account) {
            return [
                'Email provisioning' => '<span class="label label-default">Not provisioned</span> '
                    . $escape(ProviderFactory::label($config->provider())),
            ];
        }

        $state = '<strong>' . $escape(ucfirst((string) $account->status)) . '</strong>'
            . ' &middot; provider: ' . $escape(ProviderFactory::label((string) $account->provider))
            . ' &middot; licence: ' . $escape((string) $account->license_state);

        if ((int) $account->needs_reconcile === 1) {
            $state .= '<br><span class="label label-warning">Needs reconciliation</span> '
                . $escape((string) $account->reconcile_reason);
        }

        $sync = $account->last_sync_at
            ? $escape((string) $account->last_sync_at) . ' (' . $escape((string) $account->last_sync_result) . ')'
            : 'never';

        $operations = '';

        foreach (OperationRepository::forService($config->serviceId(), 6) as $operation) {
            $operations .= sprintf(
                '<div><code>%s</code> %s &middot; %s%s</div>',
                $escape((string) $operation->operation),
                $escape((string) $operation->state),
                $escape((string) $operation->updated_at),
                $operation->result_message ? ' &middot; ' . $escape(substr((string) $operation->result_message, 0, 120)) : ''
            );
        }

        return [
            'Email account'      => $escape((string) $account->email) . '<br><small class="text-muted">remote id: '
                . $escape($account->remote_id ? substr((string) $account->remote_id, 0, 48) : 'none') . '</small>',
            'Email provisioning' => $state,
            'DNS state'          => $escape(DnsService::stateLabel((string) $account->dns_state))
                . ($account->dns_checked_at ? ' <small class="text-muted">' . $escape((string) $account->dns_checked_at) . '</small>' : ''),
            'Last synchronised'  => $sync,
            'Recent operations'  => $operations !== '' ? $operations : '<span class="text-muted">none</span>',
        ];
    } catch (\Throwable $e) {
        Logger::error('admin_tab.exception', ['error' => $e->getMessage()]);

        return ['Email provisioning' => 'Unavailable (see the module log).'];
    }
}

/**
 * Generate a policy-compliant password (used by the admin "generate" helper and
 * by provisioning when WHMCS holds no password).
 */
function hostx_email_generate_password(int $length = 18): string
{
    return \CloudHost247\Email\Support\Validator::generatePassword($length);
}
