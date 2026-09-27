<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\FormInterface;

/**
 * Forms Elements related functions
 * In order to handle Multiple forms inside of modal
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait Forms
{
    /**
     * Forms List
     * @var Array
     */
    protected $forms = [];

    /**
     * Adds Form object to forms list
     * @return $this
     */
    public function addForm(FormInterface $form)
    {
        $form->setMainContainer($this->mainContainer);
        $this->forms[$form->getId()] = $form;

        if ($form instanceof \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AjaxElementInterface)
        {
            $this->mainContainer->addAjaxElement($form);
        }

        return $this;
    }

    /**
     * Returns Form object by form id
     * @return Form object
     */
    public function getForm($formId)
    {
        return $this->forms[$formId];
    }

    /**
     * Returns Form objects array
     * @return array
     */
    public function getForms()
    {
        return $this->forms;
    }
}
