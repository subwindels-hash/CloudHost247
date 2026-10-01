<?php
/**
 * Help Center Page
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Theme
 * @copyright  CloudHost247 Isc.
 * @license    Private
 */

define('CLIENTAREA', true);

require __DIR__ . '/init.php';

$ca = new WHMCS\ClientArea();

/**
 * Page Initialization
 *
 * Sets the page title, assigns breadcrumb navigation, and loads the Smarty template.
 * No authentication required — public support page.
 */
$ca->setPageTitle('Help Center');
$ca->initPage();

/**
 * Breadcrumb Navigation
 *
 * Adds structured breadcrumb trail for easy navigation back to home.
 */
$ca->addToBreadCrumb('index.php', $_LANG['globalsystemname']);
$ca->addToBreadCrumb('help-center.php', 'Help Center');

/**
 * Template Assignment
 *
 * Template file: templates/cloudhost247_legacy/helpcenter.tpl
 */
$ca->setTemplate('helpcenter');

/**
 * Render Output
 *
 * Compiles and outputs the page using the assigned Smarty template.
 */
$ca->output();
