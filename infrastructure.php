<?php
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new \WHMCS\ClientArea();
$ca->initPage();
$ca->setPageTitle('Infrastructure');
$ca->addToBreadCrumb('index.php', 'CloudHost247');
$ca->addToBreadCrumb('infrastructure.php', 'Infrastructure');
$ca->setTemplate('cloudhost247-infrastructure');
$ca->output();
