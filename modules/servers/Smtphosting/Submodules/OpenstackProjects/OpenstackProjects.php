<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\OpenstackProjects;


use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\GetInfo;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HostingCustomField;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Lang\Lang;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\Dispatcher;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\DefaultSubmodule;

class OpenstackProjects extends DefaultSubmodule
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
                $vars = parent::details($params);
            }
            $vars['MGLANG']     = $this->lang;
            $vars['templateMG'] = Dispatcher::getTemplateForAction('clientarea');
            $vars['cssDir']     = ModuleConstants::getStylesDirForSmarty();
            $imgSrc             = ModuleConstants::getImagesDirForSmarty() . DIRECTORY_SEPARATOR . "OpenstackProjects" . DIRECTORY_SEPARATOR . "icon-panelLogin.png";
            $vars['imgSrc']     = $imgSrc;
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
}
