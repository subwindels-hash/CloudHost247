<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

/**
 * Forms Section Elements related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait Section
{
    protected $groupFieldsBySectionName = false;

    public function enableGroupBySectionName()
    {
        $this->groupFieldsBySectionName = true;

        return $this;
    }

    public function disableGroupBySectionName()
    {
        $this->groupFieldsBySectionName = false;

        return $this;
    }
}
