<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection\DependencyInjection;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue\Services\Log;

class Manager
{
    /**
     * @var Models\Job
     */
    protected $job;

    /**
     * @var Log
     */
    protected $log;

    /**
     * Manager constructor.
     * @param Models\Job $job
     */
    public function __construct(\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Queue\Models\Job $job)
    {
        $this->job = $job;
        $this->log = new Log($this->job);
    }

    /**
     *
     */
    public function fire()
    {
        try
        {
            $this->job->setRunning();

            $ret = $this->resolveAndFire($this->job->job, $this->job->data);
            if ($ret !== false)
            {
                $this->job->setFinished();
            }
        }
        catch (\Exception $ex)
        {
            //Set error in job
            $this->job->setError();
            $this->job->setRetryAfter(date('Y-m-d H:i:s', strtotime('+ 60 seconds')));
            $this->job->increaseRetryCount();

            //add log message
            $this->log->error($ex->getMessage(), debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS));
        }
    }

    /**
     * @param $job
     * @param $data
     * @return mixed
     */
    protected function resolveAndFire($job, $data)
    {
        [$class, $method] = $this->parseJob($job);
        $instance = $this->resolve($class);

        return call_user_func_array([$instance, $method], unserialize($data));
    }

    /**
     * @param $class
     * @return mixed
     */
    protected function resolve($class)
    {
        return new $class($this->job, $this->log);
    }

    /**
     * Parse the job declaration into class and method.
     *
     * @param string $job
     * @return array
     */
    protected function parseJob($job)
    {
        $segments = explode('@', $job);
        return count($segments) > 1 ? $segments : [$segments[0], 'fire'];
    }
}