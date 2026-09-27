<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\TestConnectionRequest;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\AddonController;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Lang;

/**
 * Class MetaData
 *
 */
class TestConnection extends AddonController
{
    public function execute($params = null)
    {
        try
        {
            $call       = new  TestConnectionRequest(Configuration::create($params), []);
            $result     = $call->process();
            $isSuccess  = $result['result'] === 'success';
            $errMessage = $result['error'];
        }
        catch (\Exception $e)
        {
            $isSuccess  = false;
            $errMessage = "API Error: " . $e->getMessage();
        }

        return [
            'success' => $isSuccess,
            'error'   => $errMessage
        ];
    }
}
