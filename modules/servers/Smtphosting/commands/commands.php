<?php


define('DS', DIRECTORY_SEPARATOR);
$modulePath = dirname(__DIR__);
$whmcsPath  = dirname(dirname(dirname($modulePath)));

require_once $whmcsPath . DS . 'init.php';
require_once $modulePath . DS . 'core' . DS . 'Bootstrap.php';

//cause WHMCS
ini_set('max_execution_time', 0);

$argList = $argv ? $argv : $_SERVER['argv'];
if (count($argList) === 0)
{
    $argList = [__FILE__];
}

(new \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\CommandLine\Application())
    ->run();
