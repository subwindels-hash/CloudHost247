<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\Datatable;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Helpers\ContainerElementsConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\Filters\Helpers\FilterInterface;

/**
 * Filters related functions
 * Filters Trait
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait Filters
{
    protected $filters = [];

    protected $filtersPerRow = 4;

    public function addFilter(FilterInterface $filter)
    {
        $this->initFiltersContainer();

        $filter->setParentId($this->id);
        $this->addElement($filter, ContainerElementsConstants::FILTERS);

        return $this;
    }

    /**
     * @return array
     */
    public function getFilters()
    {
        return $this->filters;
    }

    public function hasFilters()
    {
        if (count($this->filters) > 0)
        {
            return true;
        }

        return false;
    }

    protected function initFiltersContainer()
    {
        if (!$this->elementContainerExists(ContainerElementsConstants::FILTERS))
        {
            $this->addNewElementsContainer(ContainerElementsConstants::FILTERS);
        }
    }

    public function setFiltersPerRowCount($filtersCount = null)
    {
        $count = (int)$filtersCount;
        if ($count > 0)
        {
            $this->filtersPerRow = $count;
        }
    }

    /**
     * @return int
     */
    public function getFiltersPerRow()
    {
        return $this->filtersPerRow;
    }
}
