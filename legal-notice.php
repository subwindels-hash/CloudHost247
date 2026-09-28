<?php
/**
 * Legal Notice Page
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Theme
 * @copyright  CloudHost247 Isc
 * @license    Private
 */

define('CLIENTAREA', true);

require __DIR__ . '/init.php';

$ca = new WHMCS\ClientArea();

/**
 * Page Initialization
 *
 * Sets the page title and assigns the Smarty template.
 * No authentication required — public legal page.
 */
$ca->setPageTitle('Legal Notice');
$ca->initPage();

/**
 * Breadcrumb Navigation
 *
 * Adds structured breadcrumb trail for easy navigation back to home.
 */
$ca->addToBreadCrumb('index.php', $_LANG['globalsystemname']);
$ca->addToBreadCrumb('legal-notice.php', 'Legal Notice');

/**
 * Template Assignment
 *
 * Template file: templates/cloudhost247_legacy/legalnotice.tpl
 */
$ca->setTemplate('legalnotice');

/**
 * Render Output
 *
 * Compiles and outputs the page using the assigned Smarty template.
 */
$ca->output();
