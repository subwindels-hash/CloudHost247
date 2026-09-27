<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\CommandLine;

use Symfony\Component\Console\Input\InputOption;

class JobsLoop extends AbstractCommand
{
    /**
     * Loop interval in seconds
     * @var int
     */
    protected $loopInterval = 5;

    /**
     * @var int
     */
    protected $maxChildren = 5;

    /**
     * @var int
     */
    protected $tasksPerChildren = 10;

    /**
     *
     */
    final protected function configure()
    {
        parent::configure();
    }

    /**
     *
     */
    final protected function setup()
    {
        $this->addOption('parent', InputOption::VALUE_OPTIONAL, 'Parent id', null);
        $this->addOption('id', InputOption::VALUE_OPTIONAL, 'Child id', null);
    }

    /**
     * Execute command in the loop
     * @param InputInterface $input
     * @param OutputInterface $output
     */
    final protected function execute(InputInterface $input, OutputInterface $output)
    {
        $parent          = $input->getOption('parent');
        $id              = $input->getOption('id');
        $parentHypervior = new Hypervisor($this->getName());

        //Lock parent
        if (!$parent)
        {
            $parentHypervior->lock();
        }
        else
        {
            $parentHypervior->checkIfRunning();
        }

        if ($id)
        {

        }

        do
        {
            parent::process($input, $output, new SymfonyStyle($input, $output));

            sleep($this->loopInterval);
        } while (!$hypervisor->isStopped());
    }

    /**
     * @param $jobs []
     */
    protected function processJobs($jobs)
    {
        foreach ($jobs as $job)
        {

        }
    }
}