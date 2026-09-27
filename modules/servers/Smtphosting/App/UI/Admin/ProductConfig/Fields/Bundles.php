<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Fields;

use ModulesGarden\ProductsReseller\Server\Smtphosting\App\Libs\AwsIntegration\ClientWrapper;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Lang;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\AjaxFields\Select;

class Bundles extends Select implements AdminArea
{
    use Lang;

    const LINUX_PLATFORM   = 'LINUX_UNIX';
    const WINDOWS_PLATFORM = 'WINDOWS';

    protected $id = 'bundles';
    protected $name = 'bundles';
    protected $title = 'bundles';

    /**
     * @var ClientWrapper $awsClient ;
     */
    protected $awsClient = null;

    protected $defaultVueComponentName = 'mg-ajax-select-with-data';

    public function prepareAjaxData()
    {
        $this->loadLang();

        $this->loadAwsClient();

        $this->setAvailableValues($this->loadAvailableBundles());

        $this->setSelectedValue($this->getSelectedBundle());
    }

    protected function loadAwsClient()
    {
        if (is_null($this->awsClient))
        {
            $productId = (int)$this->getRequestValue('id', 0);

            $this->awsClient = new ClientWrapper($productId, null, $this->getRequestValue('region', null));
        }
    }

    protected function loadAvailableBundles()
    {
        $platform = $this->getApiPlatformName();
        $list     = $this->awsClient->getBundles();

        $processed = [];
        foreach ($list as $bundle)
        {
            if (!in_array($platform, $bundle['supportedPlatforms']))
            {
                continue;
            }

            $this->lang->addReplacementConstant('bundleName', $bundle['name']);
            $this->lang->addReplacementConstant('bundleRam', $bundle['ramSizeInGb']);
            $this->lang->addReplacementConstant('bundleCPU', $bundle['cpuCount']);
            $this->lang->addReplacementConstant('bundleStorage', $bundle['diskSizeInGb']);
            $this->lang->addReplacementConstant('bundleTransfer', $bundle['transferPerMonthInGb']);

            $processed[] = [
                'key'   => $bundle['bundleId'],
                'value' => $this->lang->translate('bundleName') . " (" . $bundle['bundleId'] . ")"
            ];
        }

        return $processed;
    }

    /**
     * Name wrapper
     * @param $name
     * @return string
     */
    protected function getApiPlatformName()
    {
        switch ($this->getSelectedPlatform())
        {
            case 'linux':
                return self::LINUX_PLATFORM;
            default:
                return self::WINDOWS_PLATFORM;
        }
    }

    protected function getSelectedPlatform()
    {
        $requestPlatform = $this->getRequestValue('platform', null);

        if ($requestPlatform)
        {
            return $requestPlatform;
        }

        $productId = $this->getRequestValue('id');

        $settingRepo     = new Repository();
        $productSettings = $settingRepo->getProductSettings($productId);

        return ($productSettings['platform']) ?: 'linux';
    }

    protected function getSelectedBundle()
    {
        $productId = $this->getRequestValue('id');

        $settingRepo     = new Repository();
        $productSettings = $settingRepo->getProductSettings($productId);

        return ($productSettings['bundles']) ?: reset($this->getAvailableValues())['key'];
    }
}
