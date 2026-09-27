<?php
use WHMCS\ClientArea;
use WHMCS\Database\Capsule;
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new ClientArea();
$ca->setPageTitle('Future-Element');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('future-element.php', 'Future-Element');
$ca->initPage();
$ca->assign('sidebarHostxRemove', 'true');
$ca->setTemplate('future-element');
$ca->output();