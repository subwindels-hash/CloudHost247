<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\CustomFields\Forms;

use ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\CustomFields\Providers\CustomFields;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Lang;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Helpers\AlertTypesConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\BaseForm;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\Switcher;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\FormConstants;

class AddCustomFields extends BaseForm implements AdminArea
{
    use Lang;

    protected $id = 'addCustomFieldsForm';
    protected $name = 'addCustomFieldsForm';
    protected $title = 'addCustomFieldsFormTitle';

    public function initContent()
    {
        $provider = new CustomFields();
        $this->setProvider($provider);

        $this->setFormType(FormConstants::CREATE);

        $this->loadLang();

        $this->addInternalAlert('customFieldsNameInfo', AlertTypesConstants::INFO, AlertTypesConstants::SMALL);

        $customfields = $provider->getCustomFieldsList();
        foreach ($customfields as $customfield)
        {
            $rawName = explode('|', $customfield['fieldname'])[0];
            $index   = preg_replace("/[^A-Za-z0-9 ]/", '', $customfield['fieldname']);
            $field   = new Switcher($index);
            $field->setRawTitle($rawName);
            $field->addGroupName('customFields');
            $field->setDefaultValue('on');
            $this->addField($field);
        }

        $this->loadDataToForm();
    }
}
