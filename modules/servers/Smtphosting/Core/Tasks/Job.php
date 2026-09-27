<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Tasks;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Tasks\Task;

class Job
{
    /**
     * @var Task[]
     */
    protected $tasks = [];

    public function __construct()
    {

    }

    /**
     * Add single task
     * @param Task $task
     */
    final public function addTask(Task $task)
    {
        $this->tasks[] = $task;
    }

    /**
     * Add many tasks
     * @param $tasks
     */
    final public function addTasks($tasks)
    {
        foreach ($this->tasks as $task)
        {
            $this->addTask($task);
        }
    }

    /**
     * Run some action on your tasks
     */
    public function run()
    {
        foreach ($this->tasks as $task)
        {
            //$task->fi
        }
    }
}