<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Packages;

use ModulesGarden\ProductsReseller\Server\Smtphosting\App\Config\Packages\WhmcsService;
use ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions\ConfigOptions;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\ProductsListRequest;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Facades\Cache;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Product;
use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl;

abstract class BasePackageConfiguration
{
    protected $configuration = null;
    protected $appConfigFound = false;

    static $protectedConfigOptions = [
        PackageConfigurationConst::VERSION,
        PackageConfigurationConst::PACKAGE_NAME
    ];

    public function __get($key)
    {
        $this->loadConfiguration();

        if (isset($this->configuration[$key]))
        {
            return $this->configuration[$key];
        }

        return null;
    }

    public function getConfig()
    {
        $this->loadConfiguration();

        return $this->configuration;
    }

    public function getName()
    {
        $this->loadConfiguration();
        return $this->configuration[PackageConfigurationConst::PACKAGE_NAME];
    }

    public function loadConfiguration($forceReload = false)
    {
        if (!($this->configuration === null || $forceReload))
        {
            return;
        }

        $config      = $this::CONFIGURATION;
        $packageName = $config[PackageConfigurationConst::PACKAGE_NAME];

        $appPackageConfig = $this->getAppPackageConfig($packageName);

        $merged = array_merge($config, $appPackageConfig);
        foreach (self::$protectedConfigOptions as $protectedOption)
        {
            $merged[$protectedOption] = $config[$protectedOption];
        }
        $this->configuration = $merged;
    }

    public function getAppPackageConfig($packageName = null)
    {
        $appConfigClassName = '\ModulesGarden\ProductsReseller\Server\Smtphosting\App\Config\Packages\\' . $packageName;
        if (!class_exists($appConfigClassName) || !is_subclass_of($appConfigClassName, AppPackageConfiguration::class)
            || !defined($appConfigClassName . '::APP_CONFIGURATION'))
        {

            return [];
        }

        $this->appConfigFound = true;

        return $appConfigClassName::APP_CONFIGURATION;
    }

    public function getConfigurationForResellerProduct()
    {
        $pid             = sl('request')->get('id');
        $productSettings = (new Repository())->getProductSettings($pid);

        $product = Product::findOrFail($pid);

        $productsInfoList = Cache::get(ConfigOptions::PRODUCT_LIST_CACHE_KEY);
        if (!$productsInfoList)
        {
            $call             = new  ProductsListRequest(Configuration::create($product->toArray()), []);
            $productsInfoList = $call->process();
            Cache::remember(ConfigOptions::PRODUCT_LIST_CACHE_KEY, $productsInfoList);
        }

        $configurableOptions = [];
        $customfields        = [];

        foreach ($productsInfoList['data'] as $product)
        {
            if ($product['id'] == $productSettings['resellerProductId'])
            {
                $configurableOptions = $product['configOptions'];
                $customfields        = $product['customFields'];
            }
        }
        return [
            WhmcsService::PACKAGE_STATUS => WhmcsService::APP_CONFIGURATION[WhmcsService::PACKAGE_STATUS],
            'customFields'               => $customfields,
            'configurableOptions'        => $configurableOptions
        ];

    }

    public function getBaseCustomFields()
    {

    }

}
