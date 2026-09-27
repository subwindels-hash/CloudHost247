<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Fields;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Lang;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\AjaxFields\Select;

class Platform extends Select implements AdminArea
{
    use Lang;

    protected $id = 'platform';
    protected $name = 'platform';
    protected $title = 'platform';

    public function prepareAjaxData()
    {
        $this->loadLang();

        $this->setAvailableValues($this->loadAvailablePlatform());

        $this->setSelectedValue($this->getSelectedPlatform());
    }

    protected function loadAvailablePlatform()
    {
        return [
            [
                'key'   => 'linux',
                'value' => $this->lang->translate('linux')
            ],
            [
                'key'   => 'windows',
                'value' => $this->lang->translate('windows')
            ]

        ];
    }

    protected function getSelectedPlatform()
    {
        $productId = $this->getRequestValue('id');

        $settingRepo     = new Repository();
        $productSettings = $settingRepo->getProductSettings($productId);

        return ($productSettings['platform']) ?: reset($this->getAvailableValues())['key'];
    }
}
