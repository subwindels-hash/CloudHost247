<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\GoDaddySSL;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\GetInfo;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HostingCustomField;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\SslOrders;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\Dispatcher;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\DefaultSSLSubmodule;
use WHMCS\Product\Product;

class GoDaddySSL extends DefaultSSLSubmodule
{
    public function getInfo(array $params)
    {
        try
        {
            $product    = Product::findOrFail($params['pid']);
            $postfields = ["id" => $params['customfields'][HostingCustomField::SERVICE_ID]];
            $sslInfo    = new GetInfo(Configuration::create($product->toArray()), $postfields);
            $sslOrder   = SslOrders::where('serviceid', $params['serviceid'])->first();
            $sslData    = $sslInfo->process()['result'];
            $certInfo   = $sslInfo->process()['certInfo'];

            $vars           = [];
            $vars['MGLANG'] = $this->lang;
            $vars['isSSL']  = true;

            if (!$sslOrder)
            {
                throw new \Exception('SSL Order not found');
            }


            if ($sslOrder->status == 'Awaiting Configuration')
            {
                $vars['configURL'] = 'configuressl.php?cert=' . md5($sslOrder->id);
            }
            else
            {
                if ($certInfo['certificate']['status'])
                {
                    $vars['status'] = $certInfo['certificate']['status'];
                }

                if ($sslData['certtype'])
                {
                    $vars['productType'] = $sslData['certtype'];
                }

                if ($certInfo['certificate']['commonName'])
                {
                    $vars['commonName'] = $certInfo['certificate']['commonName'];
                }

                if ($certInfo['period'])
                {
                    $vars['period'] = $certInfo['period'];
                }

                if ($certInfo['certificate']['validEnd'])
                {
                    $vars['expiryDate'] = date('Y-m-d h:i:s', strtotime($certInfo['certificate']['validEnd']));
                }

                if ($certInfo['download']['pems']['certificate'])
                {
                    $vars['cert'] = $certInfo['download']['pems']['certificate'];
                }

            }

            $vars['templateMG'] = Dispatcher::getTemplateForAction('home');
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

    public function getAAInfo($params)
    {

    }
}
