<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers;


use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Hosting;
use WHMCS\Product\Product;

class SSLSubmoduleChecker
{
    public static function check(string $id): bool
    {
        $pid                 = Hosting::where('id', $id)->first()->packageid;
        $resellerProductType = (new Repository())->getProductSettings($pid)['resellerProductType'];
        $class               = "ModulesGarden\\ProductsReseller\\Server\\Smtphosting\\Submodules\\{$resellerProductType}\\{$resellerProductType}";
        return method_exists($class, "sslStepOne");
    }

    public static function checkByName(string $id): bool
    {
        $pid                 = Hosting::where('id', $id)->first()->packageid;
        $resellerProductType = (new Repository())->getProductSettings($pid)['resellerProductType'];
        return strpos(strtolower($resellerProductType), 'ssl') !== false;
    }
}