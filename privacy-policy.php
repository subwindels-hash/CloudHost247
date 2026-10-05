<?php
/**
 * Privacy Policy Page Controller
 *
 * @package    WHMCS
 * @author     CloudHost247
 * @copyright  Copyright (c) CloudHost247 Isc., All Rights Reserved
 * @license    Private Use
 * @version    1.0.0
 * @link       https://www.cloudhost247.com
 */

use WHMCS\ClientArea;
use WHMCS\Lang;

define('CLIENTAREA', true);

require __DIR__ . '/init.php';

$ca = new ClientArea();

$ca->setPageTitle('Privacy Policy');

$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('privacy-policy.php', 'Privacy Policy');

$ca->initPage();

$ca->setTemplate('privacypolicy');

$ca->output();
