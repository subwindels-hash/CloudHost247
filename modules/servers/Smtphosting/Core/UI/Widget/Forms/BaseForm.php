<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder\BaseContainer;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ResponseTemplates;
use function \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl;

/**
 * BaseForm controler
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class BaseForm extends BaseContainer implements \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AjaxElementInterface, \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\FormInterface
{

    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\Form;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\Fields;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\Sections;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\FormDataProvider;

    protected $id = 'baseForm';
    protected $name = 'baseForm';
    protected $formAction = null;
    protected $requestObj = null;

    protected $htmlAttributes = [
        'onsubmit' => 'return false;'
    ];

    public function __construct()
    {
        parent::__construct();

        $formAction = $this->getRequestValue('mgformtype', false);
        if ($formAction === FormConstants::RELOAD)
        {
            $this->formAction = $formAction;
        }
    }

    public function returnAjaxData()
    {
        $this->loadProvider();
        $this->formAction = $this->getRequestValue('mgformtype', false);

        $resp = new ResponseTemplates\HtmlDataJsonResponse();

        $resp->setCallBackFunction($this->getCallBackFunction());
        $resp->setRefreshTargetIds($this->refreshActionIds);

        if (!$this->isFormActionValid())
        {
            return $resp->setMessageAndTranslate('undefinedAction')->setStatusError();
        }

        $this->reloadFormStructure();

        if (!$this->validateForm())
        {
            $resp = new ResponseTemplates\RawDataJsonResponse();
            $resp->setCallBackFunction($this->getCallBackFunction());

            return $resp->setMessageAndTranslate('formValidationError')->setStatusError()->setData(['FormValidationErrors' => $this->validationErrors]);
        }

        $response = $this->dataProvider->{$this->formAction}();
        if ($response instanceof \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\ResponseInterface)
        {
            return $response;
        }

        return $resp->setMessageAndTranslate('changesHasBeenSaved');
    }

    protected function validateForm()
    {
        if (in_array($this->formAction, [FormConstants::READ, FormConstants::REORDER, FormConstants::RELOAD]))
        {
            return true;
        }

        $this->validateFields($this->request);
        $this->validateSections($this->request);

        if (count($this->validationErrors) > 0)
        {
            return false;
        }

        return true;
    }

    protected function isReadDatatoForm()
    {
        if (!$this->formAction)
        {
            $this->formAction = $this->getRequestValue('mgformtype', false);
        }

        return ($this->formAction && ($this->formAction === FormConstants::READ || $this->formAction === FormConstants::REORDER
                                      || $this->formAction === FormConstants::RELOAD));
    }

    protected function loadDataToForm()
    {
        if (!sl('request')->get('ajax') || !$this->isReadDatatoForm())
        {
            return;
        }

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

    protected function isFormActionValid()
    {
        if ($this->formAction === false || !in_array($this->formAction, $this->getAllowedActions())
            || !method_exists($this->dataProvider, $this->formAction))
        {
            return false;
        }

        return true;
    }

    protected function loadDataToFormByName()
    {
        $this->loadProvider();
        foreach ($this->fields as &$field)
        {
            $field->setValue($this->dataProvider->getValueByName($field->getName()));
            if ($this->dataProvider->isDisabledById($field->getId()))
            {
                $field->disableField();
            }
        }

        foreach ($this->sections as &$section)
        {
            $section->loadDataToFormByName($this->dataProvider);
        }

        $this->addLangReplacements();
    }

    protected function runFormAction()
    {
        $this->dataProvider->{$this->formAction}();
    }

    protected function reloadFormStructure()
    {
        //to be overwritten
    }

    protected function reloadForm()
    {
        if ($this->formAction === FormConstants::RELOAD)
        {
            $this->reloadFormStructure();

            $this->runFormAction();
        }
    }

    public function getHtml()
    {
        $this->reloadForm();

        if ($this->html === '')
        {
            $this->buildHtml();
        }

        return $this->html;
    }
}
