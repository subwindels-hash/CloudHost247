<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

trait Buttons
{
    protected $buttons = [];

    public function addButton($button)
    {
        $this->addElement($button, 'buttons');

        return $this;
    }

    public function insertButton($buttonId)
    {
        if (!$this->buttons[$buttonId])
        {
            //add exception
        }
        else
        {
            $button = $this->buttons[$buttonId];

            return $button->getHtml();
        }

        return '';
    }

    public function getButtons()
    {
        return $this->buttons;
    }

    public function getButtonsCount()
    {
        return count($this->buttons);
    }

    public function hasButtons()
    {
        return count($this->buttons) > 0;
    }
}
