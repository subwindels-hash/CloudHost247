<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HostingCustomField;

class TerminateAccount implements AbstractAction
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
                "id" => $this->params['customfields'][HostingCustomField::SERVICE_ID],
            ];

        \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\SslOrders::where('serviceid', $this->params['serviceid'])->delete();
        $call   = new  Calls\ServiceTerminateRequest(Configuration::create($this->params), $postfields);
        $result = $call->process();
        //save custom fields
        $customFiled = (new HostingCustomField($this->params['pid'], $this->params['serviceid'], HostingCustomField::SERVICE_ID))->update("");
        $customFiled = (new HostingCustomField($this->params['pid'], $this->params['serviceid'], HostingCustomField::ORDER_ID))->update("");
        return $result['error'] ?: 'success';
    }
}