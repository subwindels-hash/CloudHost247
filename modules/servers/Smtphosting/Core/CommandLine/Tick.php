<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\CommandLine;

/**
 * Count time between callback time. It requires declare(ticks = 1);
 * @package ModulesGarden\ProductsReseller\Server\Smtphosting\Core\CommandLine
 */
class Tick
{
    /**
     * @var callable
     */
    protected $callback = null;
    /**
     * @var int
     */
    protected $callbackTime = 0;
    /**
     * @var int
     */
    protected $callbackInterval = 5;

    /**
     * Tick constructor.
     * @param $callback
     * @param $time
     */
    public function __construct($callback, $time)
    {
        $this->callback     = $callback;
        $this->callbackTime = $time;
    }

    /**
     *
     */
    public function start()
    {
        register_tick_function(function () {
            $this->tick();
        }, true);
    }

    /**
     * @return int
     */
    public function getTimeFromLastCallback()
    {
        return time() - $this->callbackTime;
    }

    /**
     * Call callback if time diffeence is
     */
    public function tick()
    {
        $difference = $this->getTimeFromLastCallback();

        if ($difference > $this->callbackInterval)
        {
            $this->callbackTime = time();
            $callback           = $this->callback;

            $callback();
        }
    }
}
