<?php
/**
 * WHMCS provisioning module: Phone Services - Virtual Numbers
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
function phoneservices_numbers_MetaData(): array
{
    return [
        'DisplayName'                 => 'Phone Services - Virtual Numbers',
        'APIVersion'                  => '1.1',
        'RequiresServer'              => false,
        'DefaultNonSSLPort'           => '',
        'DefaultSSLPort'              => '',
        'ServiceSingleSignOnLabel'    => 'Open Phone Services portal',
        'AdminSingleSignOnLabel'      => '',
    ];
}

/**
 * Provisions virtual phone numbers from the Phone Services platform.
 *
 * @return array<string,array<string,string>>
 */
function phoneservices_numbers_ConfigOptions(): array
{
    return [
        'Country' => [
            'Type'        => 'text',
            'Size'        => '4',
            'Default'     => 'US',
            'Description' => 'ISO 3166-1 alpha-2 country code the number is bought in (e.g. US, GB, NG). Leave blank to let the client choose in the portal.',
        ],
        'Number Type' => [
            'Type'         => 'dropdown',
            'Options'      => 'local,tollfree,mobile,national',
            'Default'      => 'local',
            'Description'  => 'Number class to search for.',
        ],
        'Included Minutes' => [
            'Type'        => 'text',
            'Size'        => '8',
            'Description' => 'Informational: minutes bundled with the plan.',
        ],
        'Monthly SMS Quota' => [
            'Type'        => 'text',
            'Size'        => '8',
            'Description' => 'Informational: SMS bundled with the plan.',
        ],
    ];
}

/**
 * @param array<string,mixed> $params
 */
function phoneservices_numbers_CreateAccount(array $params): string
{
    return Provisioning::create(Provisioning::SERVICE_NUMBERS, $params);
}

/**
 * @param array<string,mixed> $params
 */
function phoneservices_numbers_SuspendAccount(array $params): string
{
    return Provisioning::suspend(Provisioning::SERVICE_NUMBERS, $params);
}

/**
 * @param array<string,mixed> $params
 */
function phoneservices_numbers_UnsuspendAccount(array $params): string
{
    return Provisioning::unsuspend(Provisioning::SERVICE_NUMBERS, $params);
}

/**
 * @param array<string,mixed> $params
 */
function phoneservices_numbers_TerminateAccount(array $params): string
{
    return Provisioning::terminate(Provisioning::SERVICE_NUMBERS, $params);
}

/**
 * Renewal is handled by the platform cron, so a WHMCS renewal only needs to
 * make sure the subscription is active again.
 *
 * @param array<string,mixed> $params
 */
function phoneservices_numbers_Renew(array $params): string
{
    return Provisioning::unsuspend(Provisioning::SERVICE_NUMBERS, $params);
}

/**
 * @param array<string,mixed> $params
 * @return array<string,mixed>
 */
function phoneservices_numbers_ClientArea(array $params): array
{
    return [
        'tabOverviewReplacementTemplate' => 'templates/overview.tpl',
        'templateVariables'              => Provisioning::clientAreaVariables(Provisioning::SERVICE_NUMBERS, $params),
    ];
}

/**
 * @param array<string,mixed> $params
 * @return array<string,string>
 */
function phoneservices_numbers_AdminServicesTabFields(array $params): array
{
    return Provisioning::adminTabFields(Provisioning::SERVICE_NUMBERS, $params);
}

/**
 * Deep link from the service page into the platform portal.
 *
 * @param array<string,mixed> $params
 * @return array<string,mixed>
 */
function phoneservices_numbers_ServiceSingleSignOn(array $params): array
{
    $variables = Provisioning::clientAreaVariables(Provisioning::SERVICE_NUMBERS, $params);

    return [
        'success'     => true,
        'redirectTo'  => $variables['portalUrl'],
    ];
}
