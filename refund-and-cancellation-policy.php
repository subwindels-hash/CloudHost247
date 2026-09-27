<?php
use WHMCS\ClientArea;
use WHMCS\Database\Capsule;
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new ClientArea();
$ca->setPageTitle('Refund and Cancellation Policy');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('refund-and-cancellation-policy.php', 'Refund and Cancellation Policy');
$ca->initPage();
$ca->assign('sidebarHostxRemove', 'true');
$ca->setTemplate('refund-and-vancellation-policy');
$ca->output();