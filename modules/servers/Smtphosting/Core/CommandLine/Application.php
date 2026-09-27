<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\CommandLine;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;

class Application extends \Symfony\Component\Console\Application
{
    protected $dir = '';

    /**
     * @override
     */
    public function run(\Symfony\Component\Console\Input\InputInterface $input = null, \Symfony\Component\Console\Output\OutputInterface $output = null)
    {
        $this->loadCommandsControllers($this->getCommands());

        parent::run();
    }

    /**
     * Get all available files
     * @return array
     */
    protected function getCommands()
    {
        $files    = glob(ModuleConstants::getFullPath('app', $this->dir) . '/*.php');
        $commands = [];

        foreach ($files as $file)
        {
            $file = substr($file, strrpos($file, DIRECTORY_SEPARATOR) + 1);
            $file = substr($file, 0, strrpos($file, '.'));

            $commands[] = $file;
        }

        return $commands;
    }

    /**
     * Create new objects and add it
     * @param $commands
     */
    protected function loadCommandsControllers($commands)
    {
        foreach ($commands as $command)
        {
            $class = ModuleConstants::getRootNamespace() . '\App\\' . $this->dir . '\\' . $command;

            $this->add(new $class);
        }
    }
}