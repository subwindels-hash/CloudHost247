<?php
/**
 * WHMCS provisioning module: Phone Services - VoIP
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
function phoneservices_voip_MetaData(): array
{
    return [
        'DisplayName'                 => 'Phone Services - VoIP',
        'APIVersion'                  => '1.1',
        'RequiresServer'              => false,
        'DefaultNonSSLPort'           => '',
        'DefaultSSLPort'              => '',
        'ServiceSingleSignOnLabel'    => 'Open Phone Services portal',
        'AdminSingleSignOnLabel'      => '',
    ];
}

/**
 * Enables browser (WebRTC) and PSTN calling for the client.
 *
 * @return array<string,array<string,string>>
 */
function phoneservices_voip_ConfigOptions(): array
{
    return [
        'Concurrent Channels' => [
            'Type'        => 'text',
            'Size'        => '6',
            'Default'     => '2',
            'Description' => 'Simultaneous calls permitted on this plan.',
        ],
        'Outbound Enabled' => [
            'Type'        => 'yesno',
            'Default'     => 'on',
            'Description' => 'Allow outbound calling.',
        ],
        'Plan Code' => [
            'Type'        => 'text',
            'Size'        => '30',
            'Description' => 'Optional internal plan identifier stored on the subscription.',
        ],
        'Included Minutes' => [
            'Type'        => 'text',
            'Size'        => '8',
            'Description' => 'Informational: minutes bundled with the plan.',
        ],
    ];
}

/**
 * @param array<string,mixed> $params
 */
function phoneservices_voip_CreateAccount(array $params): string
{
    return Provisioning::create(Provisioning::SERVICE_VOIP, $params);
}

/**
 * @param array<string,mixed> $params
 */
function phoneservices_voip_SuspendAccount(array $params): string
{
    return Provisioning::suspend(Provisioning::SERVICE_VOIP, $params);
}

/**
 * @param array<string,mixed> $params
 */
function phoneservices_voip_UnsuspendAccount(array $params): string
{
    return Provisioning::unsuspend(Provisioning::SERVICE_VOIP, $params);
}

/**
 * @param array<string,mixed> $params
 */
function phoneservices_voip_TerminateAccount(array $params): string
{
    return Provisioning::terminate(Provisioning::SERVICE_VOIP, $params);
}

/**
 * Renewal is handled by the platform cron, so a WHMCS renewal only needs to
 * make sure the subscription is active again.
 *
 * @param array<string,mixed> $params
 */
function phoneservices_voip_Renew(array $params): string
{
    return Provisioning::unsuspend(Provisioning::SERVICE_VOIP, $params);
}

/**
 * @param array<string,mixed> $params
 * @return array<string,mixed>
 */
function phoneservices_voip_ClientArea(array $params): array
{
    return [
        'tabOverviewReplacementTemplate' => 'templates/overview.tpl',
        'templateVariables'              => Provisioning::clientAreaVariables(Provisioning::SERVICE_VOIP, $params),
    ];
}

/**
 * @param array<string,mixed> $params
 * @return array<string,string>
 */
function phoneservices_voip_AdminServicesTabFields(array $params): array
{
    return Provisioning::adminTabFields(Provisioning::SERVICE_VOIP, $params);
}

/**
 * Deep link from the service page into the platform portal.
 *
 * @param array<string,mixed> $params
 * @return array<string,mixed>
 */
function phoneservices_voip_ServiceSingleSignOn(array $params): array
{
    $variables = Provisioning::clientAreaVariables(Provisioning::SERVICE_VOIP, $params);

    return [
        'success'     => true,
        'redirectTo'  => $variables['portalUrl'],
    ];
}
