<?php

declare(strict_types=1);

use WHMCS\ClientArea;
use WHMCS\User\Client;

define('CLIENTAREA', true);

require __DIR__ . '/init.php';

$ca = new ClientArea();

$ca->setPageTitle('Fair Usage Policy');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('fair-usage-policy.php', 'Fair Usage Policy');

$ca->initPage();

$ca->assign('templatefile', 'fairusagepolicy');

$ca->setTemplate('fairusagepolicy');

$ca->output();
