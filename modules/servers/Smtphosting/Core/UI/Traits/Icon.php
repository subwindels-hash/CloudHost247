<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

/**
 * Icons related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait Icon
{
    protected $icon = null;

    public function getIcon()
    {
        if ($this->icon)
        {
            return $this->icon;
        }

        return false;
    }

    public function setIcon($iconClass)
    {
        $this->icon = $iconClass;

        return $this;
    }
}
