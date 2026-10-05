<?php
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new \WHMCS\ClientArea();
$ca->initPage();
$ca->setPageTitle('Deployment Platform');
$ca->addToBreadCrumb('index.php', 'CloudHost247');
$ca->addToBreadCrumb('deployments.php', 'Deployment Platform');
$ca->setTemplate('cloudhost247-platform');
$ca->output();
