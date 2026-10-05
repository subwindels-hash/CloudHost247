<?php
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new \WHMCS\ClientArea();
$ca->initPage();
$ca->setPageTitle('Server Management');
$ca->addToBreadCrumb('index.php', 'CloudHost247');
$ca->addToBreadCrumb('server-management.php', 'Server Management');
$ca->setTemplate('cloudhost247-platform');
$ca->output();
