<?php
/**
 * WHMCS Domain Name Auto-Renewal and Deletion Policy Page
 *
 * @package WHMCS
 * @author CloudHost247 Isc
 * @copyright Copyright (c) CloudHost247 Isc, All Rights Reserved
 * @license https://www.cloudhost247.com/license/
 */

define('CLIENTAREA', true);

require __DIR__ . '/init.php';

$ca = new WHMCS\ClientArea();

$ca->setPageTitle(Lang::trans('Domain Name Auto-Renewal and Deletion Policy'));

$ca->addToBreadCrumb('index.php', Lang::trans('Home'));
$ca->addToBreadCrumb('domain-renewal-policy.php', Lang::trans('Domain Name Auto-Renewal and Deletion Policy'));

$ca->initPage();

$ca->setTemplate('domainrenewalpolicy');

$ca->output();
