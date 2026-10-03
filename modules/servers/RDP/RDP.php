<?php

use WHMCS\Database\Capsule;
use WHMCS\Module\Server\RDP\Helper;

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}
function RDP_MetaData()
{
    return array(
        'DisplayName' => 'RDP',
        'APIVersion' => '1.1', // Use API Version 1.1
        'RequiresServer' => true, // Set true if module requires a server to work
        'DefaultNonSSLPort' => '1111', // Default Non-SSL Connection Port
        'DefaultSSLPort' => '1112', // Default SSL Connection Port
        'ServiceSingleSignOnLabel' => 'Login to Panel as User',
        'AdminSingleSignOnLabel' => 'Login to Panel as Admin',
    );
}

function RDP_ConfigOptions($params)
{

    $helper = new Helper($params);

    /** Function to create a custom field */
    $allstock = $helper->getStocks();

    $pid = $_REQUEST['id'];

    $options = [];

   /** WHMCS function to get the default currency */
    $currency = getCurrency();

    if (isset($allstock['result']) && is_array($allstock['result'])) {
        foreach ($allstock['result'] as $stock) {
            $name = trim($stock->{'name '});
            $id = $stock->id;
            $price = trim($stock->{'price '});

            $inStockQuantity = trim($stock->{'inStockQuantity '});

            $options[$id . '|' . $inStockQuantity] = "{$name} (" . $currency['prefix'] . "{$price} " . $currency['suffix'] . ")";
        }
    }

    $helper = new Helper($params);

    /** Function to create a custom field */
    $helper->CreateCustomFields($pid);
    /** Function to create an email template */

    $helper->createTemplate();

    return array(
        'Products' => array(
            'Type' => 'dropdown',
            'Options' => $options,
            'Description' => 'Choose one',
        ),
    );

}

function RDP_CreateAccount(array $params)
{
    try {

        $helper = new Helper($params);

        /** Function to create an order */
        $planid = explode('|', $params['configoption1']);

        $result = $helper->createOrder($planid[0]);

        if (!empty($result) && isset($result['result'][0]->serviceid)) {

            /** Function to save the value of a custom field */
            $customresult = $helper->saveCustomFiledValue($params['pid'], $params['serviceid'], $result['result'][0]->serviceid);

            if ($customresult) {

                $emailData = [
                    'messagename' => 'Welcome RDP Credentials Email',
                    'id' => $params['userid'],
                    'customvars' => base64_encode(serialize(array("RDP_ip" => $result['result'][0]->ipaddress, "RDP_username" => $result['result'][0]->username, "RDP_password" => base64_decode($result['result'][0]->password)))),
                ];

                /** Function to send an email to the client */
                $emailSendResult = $helper->sendEmail($emailData);

                if ($emailSendResult['result'] == 'success') {
                    Capsule::table("tblhosting")->where("id",$params['serviceid'])->update([
                        "username" => $result['result'][0]->username,
                        "password" => base64_decode($result['result'][0]->password),
                    ]);
                    return 'success';
                }
            }

        } else {
            return $result['result']->error;
        }

        return 'error';

    } catch (Exception $e) {
        // Record the error in WHMCS's module log.
        logModuleCall(
            'RDPmodule',
            __FUNCTION__,
            $params,
            $e->getMessage(),
            $e->getTraceAsString()
        );

        return $e->getMessage();
    }
}

function RDP_SuspendAccount(array $params)
{
    try {
        return true;
    } catch (Exception $e) {
        // Record the error in WHMCS's module log.
        logModuleCall(
            'RDPmodule',
            __FUNCTION__,
            $params,
            $e->getMessage(),
            $e->getTraceAsString()
        );

        return $e->getMessage();
    }


}

function RDP_UnsuspendAccount(array $params)
{
    try {
        return true;
    } catch (Exception $e) {
        // Record the error in WHMCS's module log.
        logModuleCall(
            'RDPmodule',
            __FUNCTION__,
            $params,
            $e->getMessage(),
            $e->getTraceAsString()
        );

        return $e->getMessage();
    }
}

function RDP_TerminateAccount(array $params)
{
    try {
        return true;
    } catch (Exception $e) {
        // Record the error in WHMCS's module log.
        logModuleCall(
            'RDPmodule',
            __FUNCTION__,
            $params,
            $e->getMessage(),
            $e->getTraceAsString()
        );

        return $e->getMessage();
    }
}

function RDP_Renew(array $params)
{

    try {
        $helper = new Helper($params);

        /** Function to renew an order */
        $result = $helper->renewService($params['customfields']['serviceid']);

        if ($result['result']->message) {
            return 'success';
        } else {
            return $result['result']->error;
        }

    } catch (Exception $e) {
        // Record the error in WHMCS's module log.
        logModuleCall(
            'RDPmodule',
            __FUNCTION__,
            $params,
            $e->getMessage(),
            $e->getTraceAsString()
        );

        return $e->getMessage();
    }
}

function RDP_ClientArea(array $params)
{
    try {
        global $CONFIG;

        $helper = new Helper($params);

        $password = $username = $ipaddress = $signupdate = $duedate = '';

        /** Function to get service detail */
        $result = $helper->getServiceDetail($params['customfields']['serviceid']);

        if ($result['httpcode'] == 200 && isset($result['result'])) {

            $password = $result['result']->password;
            $hostname = $result['result']->hostname;
            $username = $result['result']->username;
            $ipaddress = $result['result']->hostname;
            $signupdate = $result['result']->signupdate;
            $duedate = $result['result']->duedate;
            $status = $result['httpcode'];
        }

        $assets_link = $CONFIG["SystemURL"] . "/modules/servers/RDP/assets/";

        return array(
            'templatefile' => "templates/overview.tpl",
            'vars' => array(
                'hostname' => $hostname,
                "username" => $username,
                "ipaddress" => $ipaddress,
                "signupdate" => $signupdate,
                "duedate" => $duedate,
                'assets_link' => $assets_link,
                'encodedPassword' => $password,
                'status' => $status,
                'serviceid' => $params['customfields']['serviceid']
            ),
        );
    }catch (Exception $e) {
        logModuleCall(
            'custom Server module',
            __FUNCTION__,
            $params,
            $e->getMessage(),
            $e->getTraceAsString()
        );

        return array(
            'tabOverviewReplacementTemplate' => 'error.tpl',
            'templateVariables' => array(
                'usefulErrorHelper' => $e->getMessage(),
            ),
        );
    }
}

function RDP_AdminServicesTabFields(array $params)
{
    try {

        global $CONFIG;

        $helper = new Helper($params);

        $result = $helper->getServiceDetail($params['customfields']['serviceid']);


        if (empty($params['customfields']['serviceid'])) {

            $html = '<div class="alert alert-warning" role="alert">Please provide service id to get RDP info.</div>';

        } elseif ($result['httpcode'] == 200) {

            $html = '<link href="' . $CONFIG["SystemURL"] . '/modules/servers/RDP/assets/css/admin-style.css" rel="stylesheet">
                <div class="container deviceCell">
                    <h4>RDP Information</h4>
                    <table class="ad_on_table_dash table table-striped" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tbody>
                            <tr>
                                <td style="width:50%" class="hading-td">Hostname :</td>
                                <td class="hading-td">' . $result['result']->hostname . '</td>
                            </tr>
                            <tr>
                                <td class="hading-td">IPaddress :</td>
                                <td class="hading-td">' . $result['result']->ipaddress . '</td>
                            </tr>
                            <tr>
                                <td class="hading-td">Username :</td>
                                <td class="hading-td">' . $result['result']->username . '</td>
                            </tr>
                            <tr>
                                <td class="hading-td">Password :</td>
                                <td class="hading-td">
                                    <span id="passwordField" class="hidden-password">.................</span>
                                    <button id="togglePassword" type="button" 
                                        data-password="' . htmlspecialchars($result['result']->password, ENT_QUOTES, "UTF-8") . '">
                                        <i id="eyeIcon" class="fa fa-eye"></i>
                                    </button>
                                </td>
                            </tr>
                            <tr>
                                <td class="hading-td">Signup Date :</td>
                                <td class="hading-td">' . $result['result']->signupdate . '</td>
                            </tr>
                            <tr>
                                <td class="hading-td">Due Date :</td>
                                <td class="hading-td">' . $result['result']->duedate . '</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <script src="' . $CONFIG["SystemURL"] . '/modules/servers/RDP/assets/js/admin-script.js"></script>';

        } else {
            $html = '<div class="alert alert-warning" role="alert">Something went wrong. Please check the system log.</div>';

        }

        return ["RDP Information" => $html];
    } catch (Exception $e) {
        logModuleCall('custom server module', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());
        return $e->getMessage();
    }
}

function RDP_TestConnection(array $params)
{
    try {
        $helper = new Helper($params);

        // Call the service's connection test function.
        $result = $helper->testConnection();


        if ($result['httpcode'] == 200) {

            $success = true;
        }

    } catch (Exception $e) {
        // Record the error in WHMCS's module log.
        logModuleCall(
            'provisioningmodule',
            __FUNCTION__,
            $params,
            $e->getMessage(),
            $e->getTraceAsString()
        );

        $success = false;
        $errorMsg = $e->getMessage();
    }

    return array(
        'success' => $success,
        'error' => $errorMsg,
    );
}