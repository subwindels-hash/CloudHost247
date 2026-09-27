<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HostingCustomField;

class AdminServicesTabFields implements AbstractAction
{
    protected $params;

    public function __construct($params)
    {
        $this->params = $params;
    }

    /**
     * @return array
     */
    public function process(): array
    {
        $isSSL = \ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\SSLSubmoduleChecker::check($this->params['serviceid']);

        $moduleObject = \ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\SubmoduleController::getCurrentModuleObject($this->params);
        return $moduleObject->getAAInfo($this->params) ?? [];
    }
}