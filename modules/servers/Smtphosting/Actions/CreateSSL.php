<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Actions;

use Exception;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\SslOrders;
use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl;

class CreateSSL
{
    protected $params;

    public function __construct($params = null)
    {
        $this->params = $params;
    }

    public function run(): void
    {
        $sslOrder            = new SslOrders();
        $sslOrder->userid    = $this->params['userid'];
        $sslOrder->serviceid = $this->params['serviceid'];
        $sslOrder->module    = "Smtphosting";
        $sslOrder->certtype  = ($this->params['configoptions']['productType']) ?: $this->params['configoption2'];
        $sslOrder->status    = "Awaiting Configuration";
        $sslOrder->save();

        $url = $this->prepareURL($sslOrder->id);

        $this->sendEmail($url);
    }

    public static function checkIfExistsForId($serviceId): void
    {
        $sslOrders = SslOrders::where('serviceid', $serviceId)->get();

        foreach ($sslOrders as $sslOrder)
        {
            if ($sslOrder->remoteid)
            {
                throw new Exception(sl('lang')->addReplacementConstant('service', $serviceId)->T('order', 'ssl', "certificateAlreadyExistsForServiceId"));
            }
        }
    }

    private function prepareURL(int $id): string
    {
        global $CONFIG;
        return '<a href="' . $CONFIG['SystemURL'] . '/configuressl.php?cert=' . md5($id) . '">' . $CONFIG['SystemURL'] . '/configuressl.php?cert=' . md5($id) . '</a>';
    }

    private function sendEmail(string $url): void
    {
        $postData = [
            'messagename' => 'SSL Certificate Configuration Required',
            'type'        => 'product',
            'id'          => $this->params['serviceid'],
            'customvars'  => base64_encode(serialize([
                'ssl_configuration_link' => $url
            ]))
        ];
        localAPI('SendEmail', $postData);
    }

}
