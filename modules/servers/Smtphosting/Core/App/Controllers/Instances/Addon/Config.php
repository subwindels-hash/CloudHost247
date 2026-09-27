<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\Addon;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Interfaces\AddonController;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration\Data;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;

/**
 * Module configuration wrapper
 */
class Config extends \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\AddonController implements AddonController
{
    /**
     * @var array
     * list of params passed by WHMCS
     */
    private $params = [];

    /**
     * @var array
     * module configuration list
     */
    protected $config = [];

    /**
     * @var null|\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration\Data
     *
     */
    protected $data = null;

    /**
     * @var array
     * list of values to be returned as a part of
     */
    protected $configFields = [
        'name',
        'description',
        'version',
        'author',
        'fields',
        'systemName',
        'debug',
        'moduleIcon',
        'clientareaName'
    ];

    /**
     * @param array $params - WHMCS params for function _config
     * @return array
     */
    public function execute($params = [])
    {
        if (!$this->config)
        {
            $this->setParams($params);
            $this->loadConfig();

            return $this->getConfig();
        }

        return $this->config;
    }

    /**
     * @param array $params
     */
    protected function setParams($params = [])
    {
        if (is_array($params))
        {
            $this->params = $params;
        }
    }

    /**
     * loads module configuration from files yaml configs and moduleVersion.php
     */
    protected function loadConfig()
    {
        if (!$this->data)
        {
            $this->data = DependencyInjection::call(Data::class);
        }
    }

    /**
     * parses config data
     */
    public function getConfig()
    {
        if ($this->config)
        {
            return $this->config;
        }

        try
        {
            //Before loading the config
            $params = [];
            $return = ServiceLocator::call(\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration\Addon\Config\Before::class)->execute($params);

            foreach ($this->configFields as $field)
            {
                $value = $this->data->{$field};
                if (isset($return[$field]) === false && $value !== null)
                {
                    if (is_numeric($value))
                    {
                        $return[$field] = (int)$value;
                    }
                    else
                    {
                        $return[$field] = $value;
                    }
                }
            }

            //After loading the config
            $return = ServiceLocator::call(\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration\Addon\Config\After::class)->execute($return);

            $this->config = $return;

            return $return;
        }
        catch (\Exception $ex)
        {
            ServiceLocator::call(\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\ErrorManager::class)->addError(self::class, $ex->getMessage(), $return);

            return $return ?: [];
        }
    }

    public function getConfigValue($key, $defaultValue = null)
    {
        if (!$this->config)
        {
            $this->execute();
        }

        if (!isset($this->config[$key]))
        {
            return $defaultValue;
        }

        return $this->config[$key];
    }
}
