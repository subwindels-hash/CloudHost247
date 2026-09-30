<?php
/** CloudHost247 Digital Products client-area entry point. */
if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/lib/Client.php';

function digitalproducts_clientarea($vars)
{
    $action = isset($_GET['action']) ? preg_replace('/[^a-z-]/', '', (string) $_GET['action']) : 'downloads';
    $client = new DigitalProducts\Client($vars);
    return array(
        'pagetitle' => $action === 'detail' ? 'Download Details' : 'My Downloads',
        'breadcrumb' => array('index.php?m=digitalproducts' => 'My Downloads'),
        'templatefile' => 'client/downloads',
        'requirelogin' => true,
        'forcessl' => true,
        'vars' => array('content' => $client->render($action), 'modulelink' => $vars['modulelink']),
    );
}
