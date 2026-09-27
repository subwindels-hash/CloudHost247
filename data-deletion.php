<?php
/**
 * Data Deletion Instructions Page
 *
 * @package    WHMCS
 * @subpackage Client Area
 */

define('CLIENTAREA', true);

require __DIR__ . '/init.php';
require 'header.php';

$ca = new WHMCS\ClientArea();

// Set page title and properties
$ca->setPageTitle('DATA DELETION INSTRUCTIONS');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('data-deletion.php', 'DATA DELETION INSTRUCTIONS');

$ca->initPage();

// Assign template variables
$ca->assign('effectiveDate', 'August 14, 2025');
$ca->assign('companyName', 'CloudHost247 Inc');

// Output the page
$ca->setTemplate('datadeletion');
$ca->output();
