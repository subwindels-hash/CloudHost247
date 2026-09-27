<?php
use WHMCS\ClientArea;
use WHMCS\Database\Capsule;
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new ClientArea();
$ca->setPageTitle('About Us');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('aboutus.php', 'About Us');
$ca->initPage();
$ca->assign('sidebarHostxRemove', 'true');
$ca->setTemplate('aboutus');
$ca->output();