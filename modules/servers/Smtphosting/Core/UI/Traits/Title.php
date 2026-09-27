<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;
// to do disable title

/**
 * Title elements related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait Title
{
    protected $title = null;
    protected $titleRaw = null;

    protected $showTitle = true;

    public function setTitle($title)
    {
        if (is_string($title) && $title !== '')
        {
            $this->title = $title;
        }

        return $this;
    }

    public function setRawTitle($title)
    {
        if (is_string($title) && $title !== '')
        {
            $this->titleRaw = $title;
        }

        return $this;
    }

    public function isRawTitle()
    {
        if ($this->titleRaw !== null)
        {
            return true;
        }

        return false;
    }

    public function getRawTitle()
    {
        return $this->titleRaw;
    }

    public function getTitle()
    {
        return $this->title;
    }

    public function setShowTitle()
    {
        $this->showTitle = true;
    }

    public function unsetShowTitle()
    {
        $this->showTitle = false;
    }

    public function isShowTitle()
    {
        return $this->showTitle;
    }
}
