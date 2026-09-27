<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\EasyDCIM;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\ServiceGraphsRequest;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HostingCustomField;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\Dispatcher;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\DefaultSubmodule;
use \Carbon\Carbon;

/**
 * Class EasyDCIM
 * @method start
 * @method stop
 * @method reboot
 */
class EasyDCIM extends DefaultSubmodule
{
    public function __call(string $name, array $arguments)
    {
        $params       = $arguments[0];
        $requestClass = '';
        switch ($name)
        {
            case 'boot':
                $requestClass = 'ServiceBootRequest';
                break;
            case 'shutdown':
                $requestClass = 'ServiceShutdownRequest';
                break;
            case 'reboot':
                $requestClass = 'ServiceRebootRequest';
                break;
        }
        if ($requestClass === '')
        {
            return $name . ' does not exist.';
        }
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
            $class      = "ModulesGarden\\ProductsReseller\\Server\\Smtphosting\\Calls\\" . $requestClass;
            $call       = new  $class(Configuration::create($params), $postfields);
            $result     = $call->process();
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

    public function graphs(array $params)
    {

        if (!$params['customfields'][HostingCustomField::SERVICE_ID])
        {
            return 'The custom field Service ID is empty.';
        }
        try
        {
            if ($_REQUEST['magic'])
            {
                $enhancedTimeframe = [
                    'startDate' => $_REQUEST['startDate'] ?: Carbon::now()->subDays(1)->toDateString(),
                    'endDate'   => $_REQUEST['endDate'] ?: Carbon::now()->toDateString(),
                    'width'     => $_REQUEST['width'] ?: 700,
                ];

                $postfields    =
                    [
                        "id"        => $params['customfields'][HostingCustomField::SERVICE_ID],
                        "timeframe" => "json:" . json_encode($enhancedTimeframe)
                    ];
                $call          = new  ServiceGraphsRequest(Configuration::create($params), $postfields);
                $result        = $call->process();
                $vars['graph'] = $result['data'];
                echo json_encode($vars);
                exit;
            }
            else
            {
                ModuleConstants::initialize();
                $vars['startDisplayDate'] = Carbon::now()->subDays(1)->toDateString();
                $vars['endDisplayDate']   = Carbon::now()->toDateString();
                $vars['cssDir']           = ModuleConstants::getStylesDirForSmarty();
                $vars['jsDir']            = ModuleConstants::getJsDirForSmarty();
                $vars['MGLANG']           = $this->lang;

                $vars['templateMG'] = Dispatcher::getTemplateForAction();
//                var_dump(Dispatcher::template());
//                var_dump(Dispatcher::getTemplateForAction());
//                exit;
                return [
                    'templatefile' => Dispatcher::template(),
                    'vars'         => $vars
                ];
            }
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

    public function details(array $params)
    {
        try
        {

            if (!$params['customfields'][HostingCustomField::SERVICE_ID])
            {
                return ['error' => 'The custom field Service ID is empty.'];
            }

            if ($this->areDetailsAvailable($params))
            {
                $vars['details'] = parent::details($params);
            }

            if (!empty($vars['details']['ipaddresses']))
            {
                unset($vars['details']['ipaddress']);
            }

            unset($vars['details']['sshPrivateKeyUrl']);
            unset($vars['details']['Change Hostname']);
            unset($vars['details']['sshPasswordHash']);
            unset($vars['details']['customMetadata']);
            $vars['cssDir']  = ModuleConstants::getStylesDirForSmarty();
            $vars['details'] = array_filter(
                $vars['details'],
                function ($value) {
                    if (empty($value) || $value == '0' || $value === 'Unassigned')
                    {
                        return false;
                    }
                    return true;
                });


            $vars['details']    = array_map(
                function ($value) {
                    if (is_array($value))
                    {
                        return $value;
                    }
                    return strip_tags($value);
                },
                $vars['details']
            );
            $vars['MGLANG']     = $this->lang;
            $vars['templateMG'] = Dispatcher::getTemplateForAction();

            return [
                'templatefile' => Dispatcher::template(),
                'vars'         => $vars
            ];
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
            return ['error' => $e->getMessage()];
        }
    }
}
