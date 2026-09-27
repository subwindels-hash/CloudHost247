<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Hook;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Hook\Interfaces\InternalHook;

/**
 * This class is used to manage app(module) internal hooks
 */
class InternalHooksWrapper
{
    public function runInternalHook($name = null, $params = [])
    {
        if (!$name)
        {
            return $params;
        }

        $hookInstance = $this->getHookInstance($name, $params);
        if (!$hookInstance)
        {
            return $params;
        }

        try
        {
            $newParams = $hookInstance->execute();

            return $newParams;
        }
        catch (\Exception $exception)
        {
            $this->logException($exception);

            return $params;
        }
    }

    public function getHookInstance($name = null, $params = [])
    {
        $fullInstanceName = '\ModulesGarden\ProductsReseller\Server\Smtphosting\App\Hooks\InternalHooks\\' . $name;
        if (!class_exists($fullInstanceName))
        {
            return false;
        }

        try
        {
            $instance = new $fullInstanceName($params);
        }
        catch (\Exception $exception)
        {
            $this->logException($exception);

            return false;
        }
        if (!is_callable([$instance, 'execute']) || !($instance instanceof InternalHook))
        {
            return false;
        }

        return $instance;
    }

    public function logException($exception)
    {
        //todo
    }
}