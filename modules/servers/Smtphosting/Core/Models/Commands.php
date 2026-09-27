<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models;

/**
 * Class Commands
 * @property $uuid
 * @property $name
 * @property $parent_uuid
 * @property $status
 * @property $action
 * @package ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models
 */
class Commands extends ExtendedEloquentModel
{
    const STATUS_STOPPED  = 'stopped';
    const STATUS_RUNNING  = 'running';
    const STATUS_ERROR    = 'error';
    const STATUS_SLEEPING = 'sleeping';

    const ACTION_START  = 'start';
    const ACTION_STOP   = 'stop';
    const ACTION_REBOOT = 'reboot';
    const ACTION_NONE   = 'none';

    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'Commands';

    /**
     * @var string
     */
    protected $primaryKey = 'name';

    /**
     * @return bool
     */
    public function isStopped()
    {
        return $this->status === self::STATUS_STOPPED;
    }

    /**
     * @return bool
     */
    public function isRunning()
    {
        return $this->status === self::STATUS_RUNNING;
    }

    public function isSleeping()
    {
        return $this->status === self::STATUS_SLEEPING;
    }

    /**
     * @return $this
     */
    public function setRunning()
    {
        $this->setStatus(self::STATUS_RUNNING);

        return $this;
    }

    /**
     * @return $this
     */
    public function setStopped()
    {
        $this->setStatus(self::STATUS_STOPPED);

        return $this;
    }

    /**
     * @return $this
     */
    public function setSleeping()
    {
        $this->setStatus(self::STATUS_SLEEPING);

        return $this;
    }

    /**
     * @param $status
     * @return $this
     */
    public function setStatus($status)
    {
        $this->status = $status;
        $this->save();

        return $this;
    }

    /**
     * @return $this
     */
    public function start()
    {
        $this->setAction(self::ACTION_START);

        return $this;
    }

    /**
     * @return $this
     */
    public function stop()
    {
        $this->setAction(self::ACTION_STOP);

        return $this;
    }

    /**
     * @return $this
     */
    public function reboot()
    {
        $this->setAction(self::ACTION_REBOOT);

        return $this;
    }

    /**
     *
     */
    public function ping()
    {
        $this->save();
    }

    /**
     * @return $this
     */
    public function clearAction()
    {
        $this->setAction(self::ACTION_NONE);

        return $this;
    }

    /**
     * @param $action
     * @return $this
     */
    public function setAction($action)
    {
        $this->action = $action;
        $this->save();

        return $this;
    }

    /**
     * @return bool
     */
    public function shouldBeStopped()
    {
        return $this->action === self::ACTION_STOP;
    }

    public function shouldBeRestared()
    {
        return $this->action === self::ACTION_REBOOT;
    }
}
