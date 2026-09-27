<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;

trait DatatableActionButtons
{
    protected $actionButtons = [];

    public function addActionButton($button)
    {
        if (is_string($button))
        {
            $button = ServiceLocator::call($button);
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

        return $this;
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

    public function hasActionButtons()
    {
        return (count($this->actionButtons) > 0) ? true : false;
    }

    public function getActionButtons()
    {
        return $this->actionButtons;
    }
}
