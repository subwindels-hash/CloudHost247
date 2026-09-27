<?php

use ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions\ChangePassword;
use ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions\TerminateAccount;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HostingCustomField;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use WHMCS\Product\Product;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\AppContext;
use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl;

if (!defined("WHMCS"))
{
    die("This file cannot be accessed directly");
}

if (!defined('DS'))
{
    define('DS', DIRECTORY_SEPARATOR);
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'Core' . DIRECTORY_SEPARATOR . 'WhmcsErrorIntegration.php';

include_once dirname(__FILE__) . DIRECTORY_SEPARATOR . 'Core' . DIRECTORY_SEPARATOR . "Loader.php";
new \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Loader(__DIR__);

//Submodule Actions
if (file_exists(__DIR__ . DIRECTORY_SEPARATOR . "storage" . DIRECTORY_SEPARATOR . "app" . DIRECTORY_SEPARATOR . "GeneratedFunctions.php"))
{
    include __DIR__ . DIRECTORY_SEPARATOR . "storage" . DIRECTORY_SEPARATOR . "app" . DIRECTORY_SEPARATOR . "GeneratedFunctions.php";
}

/**
 * @return string[]
 */
function Smtphosting_MetaData()
{
    return [
        'DisplayName' => 'Smtphosting',
        'APIVersion'  => '1.0', // Use API Version 1.0
    ];
}

function Smtphosting_TestConnection($params)
{
    require_once __DIR__ . DIRECTORY_SEPARATOR . 'Core' . DIRECTORY_SEPARATOR . 'App' . DIRECTORY_SEPARATOR . 'AppContext.php';
    $appContext = new AppContext();
    return $appContext->runApp(__FUNCTION__, $params);
}

/**
 * @return string[][]
 */
function Smtphosting_ConfigOptions($params)
{
    require_once __DIR__ . DIRECTORY_SEPARATOR . 'Core' . DIRECTORY_SEPARATOR . 'App' . DIRECTORY_SEPARATOR . 'AppContext.php';
    $appContext = new AppContext();
    return $appContext->runApp(__FUNCTION__, $params);
}

/**
 * @param array $params
 * @return string
 */
function Smtphosting_CreateAccount(array $params): string
{
    if ($params['customfields'][HostingCustomField::SERVICE_ID])
    {
        return 'The custom field Service ID is not empty.';
    }
    try
    {
        $createAccount = new \ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions\CreateAccount($params);
        return $createAccount->process();
    }
    catch (\Exception $e)
    {
        logModuleCall(
            'Smtphosting',
            __FUNCTION__,
            $params,
            $e->getMessage(),
            $e->getTraceAsString()
        );
        return rtrim($e->getMessage(), ": ");
    }
}

/**
 * @param array $params
 * @return string
 */
function Smtphosting_SuspendAccount(array $params): string
{
    if (!$params['customfields'][HostingCustomField::SERVICE_ID])
    {
        return 'The custom field Service ID is empty.';
    }
    try
    {
        return (new \ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions\SuspendAccount($params))->process();
    }
    catch (\Exception $e)
    {
        logModuleCall(
            'Smtphosting',
            __FUNCTION__,
            $params,
            $e->getMessage(),
            $e->getTraceAsString()
        );
        return $e->getMessage();
    }
}

/**
 * @param array $params
 * @return string
 */
function Smtphosting_UnsuspendAccount(array $params): string
{
    if (!$params['customfields'][HostingCustomField::SERVICE_ID])
    {
        return 'The custom field Service ID is empty.';
    }
    try
    {
        return (new \ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions\UnsuspendAccount($params))->process();
    }
    catch (\Exception $e)
    {
        logModuleCall(
            'Smtphosting',
            __FUNCTION__,
            $params,
            $e->getMessage(),
            $e->getTraceAsString()
        );

        return $e->getMessage();
    }
}

/**
 * @param array $params
 * @return string
 */
function Smtphosting_ChangePassword(array $params): string
{

    if (!$params['customfields'][HostingCustomField::SERVICE_ID])
    {
        return 'The custom field Service ID is empty.';
    }
    try
    {

        return (new ChangePassword($params))->process();
    }
    catch (\Exception $e)
    {
        logModuleCall(
            'Smtphosting',
            __FUNCTION__,
            $params,
            $e->getMessage(),
            $e->getTraceAsString()
        );

        return $e->getMessage();
    }
}

/**
 * @param array $params
 * @return string
 */
function Smtphosting_ChangePackage(array $params): string
{
    if (!$params['customfields'][HostingCustomField::SERVICE_ID])
    {
        return 'The custom field Service ID is empty.';
    }
    try
    {
        return (new \ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions\ChangePackage($params))->process();
    }
    catch (\Exception $e)
    {
        logModuleCall(
            'Smtphosting',
            __FUNCTION__,
            $params,
            $e->getMessage(),
            $e->getTraceAsString()
        );

        return $e->getMessage();
    }
}

/**
 * @param array $params
 * @return string
 */
function Smtphosting_Renew(array $params): string
{
    if (!$params['customfields'][HostingCustomField::SERVICE_ID])
    {
        return 'The custom field Service ID is empty.';
    }
    try
    {
        return (new \ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions\Renew($params))->process();
    }
    catch (\Exception $e)
    {
        logModuleCall(
            'Smtphosting',
            __FUNCTION__,
            $params,
            $e->getMessage(),
            $e->getTraceAsString()
        );
        return $e->getMessage();
    }
}

/**
 * @param array $params
 * @return string
 */
function Smtphosting_TerminateAccount(array $params): string
{
    if (!$params['customfields'][HostingCustomField::SERVICE_ID])
    {
        return 'The custom field Service ID is empty.';
    }
    try
    {
        return (new TerminateAccount($params))->process();
    }
    catch (\Exception $e)
    {
        logModuleCall(
            'Smtphosting',
            __FUNCTION__,
            $params,
            $e->getMessage(),
            $e->getTraceAsString()
        );
        return $e->getMessage();
    }
}

/**
 * @param array $params
 * @return array
 */
function Smtphosting_AdminServicesTabFields(array $params)
{
    if (!$params['customfields'][HostingCustomField::SERVICE_ID])
    {
        return 'The custom field Service ID is empty.';
    }

    try
    {
        return (new \ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions\AdminServicesTabFields($params))->process();
    }
    catch (\Exception $e)
    {
        logModuleCall(
            'Smtphosting',
            __FUNCTION__,
            $params,
            $e->getMessage(),
            $e->getTraceAsString()
        );
        $lang = sl('lang');
        return [
            'templatefile' => \ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\Dispatcher::errorTemplate(),
            'vars'         => [
                'MGLANG' => $lang,
                'error'  => $e->getMessage(),
            ],
        ];
    }
}

/**
 * @param array $params
 * @return array
 */
function Smtphosting_ClientArea(array $params)
{
    if (!$params['customfields'][HostingCustomField::SERVICE_ID])
    {
        return 'The custom field Service ID is empty.';
    }
    try
    {
        return (new \ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions\ClientArea($params))->process();
    }
    catch (\Exception $e)
    {
        logModuleCall(
            'Smtphosting',
            __FUNCTION__,
            $params,
            $e->getMessage(),
            $e->getTraceAsString()
        );
        $lang = sl('lang');
        return [
            'templatefile' => \ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\Dispatcher::errorTemplate(),
            'vars'         => [
                'MGLANG' => $lang,
                'error'  => $e->getMessage(),
            ],
        ];
    }
}

/**
 * @param $params
 * @return array
 */
function Smtphosting_ClientAreaCustomButtonArray($params)
{
    try
    {
        return (new \ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions\ClientAreaCustomButtonArray($params))->process();
    }
    catch (\Exception $e)
    {
        logModuleCall(
            'Smtphosting',
            __FUNCTION__,
            $_REQUEST,
            $e->getMessage(),
            $e->getTraceAsString()
        );
    }
}

/**
 * @param $params
 * @return array
 */
function Smtphosting_AdminCustomButtonArray()
{
    return [
        "Synchronize" => "Synchronize",
    ];
}

function Smtphosting_Synchronize(array $params)
{
    require_once __DIR__ . DIRECTORY_SEPARATOR . 'Core' . DIRECTORY_SEPARATOR . 'App' . DIRECTORY_SEPARATOR . 'AppContext.php';
    $appContext = new AppContext();
    return $appContext->runApp(__FUNCTION__, $params);
}

