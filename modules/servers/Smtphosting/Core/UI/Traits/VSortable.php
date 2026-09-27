<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

/**
 * VSortable related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait VSortable
{
    protected $vSortable = false;

    public function isvSortable()
    {
        return $this->vSortable;
    }

    public function setvSortable()
    {
        $this->vSortable = true;
    }

    public function unsetvSortable()
    {
        $this->vSortable = false;
    }
}
