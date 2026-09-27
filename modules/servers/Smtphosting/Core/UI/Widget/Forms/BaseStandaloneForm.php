<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons\ButtonSubmitForm;

/**
 * BaseForm controler
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class BaseStandaloneForm extends BaseForm implements \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AjaxElementInterface, \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\FormInterface
{
    protected $id = 'baseStandaloneForm';
    protected $name = 'baseStandaloneForm';

    public function __construct($baseId = null)
    {
        parent::__construct($baseId);

        $this->getAllowedActions();

        $submitButton = new ButtonSubmitForm();
        $submitButton->setFormId($this->id);
        $submitButton->runInitContentProcess();
        $this->setSubmit($submitButton);
    }

    protected function loadDataToForm()
    {
        $this->loadProvider();
        $this->dataProvider->initData();
        foreach ($this->fields as &$field)
        {
            $field->setValue($this->dataProvider->getValueById($field->getId()));
            $avValues = $this->dataProvider->getAvailableValuesById($field->getId());
            if ($avValues && method_exists($field, 'setAvailableValues'))
            {
                $field->setAvailableValues($avValues);
            }

            if ($this->dataProvider->isDisabledById($field->getId()))
            {
                $field->disableField();
            }
        }

        foreach ($this->sections as &$section)
        {
            $section->loadDataToForm($this->dataProvider);
        }

        $this->addLangReplacements();
    }
}
