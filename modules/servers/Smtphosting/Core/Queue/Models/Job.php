<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue\Models;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ExtendedEloquentModel;

/**
 * Class Job
 * @package ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Job\Models
 * @version 1.0.1
 * @var $job
 * @var $data
 * @var $parent_id
 * @var $rel_type
 * @var $rel_id
 * @var $custom_id
 * @var $status
 */
class Job extends ExtendedEloquentModel
{
    const STATUS_RUNNING  = 'running';
    const STATUS_FINISHED = 'finished';
    const STATUS_ERROR    = 'error';
    const STATUS_WAITING  = 'waiting';
    const STATUS_CANCELED = 'canceled';

    /**
     * @var string
     */
    protected $table = 'Job';

    /**
     * @return JobLog::class[]
     */
    public function logs()
    {
        return $this->hasMany(JobLog::class, 'job_id');
    }

    /**
     * @return Job::class[]
     */
    public function children()
    {
        return $this->hasMany(Job::class, 'parent_id');
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
    public function setFinished()
    {
        $this->setStatus(self::STATUS_FINISHED);

        return $this;
    }

    /**
     * @return $this
     */
    public function setWaiting()
    {
        $this->setStatus(self::STATUS_WAITING);

        return $this;
    }

    /**
     * @return $this
     */
    public function setError()
    {
        $this->setStatus(self::STATUS_ERROR);

        return $this;
    }

    /**
     * @return $this
     */
    public function setCanceled()
    {
        $this->setStatus(self::STATUS_CANCELED);

        return $this;
    }

    /**
     * @param $time
     * @return $this
     */
    public function setRetryAfter($time)
    {
        $this->retry_after = $time;
        $this->save();

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
    public function increaseRetryCount()
    {
        $this->retry_count++;
        $this->save();

        return $this;
    }

    public function getPospondTime()
    {
        if ($this->retry_count <= 3)
        {
            return 120;
        }

        if ($this->retry_count <= 6)
        {
            return 240;
        }

        if ($this->retry_count <= 12)
        {
            return 540;
        }

        return 3480;
    }

    public function pospond($isError = false)
    {
        $postponeTime = $this->getPospondTime();
        if ($isError === true)
        {
            $this->setError();
        }
        else
        {
            $this->setWaiting();
        }

        $this->setRetryAfter(date('Y-m-d H:i:s', (time() + $postponeTime)));

        return false;
    }
}
