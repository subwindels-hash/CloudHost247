<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\SL\Data;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\SL\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\SL\Register;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\SL\Rewrite;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\SL\InterfaceConfig;

/**
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class DataSL
{
    /**
     * Exemple:
     *
     * array(
     *     0 => array(
     *         "name"   => string(className),
     *         "method" => string(static method),
     *         "args"   => array(
     *             string,
     *             number,
     *             object(set string ClassName)
     *         )
     *     )
     * )
     *
     * @var array()
     */
    private $configurations = [];

    /**
     * Exemple:
     *
     * array(
     *     string(aliens/className) => array(
     *         "namespace" => string,
     *         "alias"     => string,
     *         "singleton" => bool,
     *         "auto"      => bool
     *     )
     * )
     *
     * @var array()
     */
    private $register = [];

    /**
     * Exemple:
     *
     * array(
     *     string(old className) => string(new className)
     * )
     *
     * @var array()
     */
    private $rewrites = [];

    /**
     * Exemple:
     *
     * array(
     *     string(className) => string(aliens)
     * )
     *
     * @var array()
     */
    private $aliens = [];

    private $interfaceConfig = [];

    /**
     * Exemple:
     *
     * array(
     *     0 => string(aliens/className)
     * )
     *
     * @var array()
     */
    private $auto = [];

    public function __construct()
    {
        $this->getConfigurations();
        $this->getRewrites();
        //$this->getInterfaceConfig();
        $this->getRegisters();

    }

    /**
     * @return array()
     */
    public function getConfigurations()
    {
        if (empty($this->configurations) === true)
        {
            $this->configurations = Configuration::get();
        }

        return $this->configurations;
    }

    /**
     * @return array()
     */
    public function getInterfaceConfig()
    {
        if (empty($this->interfaceConfig) === true)
        {
            $this->interfaceConfig = InterfaceConfig::get();
        }

        return $this->interfaceConfig;
    }

    /**
     * @return array()
     */
    public function getRegisters()
    {
        if (empty($this->register) === true)
        {
            $this->register = Register::get();
            $this->loadRegistry();
        }

        return $this->register;
    }

    /**
     * @return array()
     */
    public function getRewrites()
    {
        if (empty($this->rewrites) === true)
        {
            $this->rewrites = Rewrite::get();
        }

        return $this->rewrites;
    }

    public function getAllAlias()
    {
        return $this->aliens;
    }

    /**
     * @param string $name
     * @param string|null $old
     * @return string
     */
    public function getRewrite($name, $old = null)
    {
        return array_key_exists($name, $this->getRewrites())
            ? (array_get($this->rewrites, $name) == $old)
                ? $name
                : $this->getRewrite(array_get($this->getRewrites(), $name), $name)
            : $name;
    }

    /**
     * @param string $name
     * @return boolean
     */
    public function isRewrite($name)
    {
        return array_key_exists($name, $this->getRewrites());
    }

    /**
     * @param string $name
     * @return string
     */
    public function getAlias($name)
    {
        return array_key_exists($name, $this->aliens) ? array_get($this->aliens, $name) : $name;
    }

    /**
     * @param string $name
     * @return boolean
     */
    public function getSingleton($name)
    {
        return array_key_exists($name, $this->getRegisters()) ? array_get($this->getRegisters(), $name)['singleton'] : true;
    }

    /**
     * @param string $name
     * @return boolean
     */
    public function isRegistry($name)
    {
        return array_key_exists($name, $this->getRegisters());
    }

    /**
     * @param string $name
     * @return string
     */
    public function getClassName($name)
    {
        return array_key_exists($name, $this->getRegisters()) ? $this->getRegisters()[$name]['class'] : $name;
    }

    /**
     * @return array()
     */
    public function getAutoRunRegisters()
    {
        return $this->auto;
    }

    private function loadRegistry()
    {
        $registres      = $this->register;
        $this->register = [];


        foreach ($registres as $registry)
        {
            $key     = (string)(preg_replace('/\s+/', '', $registry['alias']) == "")
                ? $registry['namespace']
                : $registry['alias'];
            $rewrite = $this->getRewrite((string)$registry['namespace']);

            if ($key == $registry['alias'])
            {
                $this->aliens[(string)$registry['namespace']]   = $key;
                $this->register[(string)$registry['namespace']] = [
                    'class'     => (string)$rewrite,
                    'singleton' => (bool)(int)$registry['singleton'],
                    'auto'      => (bool)(int)$registry['auto']
                ];
            }

            if ($rewrite != $registry['namespace'])
            {
                if ($key == $registry['alias'])
                {
                    $this->aliens[(string)$rewrite]   = $key;
                    $this->register[(string)$rewrite] = [
                        'class'     => (string)$rewrite,
                        'singleton' => (bool)(int)$registry['singleton'],
                        'auto'      => (bool)(int)$registry['auto']
                    ];
                }

                $this->register[(string)$rewrite] = [
                    'class'     => (string)$rewrite,
                    'singleton' => (bool)(int)$registry['singleton'],
                    'auto'      => (bool)(int)$registry['auto']
                ];
            }

            $this->register[(string)$key] = [
                'class'     => (string)$rewrite,
                'singleton' => (bool)(int)$registry['singleton'],
                'auto'      => (bool)(int)$registry['auto']
            ];
            if ($this->register[$key]['auto'] === false)
            {
                $this->auto[] = $this->register[$key]['class'];
            }
        }
    }
}
