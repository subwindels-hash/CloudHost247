<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\SL\Data\DataSL;

class Builder
{
    /**
     * @var DataSL
     */
    protected $data = null;

    /**
     * @var array
     */
    protected $registers = [];

    public function __construct()
    {
        $this->init();
        $this->loadAliases();
        $this->loadRewrites();
        $this->loadInstances();
    }

    protected function init()
    {
        Container::setInstance(new Container());

        $this->data = new DataSL();

        $this->registers = $this->data->getRegisters();
    }

    protected function loadRewrites()
    {
        foreach ($this->data->getRewrites() as $alias => $className)
        {
            Container::getInstance()->alias($className, $alias);
        }
    }

    protected function loadAliases()
    {
        foreach ($this->data->getAllAlias() as $className => $alias)
        {
            Container::getInstance()->alias($className, $alias);
        }
    }

    protected function loadInstances()
    {
        foreach ($this->data->getConfigurations() as $config)
        {
            $className = $config['name'];
            $method    = $config['method'];
            $arguments = $config['args'];


            if (!$method)
            {
                $obj = Container::getInstance()->make($className);
            }
            else
            {
                $obj = call_user_func_array("$className::$method", $arguments);
            }

            if (array_key_exists($className, $this->registers) && $this->registers[$className]['singleton'])
            {
                Container::getInstance()->instance($className, $obj);
            }
        }
    }
}