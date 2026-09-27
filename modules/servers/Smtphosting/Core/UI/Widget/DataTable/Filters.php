<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable;

/**
 * Description of Filters
 *
 * @author inbs
 */
abstract class Filters
{
    protected $name = '';
    protected $data = null;
    protected $records = [];

    public function __construct(array $records = [], $name = '', $data = null)
    {

        $this->name    = $name;
        $this->data    = $data;
        $this->records = $records;

        $this->loadFilter();
    }

    abstract protected function loadFilter();

    /**
     * @return array
     */
    public function getRecords()
    {
        return $this->records;
    }

    public static function create(array $records = [], $name = '', $data = null)
    {
        if (count($records) != 0)
        {
            $instance = new static($records, $name, $data);
            $records  = $instance->getRecords();
        }
        return $records;
    }
}
