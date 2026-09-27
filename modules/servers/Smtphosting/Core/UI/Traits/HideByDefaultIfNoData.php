<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

/**
 * Icons related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait HideByDefaultIfNoData
{
    protected $hideByDefaultIfNoData = false;

    public function setHideByDefaultIfNoData()
    {
        $this->hideByDefaultIfNoData = true;

        return $this;
    }

    public function unsetHideByDefaultIfNoData()
    {
        $this->hideByDefaultIfNoData = false;

        return $this;
    }

    public function isHideByDefaultIfNoData()
    {
        return $this->hideByDefaultIfNoData;
    }
}
