<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons\ModalActionButtons\BaseAcceptButton;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons\ModalActionButtons\BaseCancelButton;

/**
 * Modal Action Buttons related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait ModalActionButtons
{
    protected $actionButtons = [];

    public function addActionButton($button)
    {
        $this->addButtonToList($button);

        return $this;
    }

    protected function addButtonToList($button)
    {
        if (is_string($button))
        {
            $button = DependencyInjection::create($button);
        }

        $button->setMainContainer($this->mainContainer);
        $id = $button->getId();
        if (!isset($this->actionButtons[$id]))
        {
            $this->actionButtons[$id] = $button;
            if ($button instanceof \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AjaxElementInterface)
            {
                $this->mainContainer->addAjaxElement($this->actionButtons[$id]);
            }
        }

        return $button;
    }

    public function insertActionButton($buttonId)
    {
        if (!$this->actionButtons[$buttonId])
        {
            //add exception
        }
        else
        {
            $button = $this->actionButtons[$buttonId];

            return $button->getHtml();
        }

        return '';
    }

    public function getActionButtons()
    {
        $this->initActionButtons();

        return $this->actionButtons;
    }

    protected function initActionButtons()
    {
        if (!empty($this->actionButtons))
        {
            return $this;
        }

        $this->addActionButton(new BaseAcceptButton);
        $this->addActionButton(new BaseCancelButton);

        return $this;
    }

    public function replaceSubmitButton($button)
    {
        $this->initActionButtons();

        $added = $this->addButtonToList($button);
        if (isset($this->actionButtons[$added->getId()]) &&
            isset($this->actionButtons['baseAcceptButton']))
        {
            $this->actionButtons['baseAcceptButton'] = $this->actionButtons[$added->getId()];
            unset($this->actionButtons[$added->getId()]);
        }

        return $this;
    }

    public function replaceSubmitButtonClasses($classes)
    {
        $this->initActionButtons();

        if (isset($this->actionButtons['baseAcceptButton']))
        {
            $this->actionButtons['baseAcceptButton']->replaceClasses($classes);
        }

        return $this;
    }

    public function setSubmitButtonClassesDanger()
    {
        $this->replaceSubmitButtonClasses(['lu-btn lu-btn--danger submitForm']);

        return $this;
    }

    /**
     * Remove action button using action button object
     * @param $button
     * @return bool
     */
    public function removeActionButton($button)
    {
        foreach ($this->actionButtons as $key => $obj)
        {
            if ($obj === $button)
            {
                unset($this->actionButtons[$key]);

                return true;
            }
        }

        return false;
    }

    /**
     * Remove action button using index
     * @param $index
     * @return bool
     */
    public function removeActionButtonByIndex($index)
    {
        if (array_key_exists($index, $this->actionButtons))
        {
            unset($this->actionButtons[$index]);

            return true;
        }

        return false;
    }
}
