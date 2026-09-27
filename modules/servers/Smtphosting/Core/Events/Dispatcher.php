<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Events;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection\Container;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue\DatabaseQueue;

class Dispatcher extends \Illuminate\Events\Dispatcher
{
    public function __construct(Container $container)
    {
        $this->container = $container;

        $this->initialize();
    }

    /**
     *
     */
    protected function initialize()
    {
        /**
         * Load available events
         */
        $path   = ModuleConstants::getFullPath('app', 'Config', 'events.php');
        $config = include($path);


        foreach ($config as $event => $listeners)
        {
            foreach ($listeners as $listener)
            {
                $this->listen($event, $listener);
            }
        }

        /**
         * Set queue resolver
         */
        $this->setQueueResolver(function () {
            return DependencyInjection::create(DatabaseQueue::class);
        });
    }

    /**
     * @param $class
     * @param $arguments
     */
    public function queue($class, $arguments, $parentId = null, $relType = null, $relId = null, $customId = null)
    {
        $class = implode('@', $this->parseClassCallable($class));

        return $this->resolveQueue()->push("$class", serialize($arguments), $parentId, $relType, $relId, $customId);
    }

    /**
     * @param $class
     * @param $method
     * @override
     * @return \Closure
     */
    protected function createQueuedHandlerCallable($class, $method)
    {
        return function () use ($class, $method) {
            $arguments = $this->cloneArgumentsForQueueing(func_get_args());

            if (method_exists($class, 'queue'))
            {
                $this->callQueueMethodOnHandler($class, $method, $arguments);
            }
            else
            {
                $this->resolveQueue()->push("{$class}@{$method}", serialize($arguments));
            }
        };
    }
}