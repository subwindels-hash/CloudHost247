<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Facades;


abstract class Facade
{
    protected static $cache;

    public static function __callStatic(string $name, array $arguments)
    {
        $class = static::$cache;
        return call_user_func_array([$class, $name], $arguments);
    }
}