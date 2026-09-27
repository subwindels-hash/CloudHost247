<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\Filters;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\Filters\Helpers\Filter;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\Filters\Helpers\FilterInterface;

class Text extends \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\Text implements FilterInterface
{
    protected $id = 'textFilter';
    protected $name = 'textFilter';
    protected $title = 'textFilterTitle';

    protected $htmlAttributes = [
        '@keydown.enter' => 'searchDataEnter'
    ];

    protected $vueComponent = true;
    protected $defaultVueComponentName = 'mg-dt-text-filter';

    protected $parentId = null;
    protected $requiredToSearch = false;
    protected $searchDisablingValue = false;

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

    /**
     * if enabled, search will be not possible if the field will be empty
     */
    public function setRequiredToSearch()
    {
        $this->requiredToSearch = true;
    }

    public function isRequiredToSearch()
    {
        return $this->requiredToSearch;
    }
}
