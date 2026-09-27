<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\CustomFields\Providers;

use ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Providers\Config;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ProductCustomField;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ResponseTemplates\HtmlDataJsonResponse;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\DataProviders\BaseDataProvider;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Product;

class CustomFields extends BaseDataProvider
{
    public function read()
    {
        $this->data['optionName'] = $this->getRequestValue('actionElementId');
    }

    public function create()
    {
        $customFields = $this->formData['customFields'];
        $product      = new Product($this->getRequestValue('id'));

        $productCustomFields = (new Config())->getCustomFieldsForResellerProduct();
        $fieldsToAdd         = [];
        foreach ($customFields as $fieldName => $isOn)
        {
            if ($isOn === 'on')
            {
                $key           = $this->extractCustomFieldKey($fieldName, $productCustomFields);
                $fieldsToAdd[] = $productCustomFields[$key];
            }
        }
        ProductCustomField::addIfNotExist($_REQUEST['id'], $fieldsToAdd);

        $response = new HtmlDataJsonResponse();

        if ($product->isConfigurableOptionsGroupCreated())
        {
            return $response->setMessageAndTranslate('customFieldsCreated');
        }

        return $response->setMessageAndTranslate('customFieldsUpdated');
    }

    public function update()
    {

    }

    public function getCustomFieldsList()
    {
        $cfg = new Config();
        return $cfg->getCustomFieldsForResellerProduct();

    }

    private function extractCustomFieldKey(string $fieldName, array $productCustomFields): int
    {
        return array_search($fieldName, array_map(
            function($fieldname) {
                return preg_replace("/[^A-Za-z0-9 ]/", '', $fieldname);
                },
            array_column($productCustomFields, 'fieldname')));
    }
}
