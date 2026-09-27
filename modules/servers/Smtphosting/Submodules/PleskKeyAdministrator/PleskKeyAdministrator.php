<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\PleskKeyAdministrator;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HostingCustomField;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Lang\Lang;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\Dispatcher;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\DefaultSubmodule;
use \Carbon\Carbon;

/**
 * Class EasyDCIM
 * @method start
 * @method stop
 * @method reboot
 */
class PleskKeyAdministrator extends DefaultSubmodule
{
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
                $vars['details'] = array_merge($params['customfields'], parent::details($params));
                unset($vars['orderId']);
                unset($vars['serviceId']);
            }
            $vars['serviceStatus'] = $params['status'] === 'Active' && $vars['details']['serviceStatus'] === 'Active';;
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
