<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\Virtualizor;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\ServiceDetailsRequest;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\ServiceGraphsRequest;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\ServiceVncConsoleRequest;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HostingCustomField;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\Dispatcher;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\DefaultSubmodule;


class Virtualizor extends DefaultSubmodule
{
    public function __call(string $name, array $arguments)
    {
        $params       = $arguments[0];
        $requestClass = '';
        switch ($name)
        {
            case 'start':
                $requestClass = 'ServiceStartRequest';
                break;
            case 'stop':
                $requestClass = 'ServiceStopRequest';
                break;
            case 'reboot':
                $requestClass = 'ServiceRebootRequest';
                break;
            case 'powerOff':
                $requestClass = 'ServicePowerOffRequest';
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
            $class      = 'ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\\' . $requestClass;
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
            return ' - ' . $e->getMessage();
        }
        return 'success';
    }

    public function vncConsole(array $params)
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

            $call   = new  ServiceVncConsoleRequest(Configuration::create($params), $postfields);
            $result = $call->process();

            $moduleUrl            = ModuleConstants::getTemplatesDirForSmarty() . DIRECTORY_SEPARATOR . "Virtualizor";
            $result['MODULE_URL'] = $moduleUrl;
            $novncPath            = ModuleConstants::getTemplatesDir() . DIRECTORY_SEPARATOR . "Virtualizor" . DIRECTORY_SEPARATOR . "novnc" . DIRECTORY_SEPARATOR . "novnc.html";
            $novnc_viewer         = file_get_contents($novncPath);

            if (!empty($_SERVER['HTTPS']) || @$_SERVER['HTTP_X_FORWARDED_PROTO'] == 'https')
            {
                $result['PORT']      = 4083;
                $result['VIRTPORT']  = 4083;
                $result['WEBSOCKET'] = 'novnc/';
                $result['PROTO']     = 'https';
            }

            $vars['novnc'] = $novnc_viewer = $this->vlang_vars_name($novnc_viewer, $result);

            if ($_REQUEST['act'] === 'vnc' && $_REQUEST['novnc'])
            {
                echo $vars['novnc'];
                die();
            }
            $vars['shouldShowIntegration'] = !is_null($result['HOST']) && !empty($result['status']);
            $vars['url']                   = $_SERVER['QUERY_STRING'];
            $vars['vpsID']                 = $result['TOKEN'];
            $vars['MGLANG']                = $this->lang;
            $vars['templateMG']            = Dispatcher::getTemplateForAction('vncconsole');
            $vars['cssDir']                = ModuleConstants::getStylesDirForSmarty();

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
            return ' - ' . $e->getMessage();
        }
    }

    public function graphs(array $params)
    {
        try
        {
            if (!$params['customfields'][HostingCustomField::SERVICE_ID])
            {
                return 'The custom field Service ID is empty.';
            }

            if ($_REQUEST['magic'])
            {
                $timeframe = $_REQUEST['timeframe'];
            }
            else
            {
                $timeframe = date('Ym');
            }
            $postfields =
                [
                    "id"        => $params['customfields'][HostingCustomField::SERVICE_ID],
                    "timeframe" => $timeframe
                ];
            $call       = new  ServiceGraphsRequest(Configuration::create($params), $postfields);
            $rrdata     = $call->process();

            foreach (array_keys($rrdata['daily']['usage']) as $label)
            {
                $dailyLabels[] = substr($label, 6);
            }

            $monthlyLabels = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

            $vars['graphs'] = [
                "monthly"   => [
                    "labels"   => $monthlyLabels,
                    "datasets" => [
                        0 => [
                            "label"           => "Bandwidth In",
                            "backgroundColor" => 'rgba(174, 198, 57, 0.79)',
                            "borderColor"     => 'rgba(174, 198, 57, 1)',
                            "data"            => $rrdata['monthly']['in'],
                        ],
                        1 => [
                            "label"           => "Bandwidth Out",
                            "backgroundColor" => 'rgba(39, 133, 134, 0.91)',
                            "borderColor"     => 'rgba(39, 133, 134, 1)',
                            "data"            => $rrdata['monthly']['out'],
                        ]
                    ]
                ],
                "bandwidth" => [
                    "labels"   => $dailyLabels,
                    "datasets" => [
                        0 => [
                            "label"           => "Bandwidth Usage",
                            "backgroundColor" => 'rgba(39, 133, 134, 0.91)',
                            "borderColor"     => 'rgba(39, 133, 134, 1)',
                            "data"            => array_values($rrdata['daily']['usage']),
                        ],
                        1 => [
                            "label"           => "Bandwidth In",
                            "backgroundColor" => 'rgba(174, 198, 57, 0.79)',
                            "borderColor"     => 'rgba(174, 198, 57, 1)',
                            "data"            => array_values($rrdata['daily']['in']),
                        ],
                        2 => [
                            "label"           => "Bandwidth Out",
                            "backgroundColor" => 'rgba(178, 55, 78, 0.79)',
                            "borderColor"     => 'rgba(178, 55, 78, 1)',
                            "data"            => array_values($rrdata['daily']['out']),
                        ],
                    ]
                ],
                'labelDate' => $monthlyLabels[((int)substr($timeframe, 4)) - 1] . ' ' . substr($timeframe, 0, 4)
            ];
            $vars['graphs'] = json_encode($vars['graphs']);

            if ($_REQUEST['magic'])
            {
                echo $vars['graphs'];
                exit;
            }
            $vars['MGLANG']     = $this->lang;
            $vars['templateMG'] = Dispatcher::getTemplateForAction();
            $vars['cssDir']     = ModuleConstants::getStylesDirForSmarty();

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
            return ' - ' . $e->getMessage();
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
            $postfields =
                [
                    "id" => $params['customfields'][HostingCustomField::SERVICE_ID],
                ];
            $call       = new  ServiceDetailsRequest(Configuration::create($params), $postfields);
            $data       = $call->process();

            $vars['data']       = $data;
            $vars['MGLANG']     = $this->lang;
            $vars['templateMG'] = Dispatcher::getTemplateForAction('clientarea');
            $vars['cssDir']     = ModuleConstants::getStylesDirForSmarty();

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

    protected function vlang_vars_name($str, $array)
    {
        foreach ($array as $k => $v)
        {
            $str = str_replace('{{' . $k . '}}', $v, $str);
        }
        return $str;
    }
}