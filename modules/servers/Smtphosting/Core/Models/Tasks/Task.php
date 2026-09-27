<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Tasks;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ExtendedEloquentModel;

/**
 * Class Task
 * @property $status
 * @property job_id
 * @property $model
 * @property $namespace
 * @property $rel_id
 * @package ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Tasks
 */
class Task extends ExtendedEloquentModel
{
    const CANCELLED = 'cancelled';
    const FINISHED  = 'finished';
    const STARTED   = 'started';
    const PENDING   = 'pending';

    /**
     * @var null
     */
    protected $model = null;

    /**
     * @return $this
     */
    public function finish()
    {
        $this->setStatus(self::FINISHED);

        return $this;
    }

    /**
     * @return $this
     */
    public function cancel()
    {
        $this->setStatus(self::CANCELLED);

        return $this;
    }

    /**
     * @return $this
     */
    public function pending()
    {
        $this->setStatus(self::PENDING);

        return $this;
    }

    /**
     * @return $this
     */
    public function start()
    {
        $this->setStatus(self::STARTED);

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
     * @param $id
     * @return $this
     */
    public function setJobId($id)
    {
        $this->job_id = $id;
        $this->save();

        return $this;
    }

    /**
     * @return mixed
     */
    public function model()
    {
        if (!$this->model)
        {
            $this->model = new $this->namespace($this->rel_id);
        }

        return $this->model;
    }
}
