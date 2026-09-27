<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Traits;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Packages\PackageManager;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Config\Enum;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Config\PackageConfiguration;

trait ConfigurableOptionsConfig
{
    protected $configOptionsList = [];

    protected function loadConfigurableOptionsList()
    {
        if (!$this->configOptionsList)
        {
            $packageManager = new PackageManager();
            $config         = $packageManager->getPackageConfiguration(PackageConfiguration::getPackageName());

            $this->configOptionsList = $config->{Enum::CONFIGURABLE_OPTIONS};
        }
    }

    public function trimConfigOptionName($name = null)
    {
        if (is_string($name) && trim($name) !== '' && stripos($name, '|') > 0)
        {
            $parts = explode('|', $name);

            return $parts[0];
        }

        return $name;
    }

    public function getConfigurableOptionConfigParams($optionName = null)
    {
        $this->loadConfigurableOptionsList();

        foreach ($this->configOptionsList as $optConfig)
        {
            if (!$optConfig || !is_array($optConfig))
            {
                continue;
            }

            if ($optConfig[Enum::OPTION_NAME] === $optionName || $this->trimConfigOptionName($optConfig[Enum::OPTION_NAME]) === $optionName)
            {
                return $optConfig;
            }
        }

        return false;
    }
}
