<?php
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new \WHMCS\ClientArea();
$ca->initPage();
$ca->setPageTitle('Applications');
$ca->addToBreadCrumb('index.php', 'CloudHost247');
$ca->addToBreadCrumb('applications.php', 'Applications');
$ca->setTemplate('cloudhost247-platform');
$ca->output();
