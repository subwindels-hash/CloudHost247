<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Config;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Packages\BasePackageConfiguration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Packages\PackageConfigurationConst;

class PackageConfiguration extends BasePackageConfiguration
{
    const CONFIGURATION =
        [
            PackageConfigurationConst::PACKAGE_NAME => 'WhmcsService',
            PackageConfigurationConst::VERSION      => '1.0.0'
        ];

    public static function getPackageName()
    {
        return self::CONFIGURATION[PackageConfigurationConst::PACKAGE_NAME];
    }
}
