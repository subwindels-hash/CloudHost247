<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue;

class DatabaseQueue implements QueueInterface
{
    /**
     * @var int
     */
    protected $retryLimit = 100;

    /**
     * @param $job
     * @param string $data
     * @param int $parentId
     * @param null $relType
     * @param null $relId
     * @param null $customId
     */
    public function push($job, $data = '', $parentId = null, $relType = null, $relId = null, $customId = null)
    {
        $model            = new \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue\Models\Job();
        $model->job       = $job;
        $model->data      = $data;
        $model->parent_id = $parentId;
        $model->rel_type  = $relType;
        $model->rel_id    = $relId;
        $model->custom_id = $customId;
        $model->save();

        return $model;
    }

    public function pushRaw($payload, $queue = null, array $options = [])
    {

    }

    public function later($delay, $job, $data = '', $queue = null)
    {

    }

    public function pushOn($queue, $job, $data = '')
    {

    }

    public function laterOn($queue, $delay, $job, $data = '')
    {

    }

    /**
     * @return mixed
     */
    public function pop()
    {
        return $this->query()->first();
    }

    /**
     * @return mixed
     */
    public function count()
    {
        return $this->query()->count();
    }

    /**
     * @return \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue\Models\Job
     */
    protected function query()
    {
        $table = (new\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue\Models\Job)->getTable();
        $query = \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue\Models\Job
            ::select("{$table}.*")
            ->leftJoin($table . ' as parent', function ($join) use ($table) {
                $join->on($table . '.parent_id', '=', 'parent.id');
            })
            ->where(function ($query) use ($table) {
                $query->where("{$table}.status", '=', '')
                    ->orWhere(function ($query) use ($table) {
                        $query->where("{$table}.status", '=', \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue\Models\Job::STATUS_ERROR);
                        $query->where("{$table}.retry_after", '<', date("Y-m-d H:i:s"));
                        $query->where("{$table}.retry_count", '<', $this->retryLimit);
                    })
                    ->orWhere(function ($query) use ($table) {
                        $query->where("{$table}.status", '=', \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue\Models\Job::STATUS_WAITING);
                        $query->where("{$table}.retry_after", '<', date("Y-m-d H:i:s"));
                        $query->where("{$table}.retry_count", '<', $this->retryLimit);
                    });
            })
            ->where(function ($query) use ($table) {
                $query->whereRaw("{$table}.parent_id IS NULL");
                $query->orWhere("parent.status", \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue\Models\Job::STATUS_FINISHED);
            });

        return $query;
    }
}