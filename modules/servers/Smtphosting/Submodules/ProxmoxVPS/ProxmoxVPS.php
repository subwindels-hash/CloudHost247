<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\ProxmoxVPS;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\GetInfo;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\ServiceSpiceConsoleRequest;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\ServiceVncConsoleRequest;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\ServiceGetTemplatesRequest;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\ServiceGraphsRequest;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\ServiceReinstallRequest;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\ServiceXTermConsoleRequest;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HostingCustomField;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\OutputBuffer;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Smarty;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\Dispatcher;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\DefaultSubmodule;

/**
 * Class ProxmoxVPS
 * @method start
 * @method stop
 * @method reboot
 */
class ProxmoxVPS extends DefaultSubmodule
{
    use OutputBuffer;
    use Smarty;

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
            $class      = "ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\\" . $requestClass;
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
        return 'success';
    }

    public function graphs(array $params)
    {
        if (!$params['customfields'][HostingCustomField::SERVICE_ID])
        {
            return ['error' => 'The custom field Service ID is empty.'];
        }
        try
        {
            $vars = [
                "params" => $params
            ];
            //timeframes
            $registrationDate   = new \DateTime($params['model']->registrationDate->format("Y-m-d"));
            $dnow               = new \DateTime();
            $dDiff              = $registrationDate->diff($dnow);
            $vars['timeFrames'] = [
                "hour" => 'Hour',
            ];
            if ($dDiff->days >= 1)
            {
                $vars['timeFrames']['day'] = "Day";
            }
            if ($dDiff->days >= 7)
            {
                $vars['timeFrames']['week'] = "Week";
            }
            if ($dDiff->days >= 30)
            {
                $vars['timeFrames']['month'] = "Month";
            }
            if ($dDiff->y >= 1)
            {
                $vars['timeFrames']['year'] = "Year";
            }
            $timeframe         = $_REQUEST['timeframe'] && in_array($_REQUEST['timeframe'], array_keys($vars['timeFrames'])) ? $_REQUEST['timeframe'] : "hour";
            $vars['timeframe'] = $timeframe;
            $postfields        =
                [
                    "id"        => $params['customfields'][HostingCustomField::SERVICE_ID],
                    "timeframe" => $timeframe
                ];
            $call              = new  ServiceGraphsRequest(Configuration::create($params), $postfields);
            $labels            = [];
            $datasets          = [];
            $rrdata            = $result = $call->process();
            $dateFormat        = in_array($timeframe, ['hour', 'day']) ? "H:i:s" : "Y-m-d";
            foreach ($rrdata as $rrd)
            {
                $labels[] = date($dateFormat, $rrd['time']);

                $datasets['cpu'][]       = (isset($rrd['cpu']) ? (float)$rrd['cpu'] : 0) * 100;
                $datasets['mem'][]       = isset($rrd['mem']) ? $rrd['mem'] : 0;
                $datasets['maxmem'][]    = isset($rrd['maxmem']) ? $rrd['maxmem'] : 0;
                $datasets['netin'][]     = isset($rrd['netin']) ? (float)$rrd['netin'] : 0;
                $datasets['netout'][]    = isset($rrd['netout']) ? (float)$rrd['netout'] : 0;
                $datasets['diskread'][]  = (isset($rrd['diskread']) ? $rrd['diskread'] : 0);
                $datasets['diskwrite'][] = (isset($rrd['diskwrite']) ? $rrd['diskwrite'] : 0);
            }
            $vars['graphs']     = [
                "cpu"  => [
                    "labels"   => $labels,
                    "datasets" => [
                        0 => [
                            "label"           => "CPU Usage",
                            "backgroundColor" => 'rgba(174, 198, 57, 0.79)',
                            "borderColor"     => 'rgba(174, 198, 57, 1)',
                            "data"            => (array)$datasets['cpu'],
                        ]
                    ]
                ],
                "mem"  => [
                    "labels"   => $labels,
                    "datasets" => [
                        0 => [
                            "label"           => "Memory Usage",
                            "backgroundColor" => 'rgba(39, 133, 134, 0.91)',
                            "borderColor"     => 'rgba(39, 133, 134, 1)',
                            "data"            => $datasets['mem'],
                        ],
                        1 => [
                            "label"           => "Total",
                            "backgroundColor" => 'rgba(174, 198, 57, 0.79)',
                            "borderColor"     => 'rgba(174, 198, 57, 1)',
                            "data"            => $datasets['maxmem'],
                        ],

                    ]
                ],
                "net"  => [
                    "labels"   => $labels,
                    "datasets" => [
                        0 => [
                            "label"           => "Net In",
                            "backgroundColor" => 'rgba(174, 198, 57, 0.79)',
                            "borderColor"     => 'rgba(174, 198, 57, 1)',
                            "data"            => $datasets['netin'],
                        ],
                        1 => [
                            "label"           => "Net Out",
                            "backgroundColor" => 'rgba(39, 133, 134, 0.91)',
                            "borderColor"     => 'rgba(39, 133, 134, 1)',

                            "data" => $datasets['netout'],
                        ],
                    ]
                ],
                "disk" => [
                    "labels"   => $labels,
                    "datasets" => [
                        0 => [
                            "label"           => "Disk Read",
                            "backgroundColor" => 'rgba(174, 198, 57, 0.79)',
                            "borderColor"     => 'rgba(174, 198, 57, 1)',
                            "data"            => $datasets['diskread'],
                        ],
                        1 => [
                            "label"           => "Disk Write",
                            "backgroundColor" => 'rgba(39, 133, 134, 0.91)',
                            "borderColor"     => 'rgba(39, 133, 134, 1)',

                            "data" => $datasets['diskwrite'],
                        ],
                    ]
                ]
            ];
            $vars['graphs']     = json_encode($vars['graphs']);
            $vars['MGLANG']     = $this->lang;
            $vars['cssDir']     = ModuleConstants::getStylesDirForSmarty();
            $vars['templateMG'] = Dispatcher::getTemplateForAction();
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
            return $e->getMessage();
        }
    }

    public function getInfo($params)
    {
        try
        {
            if (!$params['customfields'][HostingCustomField::SERVICE_ID])
            {
                return 'The custom field Service ID is empty.';
            }
            $postfields         =
                [
                    "id" => $params['customfields'][HostingCustomField::SERVICE_ID],
                ];
            $call               = new  GetInfo(Configuration::create($params), $postfields);
            $vars               = $call->process();
            $vars['MGLANG']     = $this->lang;
            $vars['templateMG'] = Dispatcher::getTemplateForAction('home');
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
            return $e->getMessage();
        }
    }

    public function details($params)
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
            return ['error' => $e->getMessage()];
        }
    }

    public function reinstall(array $params)
    {
        if (!$params['customfields'][HostingCustomField::SERVICE_ID])
        {
            return 'The custom field Service ID is empty.';
        }

        try
        {
            $paramsArr = [
                'id' => $params['customfields'][HostingCustomField::SERVICE_ID],
            ];

            $vars['params'] = $params;
            $vars['MGLANG'] = $this->lang;
            $vars['templateMG'] = Dispatcher::getTemplateForAction();
            $vars['cssDir'] = ModuleConstants::getStylesDirForSmarty();

            if ($_POST)
            {
                $paramsArr = [
                    'id' => $params['customfields'][HostingCustomField::SERVICE_ID],
                    'actionid' => $_POST['volid'],
                    'password' => $_POST['password']
                ];

                $call = new ServiceReinstallRequest(Configuration::create($params), $paramsArr);
                $vars['message'] = $call->process();
            }


            if ($this->areDetailsAvailable($params))
            {
                $vars['details'] = parent::details($params);
            }


            $call = new ServiceGetTemplatesRequest(Configuration::create($params), $paramsArr);

            $vars['response'] = $call->process();

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
            return $e->getMessage();
        }
    }

    public function noVncConsole(array $params)
    {
        if (!$params['customfields'][HostingCustomField::SERVICE_ID])
        {
            return 'The custom field Service ID is empty.';
        }

        try
        {
            $paramsArr = [
                'id' => $params['customfields'][HostingCustomField::SERVICE_ID],
                'type' => 'novnc'
            ];

            $call = new ServiceVncConsoleRequest(Configuration::create($params), $paramsArr);
            $response = $call->process();

            $response['vars']['novncAppUrl'] = ModuleConstants::getTemplatesDirForSmarty() . '/ProxmoxVPS/novnc';
            $response['path'] = ModuleConstants::getTemplatesDir() . '/ProxmoxVPS/novnc';

            if ($response['proxy'])
            {
                echo $this->getSmarty()->view($response['path'], $response['vars']);
                exit;
            }

            $this->cleanOutputBuffer();
            header('Location:' . $response['url']);
            exit;
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

    public function xTermConsole(array $params)
    {
        if (!$params['customfields'][HostingCustomField::SERVICE_ID])
        {
            return 'The custom field Service ID is empty.';
        }

        try
        {
            $paramsArr = [
                'id' => $params['customfields'][HostingCustomField::SERVICE_ID],
                'type' => 'xterm'
            ];

            $call = new ServiceXTermConsoleRequest(Configuration::create($params), $paramsArr);
            $response = $call->process();

            $response['vars']['appUrl'] = ModuleConstants::getTemplatesDirForSmarty() . '/ProxmoxVPS';
            $response['path'] = ModuleConstants::getTemplatesDir() . '/ProxmoxVPS/xtermjs';

            if ($response['proxy'])
            {
                echo $this->getSmarty()->view($response['path'], $response['vars']);
                exit;
            }

            $this->cleanOutputBuffer();
            header('Location:' . $response['url']);
            exit;
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

    public function spiceConsole(array $params)
    {
        if (!$params['customfields'][HostingCustomField::SERVICE_ID])
        {
            return 'The custom field Service ID is empty.';
        }

        try
        {
            $paramsArr = [
                'id' => $params['customfields'][HostingCustomField::SERVICE_ID],
                'type' => 'spice'
            ];

            $call = new ServiceSpiceConsoleRequest(Configuration::create($params), $paramsArr);
            $response = $call->process();

            header('Cache-Control: public');
            header('Content-Type: application/x-virt-viewer');
            header('Content-Transfer-Encoding: Binary');
            header('Content-Disposition: attachment; filename="' . $response['fileName'] . '"');

            echo $response['content'];
            exit;
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
}
