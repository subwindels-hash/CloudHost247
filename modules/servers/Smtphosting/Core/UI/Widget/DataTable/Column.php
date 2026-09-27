<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\DataProviders\DataProvider;

/**
 * Description of Configuration
 *
 * @author inbs
 */
class Column
{
    const TYPE_INT    = 'int';
    const TYPE_STRING = 'string';
    const TYPE_DATE   = 'date';
    protected $id;
    protected $name;
    protected $title;
    protected $rawTitle;
    protected $filter;
    protected $type = self::TYPE_STRING;
    protected $class;
    protected $orderable = false;
    protected $searchable = false;
    protected $orderableClass = '';
    protected $customJsDrawFunction = null;
    protected $tableName = null;

    public function __construct($name, $tableName = null)
    {
        $this->name  = $name;
        $this->id    = $name;
        $this->class = '';

        //will be taken from lang if possible
        $this->title = $name;

        if ($tableName)
        {
            $this->tableName = $tableName;
        }

        return $this;
    }

    public function setOrderable($isOrderable = true)
    {
        $allowed = [true, false, DataProvider::SORT_ASC, DataProvider::SORT_DESC];
        if (in_array($isOrderable, $allowed))
        {
            $this->orderable      = $isOrderable;
            $this->orderableClass = $this->getOrderableClass($isOrderable);
        }

        return $this;
    }

    public function setSearchable($isSearchable, $type = self::TYPE_STRING)
    {
        $this->searchable = (bool)$isSearchable;

        $this->setType($type);

        return $this;
    }

    public function setTitle($title)
    {
        $this->title = $title;

        return $this;
    }

    public function setRawTitle($title)
    {
        $this->rawTitle = $title;

        return $this;
    }

    public function setFilter(\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\Filters $filter)
    {
        $this->filter = $filter;

        return $this;
    }

    public function setClass($className)
    {
        $this->class = $className;

        return $this;
    }

    public function setType($type)
    {
        $allowed    = [self::TYPE_STRING, self::TYPE_DATE, self::TYPE_INT];
        $this->type = in_array($type, $allowed) ? $type : self::TYPE_STRING;

        return $this;
    }

    public function __get($name)
    {
        if (property_exists($this, $name))
        {
            return $this->{$name};
        }

        return null;
    }

    public function getOrderableClass($order)
    {
        if ($order === true)
        {
            return 'sorting';
        }

        $allowed = [DataProvider::SORT_ASC => 'sorting_asc', DataProvider::SORT_DESC => 'sorting_desc'];

        return $allowed[$order] ?: '';
    }

    public function setCustomJsDrawFunction($functionName)
    {
        $this->customJsDrawFunction = $functionName;

        return $this;
    }

    public function getCustomJsDrawFunction()
    {
        return $this->customJsDrawFunction;
    }

    public function setTableName($tableName)
    {
        if ($tableName)
        {
            $this->tableName = $tableName;
        }

        return $this;
    }

    public function getTableName()
    {
        return $this->tableName;
    }

    public function getFullName($wrapped = true)
    {
        $vWrapp = $wrapped ? '`' : '';

        if ($this->tableName)
        {
            return $vWrapp . $this->tableName . $vWrapp . '.' . $vWrapp . $this->name . $vWrapp;
        }

        return $vWrapp . $this->name . $vWrapp;
    }
}
