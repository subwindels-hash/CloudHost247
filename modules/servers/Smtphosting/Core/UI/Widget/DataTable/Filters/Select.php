<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\Filters;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\Filters\Helpers\Filter;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\Filters\Helpers\FilterInterface;

class Select extends \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\Select implements FilterInterface
{
    protected $id = 'selectFilter';
    protected $name = 'selectFilter';
    protected $title = 'selectFilterTitle';

    protected $vueComponent = true;
    protected $defaultVueComponentName = 'mg-dt-select-filter';

    protected $parentId = null;

    public function setParentId($id)
    {
        $this->parentId = $id;
    }

    /**
     * @return null
     */
    public function getParentId()
    {
        return $this->parentId;
    }

    public function isVueRegistrationAllowed()
    {
        if ($this->getRequestValue('loadData') === $this->getParentId() && $this->getRequestValue('ajax') == 1)
        {
            return false;
        }

        return true;
    }

}
