<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\FormConstants;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;

/**
 * Form Elements related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait Form
{
    protected $submit = null;
    protected $formType = FormConstants::UPDATE;
    protected $allowedActions = null;
    protected $confirmMessage = null;
    protected $translateConfirmMessage = true;
    protected $lang = null;
    protected $localLangReplacements = [];
    protected $defaultActions = [
        FormConstants::CREATE,
        FormConstants::READ,
        FormConstants::UPDATE,
        FormConstants::DELETE,
        FormConstants::REORDER,
    ];

    public function disableTranslateConfirmMessage()
    {
        $this->translateConfirmMessage = false;

        return $this;
    }

    public function isTranslateConfirmMessage()
    {
        return $this->translateConfirmMessage;
    }

    public function getAllowedActions()
    {
        if ($this->allowedActions === null)
        {
            $this->allowedActions = $this->getDefaultActions();
        }

        return $this->allowedActions;
    }

    public function addDefaultActions($defaultAction)
    {
        if (!in_array($defaultAction, $this->defaultActions, true))
        {
            $this->defaultActions[] = $defaultAction;
        }

        return $this;
    }

    public function removeDefaultAction($defaultAction)
    {
        if ($key = array_search($defaultAction, $this->defaultActions, true))
        {
            unset($this->defaultActions[$key]);
        }

        return $this;
    }

    protected function getDefaultActions()
    {
        return $this->defaultActions;
    }

    public function setAllowedActions(array $allowed)
    {
        $default = $this->getDefaultActions();

        $filtered = array_map(
            function (&$action) use ($default) {
                if (!in_array($action, $default))
                {
                    unset($action);
                }
            }
            , $allowed);

        if (count($filtered) > 0)
        {
            $this->allowedActions = $filtered;
        }

        return $this;
    }

    public function setFormType($type)
    {
        $default = $this->getAllowedActions();
        if (in_array($type, $default))
        {
            $this->formType = $type;
        }

        return $this;
    }

    public function setSubmit($button)
    {
        $this->submit = $button;

        return $this;
    }

    public function getSubmitHtml()
    {
        return ($this->submit === null) ? '' : $this->submit->getHtml();
    }

    public function getFormType()
    {
        return $this->formType;
    }

    public function setConfirmMessage($message, $replacementParams = [])
    {
        if (is_string($message))
        {
            $this->confirmMessage = $message;
        }

        $this->addLocalLangReplacements($replacementParams);

        return $this;
    }

    public function getConfirmMessage()
    {
        return $this->confirmMessage;
    }

    protected function loadLang()
    {
        if ($this->lang === null)
        {
            $this->lang = ServiceLocator::call('lang');
        }

        return $this;
    }

    protected function addLangReplacements()
    {
        $this->loadLang();

        foreach ($this->localLangReplacements as $key => $value)
        {
            if ($value === null)
            {
                $tmpVal = $this->getFieldValueByName($key);
                $value  = $tmpVal === null ? '' : $tmpVal;
            }

            $this->lang->addReplacementConstant($key, $value);
        }

        return $this;
    }

    protected function getFieldValueByName($fieldName = null)
    {
        foreach ($this->fields as $field)
        {
            if ($field->getName() === $fieldName)
            {
                return $field->getValue();
            }
        }

        return null;
    }

    protected function addLocalLangReplacements($replacementParams = [])
    {
        foreach ($replacementParams as $key => $value)
        {
            $this->localLangReplacements[$key] = $value ?: null;
        }

        return $this;
    }
}
