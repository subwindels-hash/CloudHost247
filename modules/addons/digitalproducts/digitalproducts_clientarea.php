<?php
/**
 * WHMCS Digital Products Module - Client Area
 *
 * Client area entry point for the Digital Products module.
 *
 * @package    DigitalProducts
 * @version    1.0.0
 */

use WHMCS\Module\Addon\DigitalProducts\Client as DigitalProductsClient;

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

require_once __DIR__ . '/lib/Client.php';

/**
 * Client Area Output
 */
function digitalproducts_clientarea($vars)
{
    $action = $_GET['action'] ?? 'downloads';
    $client = new DigitalProducts\Client($vars);

    $content = $client->render($action);

    return [
        'pagetitle' => 'My Downloads',
        'breadcrumb' => [
            'index.php?m=digitalproducts' => 'My Downloads',
        ],
        'templatefile' => 'client/downloads',
        'requirelogin' => true,
        'forcessl' => true,
        'vars' => [
            'content' => $content,
            'modulelink' => $vars['modulelink'],
        ],
    ];
}
