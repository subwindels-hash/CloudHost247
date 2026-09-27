<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue\Job\ChildrenTrait;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue\Services\Log;

/**
 * Class Job
 * @package ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue
 */
class Job implements \Illuminate\Contracts\Queue\ShouldQueue
{
    use ChildrenTrait;

    /**
     * @var Models\Job
     */
    protected $model;

    /**
     * @var Services\Log
     */
    protected $log;

    /**
     * Job constructor.
     * @param Models\Job $job
     * @param Log $log
     */
    public function __construct(Models\Job $job, Services\Log $log)
    {
        $this->model = $job;
        $this->log   = $log;
    }

    /**
     *
     */
    public function handle()
    {
        $this->log->info('Override me please!');
    }
}
