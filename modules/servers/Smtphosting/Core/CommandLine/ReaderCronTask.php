<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\CommandLine;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\FileReader\Reader;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;

/**
 * Description of AbstractReaderYml
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class ReaderCronTask
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

    protected function load()
    {
        $this->data = $this->rebuildData($this->readYml(ModuleConstants::getFullPath('app', 'Config', 'cron.yml')));
    }

    protected function rebuildData($data)
    {
        $return = [];
        foreach ($data['list'] as $name => $isRun)
        {
            if ((bool)$isRun)
            {
                $return[] = $name;
            }
        }

        return $return;
    }

}
