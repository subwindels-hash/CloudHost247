<?php
/**
 * WHMCS provisioning module: Phone Services - eSIM & Data
 *
 * A deliberately thin wrapper around
 * \PhoneServices\Core\Provisioning, which lives in the phoneservices addon
 * and owns all lifecycle behaviour. Installing this module alone does nothing;
 * the "Phone Number Services Platform" addon must be activated first.
 *
 * @package PhoneServices
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

require_once __DIR__ . '/../../addons/phoneservices/bootstrap.php';

use PhoneServices\Core\Provisioning;

/**
 * @return array<string,mixed>
 */
function phoneservices_esim_MetaData(): array
{
    return [
        'DisplayName'                 => 'Phone Services - eSIM & Data',
        'APIVersion'                  => '1.1',
        'RequiresServer'              => false,
        'DefaultNonSSLPort'           => '',
        'DefaultSSLPort'              => '',
        'ServiceSingleSignOnLabel'    => 'Open Phone Services portal',
        'AdminSingleSignOnLabel'      => '',
    ];
}

/**
 * Provisions eSIM data profiles from the configured eSIM provider.
 *
 * @return array<string,array<string,string>>
 */
function phoneservices_esim_ConfigOptions(): array
{
    return [
        'Country / Region' => [
            'Type'        => 'text',
            'Size'        => '10',
            'Description' => 'Optional ISO country code or region slug used to filter plans.',
        ],
        'Plan Type' => [
            'Type'        => 'dropdown',
            'Options'     => 'local,regional,global',
            'Default'     => 'local',
            'Description' => 'Coverage class of the bundled plan.',
        ],
        'Provider Plan ID' => [
            'Type'        => 'text',
            'Size'        => '40',
            'Description' => 'Exact provider plan identifier. When set, the eSIM is provisioned automatically on order.',
        ],
        'Data Allowance (MB)' => [
            'Type'        => 'text',
            'Size'        => '8',
            'Description' => 'Informational: data bundled with the plan.',
        ],
    ];
}

/**
 * @param array<string,mixed> $params
 */
function phoneservices_esim_CreateAccount(array $params): string
{
    return Provisioning::create(Provisioning::SERVICE_ESIM, $params);
}

/**
 * @param array<string,mixed> $params
 */
function phoneservices_esim_SuspendAccount(array $params): string
{
    return Provisioning::suspend(Provisioning::SERVICE_ESIM, $params);
}

/**
 * @param array<string,mixed> $params
 */
function phoneservices_esim_UnsuspendAccount(array $params): string
{
    return Provisioning::unsuspend(Provisioning::SERVICE_ESIM, $params);
}

/**
 * @param array<string,mixed> $params
 */
function phoneservices_esim_TerminateAccount(array $params): string
{
    return Provisioning::terminate(Provisioning::SERVICE_ESIM, $params);
}

/**
 * Renewal is handled by the platform cron, so a WHMCS renewal only needs to
 * make sure the subscription is active again.
 *
 * @param array<string,mixed> $params
 */
function phoneservices_esim_Renew(array $params): string
{
    return Provisioning::unsuspend(Provisioning::SERVICE_ESIM, $params);
}

/**
 * @param array<string,mixed> $params
 * @return array<string,mixed>
 */
function phoneservices_esim_ClientArea(array $params): array
{
    return [
        'tabOverviewReplacementTemplate' => 'templates/overview.tpl',
        'templateVariables'              => Provisioning::clientAreaVariables(Provisioning::SERVICE_ESIM, $params),
    ];
}

/**
 * @param array<string,mixed> $params
 * @return array<string,string>
 */
function phoneservices_esim_AdminServicesTabFields(array $params): array
{
    return Provisioning::adminTabFields(Provisioning::SERVICE_ESIM, $params);
}

/**
 * Deep link from the service page into the platform portal.
 *
 * @param array<string,mixed> $params
 * @return array<string,mixed>
 */
function phoneservices_esim_ServiceSingleSignOn(array $params): array
{
    $variables = Provisioning::clientAreaVariables(Provisioning::SERVICE_ESIM, $params);

    return [
        'success'     => true,
        'redirectTo'  => $variables['portalUrl'],
    ];
}
