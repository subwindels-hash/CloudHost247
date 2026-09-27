<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

/**
 * Adds methods to handle requests form data
 * Requires using \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\RequestObjectHandler
 */
trait RequestFormDataHandler
{
    /**
     * list of form data passed in formData variable
     * @var array
     */
    protected $formData = null;
    protected $actionElementId = null;

    /**
     * loads form data from request object
     */
    protected function loadFormDataFromRequest()
    {
        $this->loadRequestObj();
        $this->getFormDataValues();
        $this->getActionElementIdValue();
        $this->getMassActionsValues();

        return $this;
    }

    /**
     * loads 'formData' from request object
     */
    protected function getFormDataValues()
    {
        if ($this->formData === null)
        {
            $this->formData = $this->getRequestValue('formData', []);
        }

        return $this->formData;
    }

    /**
     * loads 'actionElementId' from request object
     */
    protected function getActionElementIdValue()
    {
        if ($this->actionElementId === null)
        {
            $this->actionElementId = $this->getRequestValue('actionElementId', null);
        }

        return $this->actionElementId;
    }

    /**
     * loads 'massActions' from request object
     */
    protected function getMassActionsValues()
    {
        if ($this->massActions === null)
        {
            $this->massActions = $this->getRequestValue('massActions', []);
        }

        return $this->massActions;
    }
}
