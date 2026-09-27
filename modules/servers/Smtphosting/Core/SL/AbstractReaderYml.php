<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\SL;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\FileReader\Reader;

/**
 * Description of AbstractReaderYml
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
abstract class AbstractReaderYml
{
    /**
     * @var array
     */
    protected $data = [];

    public function __construct()
    {
        if (count($this->data) == 0)
        {
            $this->load();
        }
    }

    public function getData()
    {
        return $this->data;
    }

    protected function readYml($name)
    {
        return Reader::read($name)->get();
    }

    public static function get()
    {

        $instance = new static;
        return $instance->getData();
    }

    abstract protected function load();
}
