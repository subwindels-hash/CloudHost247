<?php
/**
 * Data Protection Standards Page
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
 * No authentication required — public compliance page.
 */
$ca->setPageTitle('Data Protection Standards');
$ca->initPage();

/**
 * Template Assignment
 *
 * Template file: templates/cloudhost247_legacy/dataprotectionstandards.tpl
 */
$ca->setTemplate('dataprotectionstandards');

/**
 * Render Output
 *
 * Compiles and outputs the page using the assigned Smarty template.
 */
$ca->output();
