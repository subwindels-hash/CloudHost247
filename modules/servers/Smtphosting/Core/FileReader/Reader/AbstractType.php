<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\FileReader\Reader;

/**
 * Description of AbstractType
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
abstract class AbstractType
{
    protected $data = [];
    protected $renderData = [];
    protected $file = '';
    protected $path = '';

    public function __construct($file, $path, $renderData = [])
    {
        $this->file       = $file;
        $this->path       = $path;
        $this->renderData = $renderData;
        $this->loadFile();
    }

    abstract protected function loadFile();

    public function get($key = null, $default = null)
    {
        if ($key == null)
        {
            return $this->data;
        }

        if ($this->isExist($key))
        {
            return $this->data[$key];
        }

        return $default;
    }

    protected function isExist($key)
    {
        if (isset($this->data[$key]) || array_key_exists($key, $this->data))
        {
            return true;
        }
    }
}
