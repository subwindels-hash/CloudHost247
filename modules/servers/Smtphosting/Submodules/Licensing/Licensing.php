<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\Licensing;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\ReissueLicense;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HostingCustomField;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\Dispatcher;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\DefaultSubmodule;
use WHMCS\Product\Product;
use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl;

class Licensing extends DefaultSubmodule
{

    public function details(array $params)
    {
        try
        {

            if (!$params['customfields'][HostingCustomField::SERVICE_ID])
            {
                return ['error' => 'The custom field Service ID is empty.'];
            }

            if($this->areDetailsAvailable($params))
            {
                $vars['details'] = parent::details($params)['result'];
            }

            foreach ($vars['details'] as $detail => $value)
            {
                if(!$value)
                {
                    $vars['details'][$detail] = '-';
                }
            }
            $vars['MGLANG']   = $this->lang;
            $vars['templateMG'] = Dispatcher::getTemplateForAction();
            $vars['cssDir']   = ModuleConstants::getStylesDirForSmarty();
            return [
                'templatefile' => Dispatcher::template(),
                'vars'         => $vars
            ];
        }
        catch (\Exception $e)
        {
            // Record the error in WHMCS's module log.
            logModuleCall(
                'Smtphosting',
                __FUNCTION__,
                $params,
                $e->getMessage(),
                $e->getTraceAsString()
            );
            return ['error' => $e->getMessage()];
        }
    }

    public function reissue(array $params)
    {
        try
        {
            if (!$params['customfields'][HostingCustomField::SERVICE_ID])
            {
                return 'The custom field Service ID is empty.';
            }
            $postfields =
                [
                    "id" => $params['customfields'][HostingCustomField::SERVICE_ID],
                ];
            $call       = new  ReissueLicense(Configuration::create($params), $postfields);
            $result     = $call->process();
            return $result['result'] === 'success' ? 'success': $result['result'];
        }
        catch (\Exception $e)
        {
            // Record the error in WHMCS's module log.
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

    public function getAAInfo(array $params)
    {
        try
        {
            if (!$params['customfields'][HostingCustomField::SERVICE_ID])
            {
                return [];
            }

            $details = parent::details($params)['result'];
            $newDetails = [];
            $notNeeded = [
                'allowreissues',
                'allowDomainConflicts',
                'allowIpConflicts',
                'allowDirectoryConflicts',
                'showCancellationButton',
            ];
            foreach ($details as $detail => $value)
            {
                if(!in_array($detail, $notNeeded)) {
                    $newDetails[$this->lang->T('Licensing', $detail)] = $value ?: "-";
                }
            }

            return $newDetails;

        }
        catch (\Exception $e)
        {
            // Record the error in WHMCS's module log.
            logModuleCall(
                'Smtphosting',
                __FUNCTION__,
                $params,
                $e->getMessage(),
                $e->getTraceAsString()
            );
            return ['Error' => '<span style="color: red;">' . $e->getMessage() . '</span>'];
        }
    }
}

