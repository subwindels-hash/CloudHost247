<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\Provisioning\Config;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Packages\BasePackageConfiguration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Packages\PackageConfigurationConst;

class PackageConfiguration extends BasePackageConfiguration
{
    const CONFIGURATION =
        [
            PackageConfigurationConst::PACKAGE_NAME => 'Provisioning',
            PackageConfigurationConst::VERSION      => '1.0.0'
        ];
}
