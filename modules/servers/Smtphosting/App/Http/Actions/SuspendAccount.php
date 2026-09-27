<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HostingCustomField;

class SuspendAccount implements AbstractAction
{
    protected $params;

    public function __construct($params)
    {
        $this->params = $params;
    }

    /**
     * @return string
     * @throws \Exception
     */
    public function process(): string
    {
        $postfields =
            [
                "id" => $this->params['customfields'][HostingCustomField::SERVICE_ID]
            ];
        $call       = new  Calls\ServiceSuspendRequest(Configuration::create($this->params), $postfields);
        $result     = $call->process();
        return $result['error'] ?: 'success';
    }
}