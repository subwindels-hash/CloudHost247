<?php
use WHMCS\Database\Capsule;
use WHMCS\Module\Addon\Soyoustart\Helper;
use WGSModule\Soyoustart\classes\CustomDatabase;
use WGSModule\Soyoustart\classes\ApiCall;
use WHMCS\Module\Addon\Soyoustart\Admin\AdminDispatcher;
if (!defined('DS')) define('DS', DIRECTORY_SEPARATOR);
if (file_exists(__DIR__ . DS . 'classes/ApiCall.php')) {
    require_once __DIR__ . DS . 'classes/ApiCall.php';
}
function soyoustart_config()
{
    global $CONFIG;
    /* adding lang file according to whmcs default language */
    $language = $CONFIG['Language'];
    $langfilename = __DIR__ . '/lang/' . $language . '.php';
    if (file_exists($langfilename)) {
        require($langfilename);
    } else {
        require(__DIR__ . '/lang/english.php');
    }
    $lang = $_ADDONLANG;
    return [
        'name' => $lang["addon_name"],
        'description' =>  $lang["addon_desc"],
        'author' => '<a href="https://whmcsglobalservices.com/" target="_blank"><img width="150" src="../modules/addons/soyoustart/templates/assets/images/logo.png" alt="WHMCS Global Services"></a>',
        'language' => 'english',
        'version' => '8.0.8',
        'fields' => [
            'licenseNumtoactivate' => ['FriendlyName' => 'License Number', 'Type' => 'text', 'Size' => '50', 'Default' => '', 'Description' => 'Enter the license key'],
            "delete_db" => array("FriendlyName" => "Delete Database Table", "Type" => "yesno", "Default" => "yes", "Description" => "Tick this box to delete the addon module database table when deactivating the module."),
        ]
    ];
}
function soyoustart_activate()
{
    require_once __DIR__ . DS . 'classes/CustomDatabase.php';
    /* creating all the custon table */
    $create = new CustomDatabase();
    $create->createTableIfNotExist();
    /* creating custom email templates */
    $create->createEmailTemplateIfNotExist();
}
function soyoustart_deactivate()
{
    require_once __DIR__ . DS . 'classes/CustomDatabase.php';
    /* creating all the custon table */
    $deleteTable = new CustomDatabase();
    $deleteTable->deleteTalbe();
}
function soyoustart_output($vars)
{
    $helper = new Helper();
    $license =  $helper->CheckLicense($vars['licenseNumtoactivate']);
    $vars['license'] = $license;
    $whmcs = WHMCS\Application::getInstance();
    $action = !empty($whmcs->get_req_var("action")) ? $whmcs->get_req_var("action") : 'dasboard';
    $dispatcher = new AdminDispatcher();
    $dispatcher->dispatch($action, $vars);
}