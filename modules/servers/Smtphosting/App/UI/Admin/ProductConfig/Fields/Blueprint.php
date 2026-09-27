<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Fields;

use ModulesGarden\ProductsReseller\Server\Smtphosting\App\Libs\AwsIntegration\ClientWrapper;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\AjaxFields\Select;

class Blueprint extends Select implements AdminArea
{
    const LINUX_PLATFORM   = 'LINUX_UNIX';
    const WINDOWS_PLATFORM = 'WINDOWS';

    protected $id = 'blueprint';
    protected $name = 'blueprint';
    protected $title = 'blueprint';

    /**
     * @var ClientWrapper $awsClient ;
     */
    protected $awsClient = null;

    protected $defaultVueComponentName = 'mg-ajax-select-with-data';

    public function prepareAjaxData()
    {
        $this->loadAwsClient();

        $this->setAvailableValues($this->loadAvailableBlueprint());

        $this->setSelectedValue($this->getSelectedBlueprint());
    }

    protected function loadAwsClient()
    {
        if (is_null($this->awsClient))
        {
            $productId = (int)$this->getRequestValue('id', 0);

            $this->awsClient = new ClientWrapper($productId, null, $this->getRequestValue('region', null));
        }
    }

    protected function loadAvailableBlueprint()
    {
        $platform = $this->getApiPlatformName();
        $list     = $this->awsClient->getBlueprints();

        $processed = [];
        foreach ($list as $blueprint)
        {
            if ($blueprint['platform'] != $platform)
            {
                continue;
            }
            $processed[] = [
                'key'   => $blueprint['blueprintId'],
                'value' => $blueprint['name'] . ' ' . $blueprint['version']
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

    protected function getSelectedBlueprint()
    {
        $productId = $this->getRequestValue('id');

        $settingRepo     = new Repository();
        $productSettings = $settingRepo->getProductSettings($productId);

        return ($productSettings['blueprint']) ?: reset($this->getAvailableValues())['key'];
    }
}
