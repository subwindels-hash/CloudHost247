<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\DataProviders;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\DataProviders\DataProvider;

/**
 *
 */
class DataQuery
{
    private $query = null;
    private $limit = 10;
    private $offset = 0;
    private $orderColumn = false;
    private $orderDir = false;
    private $avalibleCols = [];
    private $toSearch = false;
    private $response;

    //\Illuminate\Database\Query\Builder
    public function __construct($query)
    {
        $this->query    = $query;
        $this->response = new DataSet();
    }

    public function getData(array $avalibleCols = [])
    {
        $this->avalibleCols = $avalibleCols;
        if ($this->query)
        {
            $this->addSearch()
                ->addSorting()
                ->countRawResults()
                ->addLimit();

            $this->response->records = $this->query->get();

            return $this->response;
        }

        return $this->response;
    }

    public function countRawResults()
    {
        $this->response->fullDataLenght = $this->query->getCountForPagination();

        return $this;
    }

    public function addSearch()
    {
        if (!$this->toSearch)
        {
            return $this;
        }

        $searchable = [];
        foreach ($this->avalibleCols as $column)
        {
            if ($column->searchable === true)
            {
                $searchable[] = $column;
            }
        }

        if (count($searchable) > 0)
        {
            $this->query->where(function ($query) use ($searchable) {
                foreach ($searchable as $key => $value)
                {
                    $searchWraper = $value->type === $value::TYPE_INT ? '' : '%';
                    if (($key === 0 && $value->type !== $value::TYPE_INT) || ($key === 0 && $value->type === $value::TYPE_INT && is_numeric($this->toSearch)))
                    {
                        $query->whereRaw(($value->type === $value::TYPE_INT ? '' : 'LOWER(') . $value->getFullName(true) . ($value->type === $value::TYPE_INT ? ' LIKE ? ' : ') LIKE ? '),
                            [$searchWraper . ($value->type === $value::TYPE_INT ? $this->toSearch : strtolower($this->toSearch)) . $searchWraper]);
                    }
                    elseif (($value->type !== $value::TYPE_INT) || ($value->type === $value::TYPE_INT && is_numeric($this->toSearch)))
                    {
                        $query->orWhereRaw(($value->type === $value::TYPE_INT ? '' : 'LOWER(') . $value->getFullName(true) . ($value->type === $value::TYPE_INT ? ' LIKE ? ' : ') LIKE ? '),
                            [$searchWraper . strtolower($this->toSearch) . $searchWraper]);
                    }
                }
            });
        }

        return $this;
    }

    public function setLimit($limit)
    {
        $this->limit = (int)$limit;

        return $this;
    }

    public function setSearch($toSearch)
    {
        $this->toSearch = $toSearch;

        return $this;
    }

    public function setOffset($offset)
    {
        $this->offset = (int)$offset;

        return $this;
    }

    protected function addLimit()
    {
        $this->query->offset($this->offset);
        $this->query->limit($this->limit);
        $this->response->offset = $this->offset;

        return $this;
    }

    protected function addSorting()
    {
        if ($this->orderColumn && $this->orderDir) //&& $this->isProperColumn($this->orderColumn))
        {

            $find = null;
            foreach ($this->avalibleCols as $column)
            {
                if ($this->orderColumn === $column->name)
                {
                    $find = $column;
                    break;
                }
            }

            if ($find)
            {
                $this->query->orderBy($find->getFullName(false), $this->orderDir);
            }

        }

        return $this;
    }

    public function setSorting($colName, $sortDir = DataProvider::SORT_ASC)
    {
        $this->orderColumn = $colName;
        $this->orderDir    = (strtolower($sortDir) === strtolower(DataProvider::SORT_DESC)) ? DataProvider::SORT_DESC : DataProvider::SORT_ASC;

        return $this;
    }

    protected function isProperColumn($colName)
    {
        foreach ($this->avalibleCols as $column)
        {
            if ($colName === $column->name)
            {
                return true;
            }
        }

        return false;
    }
}
