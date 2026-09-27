<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;
// to do disable title

/**
 * Title elements related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait WidgetView
{
    protected $isViewHeader = true;
    protected $isViewFooter = true;
    protected $isViewTopBody = true;

    public function enabledViewHeader()
    {
        $this->isViewHeader = true;

        return $this;
    }

    public function disabledViewHeader()
    {
        $this->isViewHeader = false;

        return $this;
    }

    public function isViewHeader()
    {
        return $this->isViewHeader;
    }

    public function enabledViewFooter()
    {
        $this->isViewFooter = true;

        return $this;
    }

    public function disabledViewFooter()
    {
        $this->isViewFooter = false;

        return $this;
    }

    public function isViewFooter()
    {
        return $this->isViewFooter;
    }

    public function enabledViewTopBody()
    {
        $this->isViewTopBody = true;

        return $this;
    }

    public function disabledViewTopBody()
    {
        $this->isViewTopBody = false;

        return $this;
    }

    public function isViewTopBody()
    {
        return $this->isViewTopBody;
    }
}
