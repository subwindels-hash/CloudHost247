<?php
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new \WHMCS\ClientArea();
$ca->initPage();
$ca->setPageTitle('Operating Systems');
$ca->addToBreadCrumb('index.php', 'CloudHost247');
$ca->addToBreadCrumb('operating-systems.php', 'Operating Systems');
$ca->setTemplate('cloudhost247-platform');
$ca->output();
