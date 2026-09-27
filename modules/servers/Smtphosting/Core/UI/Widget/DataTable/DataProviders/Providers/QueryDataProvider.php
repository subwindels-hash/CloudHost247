<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\DataProviders\Providers;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\DataProviders\DataQuery;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\DataProviders\RawDataQuery;

/**
 *
 */
class QueryDataProvider extends \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\DataProviders\DataProvider
{
    private $query = null;
    protected $unset = false;

    public function unsetSort()
    {
        $this->unset = true;
        return $this;
    }

    public function setData($data = [], $params = [])
    {
        //todo in php 7.3 it will be ok (instead of this ugly if):
        // $this->query = ($data instanceof \Illuminate\Database\Query\Builder) ? new DataQuery($data) : new RawDataQuery($data, $params);

        if (is_array($data))
        {
            $this->query = new RawDataQuery($data, $params);
        }
        else
        {
            if ($data instanceof \Illuminate\Database\Query\Builder)
            {
                $this->query = new DataQuery($data);
            }
            else
            {
                return $this;
            }
        }

        if ($this->unset === false)
        {
            $this->query->setSorting($this->orderColumn, $this->orderDir);
        }

        $this->query->setLimit($this->limit);
        $this->query->setOffset($this->offset);
        $this->query->setSearch($this->toSearch);

        return $this;
    }

    public function getData(array $avalibleCols = [])
    {
        return $this->query->getData($avalibleCols);
    }

    public function setDefaultSorting($column, $direction)
    {
        if ((!$this->request->query->get('iSortCol_0') && !$this->request->query->get('sSortDir_0')) && $this->unset === false)
        {
            $this->setSortBy($column);
            $this->setSortDir($direction);
            if ($this->query)
            {
                $this->query->setSorting($column, $direction);
            }
        }

        return $this;
    }
}
