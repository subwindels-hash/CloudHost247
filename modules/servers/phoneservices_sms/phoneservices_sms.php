<?php
/**
 * WHMCS provisioning module: Phone Services - SMS & Messaging
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
function phoneservices_sms_MetaData(): array
{
    return [
        'DisplayName'                 => 'Phone Services - SMS & Messaging',
        'APIVersion'                  => '1.1',
        'RequiresServer'              => false,
        'DefaultNonSSLPort'           => '',
        'DefaultSSLPort'              => '',
        'ServiceSingleSignOnLabel'    => 'Open Phone Services portal',
        'AdminSingleSignOnLabel'      => '',
    ];
}

/**
 * Grants SMS, WhatsApp and transactional email messaging.
 *
 * @return array<string,array<string,string>>
 */
function phoneservices_sms_ConfigOptions(): array
{
    return [
        'Default Sender' => [
            'Type'        => 'text',
            'Size'        => '20',
            'Description' => 'Default sender ID or E.164 number used when the client does not pick one.',
        ],
        'Channels' => [
            'Type'        => 'dropdown',
            'Options'     => 'sms,sms+whatsapp,sms+whatsapp+email',
            'Default'     => 'sms',
            'Description' => 'Messaging channels unlocked by this product.',
        ],
        'Plan Code' => [
            'Type'        => 'text',
            'Size'        => '30',
            'Description' => 'Optional internal plan identifier stored on the subscription.',
        ],
        'Monthly Message Quota' => [
            'Type'        => 'text',
            'Size'        => '8',
            'Description' => 'Informational: messages bundled with the plan.',
        ],
    ];
}

/**
 * @param array<string,mixed> $params
 */
function phoneservices_sms_CreateAccount(array $params): string
{
    return Provisioning::create(Provisioning::SERVICE_SMS, $params);
}

/**
 * @param array<string,mixed> $params
 */
function phoneservices_sms_SuspendAccount(array $params): string
{
    return Provisioning::suspend(Provisioning::SERVICE_SMS, $params);
}

/**
 * @param array<string,mixed> $params
 */
function phoneservices_sms_UnsuspendAccount(array $params): string
{
    return Provisioning::unsuspend(Provisioning::SERVICE_SMS, $params);
}

/**
 * @param array<string,mixed> $params
 */
function phoneservices_sms_TerminateAccount(array $params): string
{
    return Provisioning::terminate(Provisioning::SERVICE_SMS, $params);
}

/**
 * Renewal is handled by the platform cron, so a WHMCS renewal only needs to
 * make sure the subscription is active again.
 *
 * @param array<string,mixed> $params
 */
function phoneservices_sms_Renew(array $params): string
{
    return Provisioning::unsuspend(Provisioning::SERVICE_SMS, $params);
}

/**
 * @param array<string,mixed> $params
 * @return array<string,mixed>
 */
function phoneservices_sms_ClientArea(array $params): array
{
    return [
        'tabOverviewReplacementTemplate' => 'templates/overview.tpl',
        'templateVariables'              => Provisioning::clientAreaVariables(Provisioning::SERVICE_SMS, $params),
    ];
}

/**
 * @param array<string,mixed> $params
 * @return array<string,string>
 */
function phoneservices_sms_AdminServicesTabFields(array $params): array
{
    return Provisioning::adminTabFields(Provisioning::SERVICE_SMS, $params);
}

/**
 * Deep link from the service page into the platform portal.
 *
 * @param array<string,mixed> $params
 * @return array<string,mixed>
 */
function phoneservices_sms_ServiceSingleSignOn(array $params): array
{
    $variables = Provisioning::clientAreaVariables(Provisioning::SERVICE_SMS, $params);

    return [
        'success'     => true,
        'redirectTo'  => $variables['portalUrl'],
    ];
}
