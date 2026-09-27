<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\CommandLine;

use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;

/**
 * Class Command
 * @package ModulesGarden\ProductsReseller\Server\Smtphosting\Core\CommandLine
 */
class AbstractCommand extends \Symfony\Component\Console\Command\Command
{
    /**
     * Command name
     * @var string
     */
    protected $name = null;

    /**
     * Command description
     * @var string
     */
    protected $description = '';

    /**
     * Command help text. Use --help to show
     * @var string
     */
    protected $help = '';

    /**
     * minimal command configuration
     */
    protected function configure()
    {
        $this
            ->setName($this->name)
            ->setDescription($this->description)
            ->setHelp($this->help)
            ->addOption('force', 'f', InputOption::VALUE_OPTIONAL, 'Force script to run, without checking if another instance is running', false);

        $this->setup();
    }

    /**
     * Execute command
     * @param InputInterface $input
     * @param OutputInterface $output
     */
    protected function execute(InputInterface $input, OutputInterface $output)
    {
        try
        {
            $this->beforeProcess($input, $output);

            $this->process($input, $output, new SymfonyStyle($input, $output));

            $this->afterProcess($input, $output);
        }
        catch (\Exception $ex)
        {
            (new SymfonyStyle($input, $output))->error($ex->getMessage());
        }
        return 0;
    }

    /**
     * Add some custom actions here based on documentation  https://symfony.com/doc/current/console.html
     */
    protected function setup()
    {

    }

    /**
     * @param InputInterface $input
     * @param OutputInterface $output
     * @param SymfonyStyle $io
     */
    protected function process(InputInterface $input, OutputInterface $output, SymfonyStyle $io)
    {

    }

    /**
     * Function will be called before executing "process" function
     * @throws \Exception
     */
    protected function beforeProcess(InputInterface $input, OutputInterface $output)
    {

    }

    /**
     * Function will be called after executing "process" function
     * @param InputInterface $input
     * @param OutputInterface $output
     */
    protected function afterProcess(InputInterface $input, OutputInterface $output)
    {

    }
}