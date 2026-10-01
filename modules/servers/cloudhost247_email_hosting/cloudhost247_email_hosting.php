<?php
/**
 * CloudHost247 Email Hosting provisioning module for WHMCS.
 *
 * A WHMCS SERVER (provisioning) module - not an addon - supporting three
 * independent provider adapters behind one contract:
 *
 *   professional   Professional Business Email (configurable provisioning API)
 *   microsoft365   Microsoft Graph (OAuth 2.0 client credentials)
 *   google         Google Workspace (Admin SDK + Licensing, service account)
 *
 * Target: WHMCS 8.9.x, PHP 7.4+.
 *
 * Every entry point is a thin wrapper: validation, locking, idempotency,
 * reconciliation and logging live in lib/. See README.md for installation and
 * the provider permission matrix.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 * @author     CloudHost247
 * @version    1.0.0
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/functions.php';

use CloudHost247\Email\Providers\ProviderFactory;
use CloudHost247\Email\Support\Config;

/**
 * Module metadata.
 *
 * RequiresServer is true: provider credentials belong in a WHMCS server profile
 * so they are encrypted at rest and never stored by this module.
 *
 * @return array<string,mixed>
 */
function cloudhost247_email_hosting_MetaData()
{
    return [
        'DisplayName'               => 'CloudHost247 Email Hosting',
        'APIVersion'                => '1.1',
        'RequiresServer'            => true,
        'DefaultNonSSLPort'         => '443',
        'DefaultSSLPort'            => '443',
        'ServiceSingleSignOnLabel'  => 'Open mailbox',
        'AdminSingleSignOnLabel'    => '',
        'ListAccountsUniqueIdentifierField' => 'domain',
    ];
}

/**
 * Product configuration options.
 *
 * The numbering is fixed by the module configuration options class. do not
 * reorder without migrating existing products.
 *
 * @return array<string,array<string,mixed>>
 */
function cloudhost247_email_hosting_ConfigOptions()
{
    return [
        'Email provider' => [
            'Type'        => 'dropdown',
            'Options'     => ProviderFactory::options(),
            'Default'     => Config::PROVIDER_PROFESSIONAL,
            'Description' => 'Which platform provisions this product. Credentials come from the assigned server.',
        ],
        'Plan tier' => [
            'Type'        => 'dropdown',
            'Options'     => ['basic' => 'Basic', 'standard' => 'Standard', 'premium' => 'Premium'],
            'Default'     => 'standard',
            'Description' => 'Marketing tier shown on the public email hosting page.',
        ],
        'Provider SKU / plan id' => [
            'Type'        => 'text',
            'Size'        => '60',
            'Description' => 'Microsoft: subscribed SKU GUID or part number (e.g. O365_BUSINESS_PREMIUM). '
                . 'Google: licence SKU id (e.g. 1010020027). Professional Email: plan id. '
                . 'Leave blank for platforms with no licence concept.',
        ],
        'Mailboxes included' => [
            'Type'        => 'text',
            'Size'        => '6',
            'Default'     => '1',
            'Description' => 'Informational: how many mailboxes this product covers.',
        ],
        'Storage per mailbox (GB)' => [
            'Type'        => 'text',
            'Size'        => '6',
            'Default'     => '',
            'Description' => 'Verified allowance for display. Leave blank to show "not published" rather than a guess.',
        ],
        'Usage location (ISO country)' => [
            'Type'        => 'text',
            'Size'        => '4',
            'Default'     => '',
            'Description' => 'Required by Microsoft before a licence can be assigned (e.g. NG, GB, US).',
        ],
        'Webmail / login URL override' => [
            'Type'        => 'text',
            'Size'        => '60',
            'Description' => 'HTTPS URL for the Professional Email webmail button. Microsoft and Google use their own.',
        ],
        'Force password change at first sign-in' => [
            'Type'        => 'yesno',
            'Default'     => 'on',
            'Description' => 'Applied when the provider supports it.',
        ],
    ];
}

/**
 * Create the remote mailbox / subscription.
 *
 * @param  array<string,mixed> $params
 * @return string 'success' or an error message
 */
function cloudhost247_email_hosting_CreateAccount(array $params)
{
    return cloudhost247_email_hosting_run('CreateAccount', $params, static function ($provisioner) {
        return $provisioner->create();
    });
}

/**
 * @param  array<string,mixed> $params
 * @return string
 */
function cloudhost247_email_hosting_SuspendAccount(array $params)
{
    return cloudhost247_email_hosting_run('SuspendAccount', $params, static function ($provisioner) {
        return $provisioner->suspend();
    });
}

/**
 * @param  array<string,mixed> $params
 * @return string
 */
function cloudhost247_email_hosting_UnsuspendAccount(array $params)
{
    return cloudhost247_email_hosting_run('UnsuspendAccount', $params, static function ($provisioner) {
        return $provisioner->unsuspend();
    });
}

/**
 * @param  array<string,mixed> $params
 * @return string
 */
function cloudhost247_email_hosting_TerminateAccount(array $params)
{
    return cloudhost247_email_hosting_run('TerminateAccount', $params, static function ($provisioner) {
        return $provisioner->terminate();
    });
}

/**
 * @param  array<string,mixed> $params
 * @return string
 */
function cloudhost247_email_hosting_ChangePassword(array $params)
{
    return cloudhost247_email_hosting_run('ChangePassword', $params, static function ($provisioner) {
        return $provisioner->changePassword();
    });
}

/**
 * Renewal: nothing to do remotely for subscription-based providers, but the
 * status is re-synchronised so the client area is accurate after billing.
 *
 * @param  array<string,mixed> $params
 * @return string
 */
function cloudhost247_email_hosting_Renew(array $params)
{
    return cloudhost247_email_hosting_run('Renew', $params, static function ($provisioner, $config) {
        return (new \CloudHost247\Email\Service\Reconciler())->syncService($config->serviceId());
    });
}

/**
 * Package change (upgrade/downgrade): swap the licence when both the old and
 * new SKUs are known and the provider supports licensing.
 *
 * @param  array<string,mixed> $params
 * @return string
 */
function cloudhost247_email_hosting_ChangePackage(array $params)
{
    return cloudhost247_email_hosting_run('ChangePackage', $params, static function ($provisioner, $config) {
        return cloudhost247_email_hosting_change_package($provisioner, $config);
    });
}

/**
 * Admin "Test connection" button on the server configuration.
 *
 * @param  array<string,mixed> $params
 * @return array<string,mixed>
 */
function cloudhost247_email_hosting_TestConnection(array $params)
{
    require_once __DIR__ . '/api.php';

    return cloudhost247_email_hosting_test_connection($params);
}

/**
 * Client-area service page.
 *
 * @param  array<string,mixed> $params
 * @return array<string,mixed>
 */
function cloudhost247_email_hosting_ClientArea(array $params)
{
    return cloudhost247_email_hosting_client_area($params);
}

/**
 * Extra client-area buttons.
 *
 * @return array<string,string>
 */
function cloudhost247_email_hosting_ClientAreaAllowedFunctions()
{
    return [];
}

/**
 * Admin service tab: state, provider facts and recent operations. Read-only and
 * redacted - no credentials, no raw provider payloads.
 *
 * @param  array<string,mixed> $params
 * @return array<string,string>
 */
function cloudhost247_email_hosting_AdminServicesTabFields(array $params)
{
    return cloudhost247_email_hosting_admin_tab_fields($params);
}

/**
 * Single sign-on: we do not mint provider sessions (neither Microsoft nor
 * Google permits it from a reseller), so the customer is sent to the provider's
 * own sign-in page.
 *
 * @param  array<string,mixed> $params
 * @return array<string,mixed>
 */
function cloudhost247_email_hosting_ServiceSingleSignOn(array $params)
{
    $config = new Config($params);
    $provider = ProviderFactory::make($config);

    $url = $provider->loginUrl([
        'email'  => $config->mailboxAddress(),
        'domain' => $config->domain(),
    ]);

    if (stripos($url, 'https://') !== 0) {
        return [
            'success'     => false,
            'errorMsg'    => 'No login URL is configured for this provider.',
        ];
    }

    return ['success' => true, 'redirectTo' => $url];
}
