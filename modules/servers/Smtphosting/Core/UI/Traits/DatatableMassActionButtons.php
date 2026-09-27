<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;

trait DatatableMassActionButtons
{
    protected $massActionButtons = [];

    public function addMassActionButton($button)
    {
        if (is_string($button))
        {
            $button = ServiceLocator::call($button);
        }

        $button->setMainContainer($this->mainContainer);
        $id = $button->getId();
        if (!isset($this->massActionButtons[$id]))
        {
            $this->massActionButtons[$id] = $button;
            if ($button instanceof \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AjaxElementInterface)
            {
                $this->mainContainer->addAjaxElement($this->massActionButtons[$id]);
            }
        }

        return $this;
    }

    public function insertMassActionButton($buttonId)
    {
        if (!$this->massActionButtons[$buttonId])
        {
            //add exception
        }
        else
        {
            $button = $this->massActionButtons[$buttonId];

            return $button->getHtml();
        }

        return '';
    }

    public function hasMassActionButtons()
    {
        return (count($this->massActionButtons) > 0) ? true : false;
    }

    public function getMassActionButtons()
    {
        return $this->massActionButtons;
    }
}
