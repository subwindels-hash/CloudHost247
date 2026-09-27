<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue\Models\Job as JobModel;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue\Services\Log;

class Queue
{
    /**
     * @var null
     */
    protected $callBefore = null;

    /**
     * @var null
     */
    protected $callAfter = null;

    /**
     *
     */
    public function process()
    {
        $queue = DependencyInjection::get(DatabaseQueue::class);

        while ($model = $queue->pop())
        {
            if ($this->callBefore)
            {
                $callback = $this->callBefore;
                $callback($model);
            }

            $job = new Manager($model);
            $job->fire();

            if ($this->callAfter)
            {
                $callback = $this->callAfter;
                $callback($model);
            }
        }
    }

    /**
     * @param $id
     */
    public function cancelRelated($id)
    {
        $job     = JobModel::where('id', $id)->first();
        $related = JobModel::where('rel_id', $job->rel_id)
            ->where('rel_type', $job->rel_type)->where('id', '<', $id)
            ->whereNotIn('status', [JobModel::STATUS_CANCELED, JobModel::STATUS_FINISHED])->get();

        foreach ($related as $relatedJob)
        {
            $relatedJob->setCanceled();

            $log = new Log($relatedJob);

            $log->info('Canceled by task: ' . $job->id);
        }
    }

    /**
     * @param $callable
     * @throws \Exception
     */
    public function setCallBefore($callable)
    {
        if (!is_callable($callable))
        {
            throw new \Exception('Argument is not callable');
        }

        $this->callBefore = $callable;
    }

    /**
     * @param $callable
     * @throws \Exception
     */
    public function setCallAfter($callable)
    {
        if (!is_callable($callable))
        {
            throw new \Exception('Argument is not callable');
        }

        $this->callAfter = $callable;
    }
}