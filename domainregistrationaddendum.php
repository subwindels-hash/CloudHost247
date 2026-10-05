<?php

use WHMCS\ClientArea;
use WHMCS\Database\Capsule;

define('CLIENTAREA', true);

require __DIR__ . '/init.php';

$ca = new ClientArea();

$ca->setPageTitle('Domain Registration Addendum');

$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('domainregistrationaddendum.php', 'Domain Registration Addendum');

$ca->setTemplate('domainregistrationaddendum');

$ca->output();
