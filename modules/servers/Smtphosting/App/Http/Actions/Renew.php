<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HostingCustomField;

class Renew implements AbstractAction
{
    protected $params;

    public function __construct($params)
    {
        $this->params = $params;
    }

    public function process(): string
    {
        $postfields =
            [
                "id" => $this->params['customfields'][HostingCustomField::SERVICE_ID],
            ];
        $call       = new  Calls\ServiceRenewRequest(Configuration::create($this->params), $postfields);
        $result     = $call->process();
        return $result['error'] ?: 'success';
    }
}