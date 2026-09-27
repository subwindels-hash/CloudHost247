<?php

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Hosting;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\SslOrders;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\SSLCENTERWHMCS\Libs\GenerateCSR;
use WHMCS\Database\Capsule as DB;

$hookManager->register(function ($vars) {
    $request = \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl('request');

    if ($request->get('action') == 'generateCsr')
    {
        $show = false;

        if ($vars['filename'] === 'configuressl' && $vars['loggedin'] == '1' && $request->get('action') === 'generateCsr')
        {
            $GenerateCsr = new GenerateCSR($vars, $_POST);
            echo $GenerateCsr->run();
            die();
        }
    }


    //only in step 2
    if (!$request->get('cert') || $request->get('step') != 2)
    {
        return;
    }

    $serviceId = SslOrders::where(DB::raw('MD5(id)'), $request->get('cert'))->first()->serviceid;

    $module = explode(DIRECTORY_SEPARATOR, __DIR__);

    $productId = Hosting::where('id', $serviceId)->first()->packageid;
    $product   = \WHMCS\Product\Product::where('id', $productId)
        ->where('servertype', '=', $module[count($module) - 5])
        ->first();
    if (!$product)
    {
        return;
    }


    $resellerProductType = strtolower((new Repository())->getProductSettings($product->id)['resellerProductType']);
    $pathExp             = explode(DIRECTORY_SEPARATOR, __DIR__);
    $directory           = strtolower($pathExp[count($pathExp) - 3]);
    if ($directory !== $resellerProductType)
    {
        return;
    }


    $file = dirname(__DIR__, 4) . DIRECTORY_SEPARATOR . "templates" . DIRECTORY_SEPARATOR . "assets" . DIRECTORY_SEPARATOR . "tpl" . DIRECTORY_SEPARATOR . "SSLCENTERWHMCS" . DIRECTORY_SEPARATOR . "stepTwo.tpl";
    $data = \ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\DataSingleton::getInstance();

    $fetchData['brand']                     = json_encode($data->getBrand());
    $fetchData['disabledValidationMethods'] = json_encode([]);

    $fetchData['approvalEmails']  = json_encode($data->getApprovalEmails());
    $fetchData['approvalMethods'] = json_encode($data->getApprovalMethods());
    $fetchData['fillVars']        = json_encode([]);
    $fetchData['sanEmails']       = $fetchData['approvalEmails'];
//    $fetchData['errorMessage'] = $data->getErrorMessage();
    return \ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\Smarty::fetch($file, $fetchData);
}, 100);