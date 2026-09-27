<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;
// to do disable title

/**
 * Title elements related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait TitleButtons
{
    protected $titleButtons = [];

    public function removeTitleButtons()
    {
        $this->titleButtons = [];

        return $this;
    }

    public function addTitleButton($button)
    {
        if (is_string($button))
        {
            $button = DependencyInjection::create($button);
        }

        $button->setMainContainer($this->mainContainer);
        $id = $button->getId();
        if (!isset($this->titleButtons[$id]))
        {
            $this->titleButtons[$id] = $button;
            if ($button instanceof \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AjaxElementInterface)
            {
                $this->mainContainer->addAjaxElement($this->titleButtons[$id]);
            }
        }

        return $this;
    }

    public function titleButtonIsExist()
    {
        return (count($this->titleButtons) > 0);
    }

    public function insertTitleButton($buttonId)
    {
        if (!$this->titleButtons[$buttonId])
        {
            //add exception
        }
        else
        {
            $button = $this->titleButtons[$buttonId];

            return $button->getHtml();
        }

        return '';
    }

    public function getTitleButtons()
    {
        return $this->titleButtons;
    }
}
