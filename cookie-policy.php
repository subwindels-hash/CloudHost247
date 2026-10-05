<?php
/**
 * Cookie Policy Page
 *
 * @package    WHMCS
 * @subpackage ClientArea
 */

define('CLIENTAREA', true);
require __DIR__ . '/init.php';

$ca = new WHMCS_ClientArea();
$ca->setPageTitle('COOKIE POLICY');
$ca->addToBreadCrumb('index.php', 'Home');
$ca->addToBreadCrumb('cookie-policy.php', 'Cookie Policy');
$ca->setTemplate('cookiepolicy');
$ca->output();
