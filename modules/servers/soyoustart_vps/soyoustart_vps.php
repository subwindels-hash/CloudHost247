<?php
require_once __DIR__ . '/../../addons/soyoustart/classes/ApiCall.php';
require_once __DIR__ . '/../../addons/soyoustart/classes/Configuration.php';
require_once __DIR__ . '/../soyoustart/lib/SoyoustartServer.php';
use WGSModule\Soyoustart\classes\ApiCall;
use WGSModule\Soyoustart\classes\Configuration;
use WHMCS\Module\Server\Soyoustart\SoyoustartServer;
use WHMCS\Module\Server\SoyoustartVps\SoyoustartServer as server;
use WHMCS\Database\Capsule;
use WHMCS\Module\Addon\Soyoustart\Helper;
if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}
function soyostart_vps_MetaData()
{
    return array(
        'DisplayName' => 'soyoustart_vps',
        'APIVersion' => '1.0.1',
        'RequiresServer' => true,
    );
}
function soyoustart_vps_ConfigOptions()
{
    return [
        'Product group' => [
            'Type' => 'text',
            'Size' => '255',
            'Description' => 'Server type(soyoustart, soyoustart_vps)',
        ],
        'Group plnacode' => [
            'Type' => 'text',
            'Size' => '255',
            'Description' => 'Product group and planCode(groupName@planCode)',
        ],
        'Account Details' => [
            'Type' => 'text',
            'Size' => '255',
            'Description' => 'account details from setting tab Eg: id-location-emial(1-canada-abc@gmail.com)',
        ],
        'ovhSubsidiary' => [
            'Type' => 'text',
            'Size' => '255',
            'Description' => '',
        ],
        'Hide OS' => [
            'Type' => 'text',
            'Size' => '255',
            'Description' => '',
        ],
    ];
}
function soyoustart_vps_CreateAccount(array $params)
{
    try {
        global $CONFIG;
        $obj = new SoyoustartServer();
        $helper = new Helper();
        $apiCall = new ApiCall();
        $settings = new Configuration();
        $result = Capsule::table("tbladdonmodules")->select('value')->where('setting', 'licenseNumtoactivate')->where('module', 'soyoustart')->first();
        $license = $apiCall->CheckLicense($result->value);
        if ($license["status"] != "Active") {
            return   $license["ststus"] . " License";
        }
        $serviceId = $params['serviceid'];
        $serviceConfigs = $obj->getServiceConfigs($serviceId);
        $domainName = explode("//", $CONFIG["Domain"])[1];
        $defaultCustomHostName = $helper->get_data("mod_acl_settings", ["key" => "generalaclSettings"], "first");
        $defaultCustomHostName = (!empty($defaultCustomHostName->id) ? json_decode($defaultCustomHostName->value, true)["defaultCustomHostName"] : "WHMCS_$serviceId'_'$domainName");
        $defaultCustomHostName = str_replace("ServiceID", $serviceId, $defaultCustomHostName);
        $pid = $params['pid'];
        /* formating billing cycle data for API */
        $billingCycle = $params['model']["billingcycle"];
        $billingData = $obj->formateBillingCycle($billingCycle);
        $configoption2 = explode('@', $params['configoption2']);
        $ovhAccountData = explode('-', $params['configoption3']);
        $planCode = $configoption2["1"];
        $location = $ovhAccountData["1"];
        $ovhSubsidiaryURL = explode("=", $params['configoption4']);
        $subsidiaryLocation = $ovhSubsidiaryURL[1];
        $ovhPaymentMethod = $helper->get_data("mod_soyoustart_pricesetting", ["server" => "OVH", "servertype" => "VPS"], "first");
        $orderid = $params['customfields']['ovh_order_id'];
        $paymentmethod = $ovhPaymentMethod->paymentmethod;
        if (!empty($params['customfields']['ovh_order_id'])) {
            $paymentresponse = $apiCall->getpaymentdetail($params, $orderid, $paymentmethod, $pid, $serviceId, $ovhAccountData, $location);
            if (is_array($paymentresponse)) {
                if ($paymentresponse["httpcode"] == 200) {
                    if (!empty($paymentresponse["result"]->domain) && !str_contains($paymentresponse["result"]->domain, "*")) {
                        $fields = ["ovh_server_name" => $paymentresponse["result"]->domain];
                        $helper->insert_custom_fields_value($serviceId, $pid, $fields);
                    }
                    return "success";
                } else {
                    return $paymentresponse["result"]->message;
                }
            }
            return $paymentresponse;
        }
        /* creating cart */
        $cartDetails = $apiCall->createCart($location, $planCode, $subsidiaryLocation);
        if ($cartDetails["httpcode"] != 200) {
            return $cartDetails['result']->message . "Please check your (" . $ovhAccountData[2] . ")" . " account is active";
        }
        $cartId = $cartDetails["result"]->cartId;
        $cartassign = $apiCall->assignCart('/order/cart/' . $cartId . '/assign', $ovhAccountData[0], $location);
        if ($cartassign["httpcode"] != 200) {
            return $cartassign['result']->message;
        }
        $productInfo = $apiCall->get('/order/cart/' . $cartId . '/vps', $ovhAccountData[0], $location, "Get Info for vps server");
        foreach ($productInfo["result"] as $product) {
            if (trim($planCode) == trim($product->planCode)) {
                $postData = array('duration' => $billingData["durationVal"], 'planCode' => $planCode, 'pricingMode' => $billingData["pricingModeVal"], 'quantity' => $product->prices[0]->minimumQuantity);
                break;
            }
        }
        if (empty($postData)) {
            return 'Product is not found. Please check product again on OVH.';
        }
        /* assigning product in cart     */
        $response = $apiCall->addItemInCart('/order/cart/' . $cartId . '/vps', $ovhAccountData[0], $postData, $location);
        if ($response["httpcode"] != 200) {
            return $response['result']->message;
        }
        $itemid = $response["result"]->itemId;
        /* getting service Configurations */
        $serviceConfigs = $obj->getServiceConfigs($serviceId);
        foreach ($serviceConfigs as $serviceConfig) {
            $opname = explode("|", $serviceConfig->opname)[0];
            if ($serviceConfig->qty == '0' && $serviceConfig->optiontype == '3') {
            } elseif (in_array($opname, ["Cpanel", "Additional Disk","additional_disk", "FTP Backup", "Control Panel", "Snapshot", "snapshot", "Automated Backup", "automatedBackup", "Plesk", "additional_ips", "control_panel", "storage"])) {
                $data = $helper->get_data("mod_soyoustart_configurable", ["subconfigid" => $serviceConfig->id], "first");
                if(isset($data->subconfigid)){
                    $planCode = explode('__', $serviceConfig->optionname)[0];
                }else{
                    $planCode = explode('|', $serviceConfig->optionname);
                    $planCode = str_replace('_', '-', $planCode[0]);
                }
                if (in_array($planCode, ["none", "None"]))
                    continue;
                $postData = array('duration' => $billingData["durationVal"], 'itemId' => $itemid, 'planCode' => $planCode, 'pricingMode' => $billingData["pricingModeVal"], 'quantity' => 1);
                $assignConfOptionToCart = $apiCall->addConfigOptInCart('/order/cart/' . $cartId . '/vps/options', $ovhAccountData[0], $postData, $location);
                if ($assignConfOptionToCart["httpcode"] != 200) {
                    return $assignConfOptionToCart['result']->message;
                }
            }
        }
        $requiredConfiguration = $apiCall->get('/order/cart/' . $cartId . '/item/' . $itemid . '/requiredConfiguration', $ovhAccountData[0], $location, "Getting required configurations");
        if ($requiredConfiguration["httpcode"] != 200) {
            return $requiredConfiguration['result']->message;
        }
        foreach ($requiredConfiguration["result"] as $requiredConfigurationData) {
            if ($requiredConfigurationData->required == '1' || $requiredConfigurationData->label == 'AUTO_RENEW_VPS' || $requiredConfigurationData->label == 'vps_os') {
                $vpsLabel = $requiredConfigurationData->label;
                $vpsLabelNames = explode('_', $vpsLabel);
                if (count($vpsLabelNames) >= '2') {
                    $vpsLabelName = $vpsLabelNames[(count($vpsLabelNames) - 1)];
                    $vpsLabel = strtoupper($vpsLabelName);
                }
                if ($vpsLabel == 'DATACENTER') {
                    $vpsLabelValue = strtoupper(!isset($params['configoptions']['Server Location'])?  $params['configoptions']['server_location'] : $params['configoptions']['Server Location']);
                } else if ($vpsLabel == 'OS') {
                    $vpsLabelValue = (!isset($params['configoptions']['OS Version']) ? $params['configoptions']['os_version'] : $params['configoptions']['OS Version'] );
                } else if ($requiredConfigurationData->label == 'AUTO_RENEW_VPS') {
                    $vpsLabelValue = false;
                }
                $postData = array('label' => $requiredConfigurationData->label, 'value' => $vpsLabelValue);
                $response = $apiCall->addConfigOptInCart('/order/cart/' . $cartId . '/item/' . $itemid . '/configuration', '', $postData, $location);
                if ($response["httpcode"] != 200) {
                    return $response['result']->message;
                }
            }
        }
        $response = $apiCall->createOrder('/order/cart/' . $cartId . '/checkout', $ovhAccountData[0], $location);
        if ($response["httpcode"] != 200) {
            return $response['result']->message;
        }
        $orderId = $response["result"]->orderId;
        /* updating admin custom fields */
        $fields = ["ovh_account" => $ovhAccountData[2], "ovh_server_location" => $location, "ovh_order_id" => $orderId, "ovh_custom_hostname" => $defaultCustomHostName];
        $helper->insert_custom_fields_value($serviceId, $pid, $fields);
        $paymentresponse = $apiCall->getpaymentdetail($params, $orderId, $paymentmethod, $pid, $serviceId, $ovhAccountData, $location);
        if (is_array($paymentresponse)) {
            if ($paymentresponse["httpcode"] == 200) {
                if (!empty($paymentresponse["result"]->domain) && !str_contains($paymentresponse["result"]->domain, "*")) {
                    $fields = ["ovh_server_name" => $paymentresponse["result"]->domain];
                    $helper->insert_custom_fields_value($serviceId, $pid, $fields);
                }
                return "success";
            } else {
                return $paymentresponse["result"]->message;
            }
        } else {
            return $paymentresponse;
        }
        return "success";
    } catch (Exception $e) {
        logModuleCall('soyoustart_vps', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());
        return $e->getMessage();
    }
}
function soyoustart_vps_Renew(array $params)
{
    try {
        // Call the service's provisioning function, using the values provided
        // by WHMCS in `$params`.
        //
        // A sample `$params` array may be defined as:
        //
        // ```
        // array(
        //     'domain' => 'The domain of the service to provision',
        //     'username' => 'The username to access the new service',
        //     'password' => 'The password to access the new service',
        //     'configoption1' => 'The amount of disk space to provision',
        //     'configoption2' => 'The new services secret key',
        //     'configoption3' => 'Whether or not to enable FTP',
        //     ...
        // )
        // ```
    } catch (Exception $e) {
        // Record the error in WHMCS's module log.
        logModuleCall(
            'soyoustart_vps',
            __FUNCTION__,
            $params,
            $e->getMessage(),
            $e->getTraceAsString()
        );
        return $e->getMessage();
    }
    return 'success';
}
function soyoustart_vps_SuspendAccount(array $params)
{
    try {
        $apiCall = new ApiCall();
        $location = $params["customfields"]["ovh_server_location"];
        $ovhServerName = $params["customfields"]["ovh_server_name"];
        $accountId = explode("-", $params["configoption3"])[0];
        $response = $apiCall->post("/vps/{$ovhServerName}/stop", $accountId, $location, [], "Request the machine to stop", true);
        if ($response["httpcode"] != 200) {
            return $response["result"]->message;
        }
        return 'success';
    } catch (Exception $e) {
        logModuleCall('soyoustart_vps', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());
        return $e->getMessage();
    }
}
function soyoustart_vps_UnsuspendAccount(array $params)
{
    try {
        $apiCall = new ApiCall();
        $location = $params["customfields"]["ovh_server_location"];
        $ovhServerName = $params["customfields"]["ovh_server_name"];
        $accountId = explode("-", $params["configoption3"])[0];
        $response = $apiCall->post("/vps/{$ovhServerName}/start", $accountId, $location, [], "Request the machine to start", true);
        if ($response["httpcode"] != 200) {
            return $response["result"]->message;
        }
        return 'success';
    } catch (Exception $e) {
        logModuleCall('soyoustart_vps', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());
        return $e->getMessage();
    }
}
function soyoustart_vps_TerminateAccount(array $params)
{
    try {
        $helper = new Helper();
        $apiCall = new ApiCall();
        $location = $params["customfields"]["ovh_server_location"];
        $ovhServerName = $params["customfields"]["ovh_server_name"];
        $accountId = explode("-", $params["configoption3"])[0];
        $enableSettings = $helper->get_data("mod_acl_settings", ["key" => "generalaclSettings"], "first");
        $enableSettings = (!empty($enableSettings->id) ? json_decode($enableSettings->value, true) : []);
        if (isset($enableSettings["serverTemination"]) && $enableSettings["serverTemination"] == "on") {
            $response = $apiCall->post("/vps/{$ovhServerName}/stop", $accountId, $location, [], "Request the machine to stop", true);
            if ($response["httpcode"] != 200) {
                return $response["result"]->message;
            }
        } else {
            $response = $apiCall->post("/vps/{$ovhServerName}/terminate", $accountId, $location, [], "Terminating services", true);
            if ($response["httpcode"] != 200) {
                return $response["result"]->message;
            }
        }
        return 'success';
    } catch (Exception $e) {
        logModuleCall('soyoustart_vps', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());
        return $e->getMessage();
    }
}
function soyoustart_vps_AdminServicesTabFields(array $params)
{
    try {
        if ($params["customfields"]["ovh_server_name"]) {
            global $CONFIG;
            global $whmcs;
            /* adding lang file according to whmcs default language */
            $language = $CONFIG['Language'];
            $langfilename = __DIR__ . '/lang/' . $language . '.php';
            if (file_exists($langfilename)) {
                require($langfilename);
            } else {
                require(__DIR__ . '/lang/english.php');
            }
            $apiCall = new ApiCall();
            $obj = new server();
            $configuration = new Configuration();
            $serviceId = $params["serviceid"];
            $location = $params["customfields"]["ovh_server_location"];
            $serverType = $params["moduletype"];
            $ovhServerName = $params["customfields"]["ovh_server_name"];
            $accountId = explode("-", $params["configoption3"])[0];
            $ovhCustomHostname = $params["customfields"]["ovh_custom_hostname"];
            /* Get serviceinfo  */
            if ($whmcs->get_req_var("snapshot")) {
                if ($whmcs->get_req_var("snapshotAction") == "getData") {
                    $response = $apiCall->get("/vps/{$ovhServerName}/snapshot", $accountId, $location, "Get SnapshotInfo", true);
                    if ($response["httpcode"] != 200) {
                        if ($response["result"]->message == "This service does not exist") {
                            $html = '<div class="alert alert-danger" role="alert">Error: ' . $response["result"]->message . '</div>';
                        } else {
                            $html .= '
                            <div id="snapshot">
                                <p class="snapshotCreateMsg">' . $_ADDONLANG["snapshotCreateMsg"] . ' </p>
                                <button type="button" class="btn btn-success snapshotCreateBtn"  data-toggle="modal" data-target="#snapshotCreateBtn">' . $_ADDONLANG["snapshotCreateBtn"] . '
                                </button>
                            </div>';
                        }
                        echo json_encode(["action" => "create", "html" => $html]);
                    } else {
                        $creationDate = $response["result"]->creationDate;
                        $dateTime = new \DateTime("$creationDate");
                        $readableFormat = $dateTime->format('D, Y-m-d H:i:s');
                        $html = '<tr>
                                    <td>' . $response["result"]->region . '</td>
                                        <td>' . $readableFormat . '</td>
                                        <td>' . $response["result"]->description . ' </td>
                                        <td>
                                        <button class="editSnapshot" type="button" data-toggle="modal" data-target="#editSnapshot" data-desc="' . $response["result"]->description . '"><i class="fas fa-pen"></i></button>
                                        <button id="revertSnapshot" type="button"><i class="fal fa-redo"></i> </button>
                                        <button id="deleteSnapshot" type="button"><i class="fas fa-trash"></i></button>
                                        </td>
                                    </tr>';
                        echo json_encode(["action" => "append", "html" => $html]);
                    }
                    exit;
                } elseif ($whmcs->get_req_var("snapshotAction") == "createSnapshot") {
                    $response = $apiCall->post("/vps/{$ovhServerName}/createSnapshot", $accountId, $location, ["description" => $whmcs->get_req_var("desc")], "creating snapshot", true);
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("snapshotAction") == "revertSnapshot") {
                    $response = $apiCall->post("/vps/{$ovhServerName}/snapshot/revert", $accountId, $location, [], "reverting snapshot", true);
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("snapshotAction") == "deleteSnapshot") {
                    $response = $apiCall->__delete("/vps/{$ovhServerName}/snapshot", $accountId, $location, [], "deleting snapshot", true);
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("snapshotAction") == "getStatus") {
                    $taskid = $whmcs->get_req_var("taskID");
                    $response = $apiCall->get("/vps/{$ovhServerName}/tasks/{$taskid}", $accountId, $location, "Getting task status", true);
                    echo json_encode($response);
                    exit;
                } else {
                    $data = ["description" => $whmcs->get_req_var("desc")];
                    $response122 = $apiCall->put("/vps/{$ovhServerName}/snapshot", $accountId, $location, $data, "updating snapshot description", true);
                    echo json_encode($response122);
                    die();
                }
            } elseif ($whmcs->get_req_var("serverInfo")) {
                if ($whmcs->get_req_var("serverInfoAction") == "getServerIp") {
                    /* get ip adress */
                    $ips = $apiCall->get("/vps/{$ovhServerName}/ips", $accountId, $location, "Get ip address", true);
                    $ipsErrors = '';
                    if ($ips["httpcode"] == 200) {
                        $iptInfo = $obj->getipData($ips['result'], $ovhServerName, $accountId, $location);
                    } else {
                        $ipsErrors = $diskid["result"]->message;
                    }
                    foreach ($iptInfo as $key => $value) {
                        if ($value->version == "v4") {
                            echo $value->ipAddress;
                        }
                    }
                    exit;
                } else {
                    $serverInfo = $apiCall->get("/vps/{$ovhServerName}", $accountId, $location, "Getting Server Info", true);
                    $html = $obj->serviceInfoHtml($serverInfo, $_ADDONLANG, $ovhCustomHostname, true);
                    echo $html;
                    exit;
                }
            } elseif ($whmcs->get_req_var("serviceMonitoring")) {
                /* Get monitoring status */
                $monitoringStatus = $apiCall->get("/vps/{$ovhServerName}/status", $accountId, $location, "Get Monitoring Status", true);
                $html = $obj->serviceMonitoringHtml($monitoringStatus, $_ADDONLANG, true);
                echo $html;
                exit;
            } elseif ($whmcs->get_req_var("serviceDisk")) {
                /* Get disk id */
                $diskid = $apiCall->get("/vps/{$ovhServerName}/disks", $accountId, $location, "Get diskInfo Status", true);
                $diskErrors = '';
                if ($diskid["httpcode"] == 200) {
                    /* Get disk data */
                    $diskdata = $obj->getDiskData($diskid, $ovhServerName, $accountId, $location);
                } else {
                    $diskErrors = $diskid["result"]->message;
                }
                $html = $obj->diskInfoHtml($diskdata, $diskErrors, $_ADDONLANG, true);
                echo $html;
                exit;
            } elseif ($whmcs->get_req_var("ipAddress")) {
                /* get ip adress */
                $ips = $apiCall->get("/vps/{$ovhServerName}/ips", $accountId, $location, "Get ip address", true);
                $ipsErrors = '';
                if ($ips["httpcode"] == 200) {
                    $iptInfo = $obj->getipData($ips['result'], $ovhServerName, $accountId, $location);
                } else {
                    $ipsErrors = $ips["result"]->message;
                }
                $html = $obj->ipInfoHtml($iptInfo, $ipsErrors, $_ADDONLANG, true);
                echo $html;
                exit;
            }
            $fieldsarray = array(
                ' ' => $obj->serviceInfoHtml([], $_ADDONLANG, $ovhCustomHostname, false),
                '  ' => $obj->serviceMonitoringHtml([], $_ADDONLANG, false),
                '    ' => $obj->snapshotInfoHtml($_ADDONLANG),
                '' => $obj->diskInfoHtml([], '', $_ADDONLANG, false),
                '   ' => $obj->ipInfoHtml([], '', $_ADDONLANG, false),
                '     ' => $obj->featureHtml($configuration->aclSettingsVps(), $serviceId)
            );
            return $fieldsarray;
        }
    } catch (Exception $e) {
        logModuleCall('soyoustart_vps', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());
    }
    return array();
}
function soyoustart_vps_AdminServicesTabFieldsSave(array $params)
{
    global $whmcs;
    try {
        $serviceId = $params["serviceid"];
        $customVieldsValues = Capsule::table('tblcustomfields')
            ->leftJoin('tblcustomfieldsvalues', 'tblcustomfields.id', '=', 'tblcustomfieldsvalues.fieldid')
            ->select('tblcustomfields.fieldname', 'tblcustomfieldsvalues.value', "tblcustomfieldsvalues.fieldid")
            ->where('tblcustomfields.type', 'product')->where('tblcustomfieldsvalues.relid', $serviceId)
            ->where("tblcustomfields.fieldname", "like", "%ovh_custom_hostname|%")
            ->first();
        $location = $params["customfields"]["ovh_server_location"];
        $accountId = explode("-", $params["configoption3"])[0];
        $ovhServerName = trim($params["customfields"]["ovh_server_name"]);
        $configuration = new Configuration();
        $apiCall = new ApiCall();
        $helper = new Helper();
        $aclSettings = $configuration->aclSettingsVps();
        $pid = $params['pid'];
        $postData = [];
        foreach ($aclSettings as $key => $value) {
            $find = str_replace(' ', '_', $value);
            (array_key_exists($find, $_POST) ? $postData[$find] = "on" : $postData[$find] = "");
        }
        if (!empty($postData)) {
            $response = $helper->insert_update("mod_acl_settings", ["key" => "servicePageAclSettings_$serviceId"], ["key" => "servicePageAclSettings_$serviceId", "value" => json_encode($postData)]);
        }
        $customServerName = $_POST["customfield"][$customVieldsValues->fieldid];
        if (!empty($customServerName)) {
            $response = $apiCall->put("/vps/{$ovhServerName}", $accountId, $location, ["displayName" => $customServerName], "Updating custome server name", true);
            if ($response["httpcode"] != 200) {
                logActivity('Updating custom server name on  Error:', $response["result"]->message);
            }
        }
    } catch (Exception $e) {
        logModuleCall('soyoustart_vps', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());
    }
}
function soyoustart_vps_AdminCustomButtonArray()
{
    return array(
        "Reboot Server" => "rebootServer",
        "Console" => "console",
        // "Reinstall" => "reinstall",
        "Rescue Reboot" => "rescuereboot",
        "Power On" => "poweron",
        "Power Off" => "poweroff",
    );
}
function soyoustart_vps_rescuereboot(array $params)
{
    try {
        if ($params["customfields"]["ovh_server_name"]) {
            $apiCall = new ApiCall();
            $location = $params["customfields"]["ovh_server_location"];
            $serverType = $params["moduletype"];
            $ovhServerName = $params["customfields"]["ovh_server_name"];
            $accountId = explode("-", $params["configoption3"])[0];
            $data = ["netbootMode" => "local"];
            $response = $apiCall->recuseService($location, $accountId, $ovhServerName, $data);
            if ($response["httpcode"] != 200) {
                return array(
                    'error' => $response["result"]->message,
                );
            }
            return 'success';
        }
    } catch (Exception $e) {
        /*  // Record the error in WHMCS's module log. */
        logModuleCall('soyoustart_vps', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());
        return $e->getMessage();
    }
}
function soyoustart_vps_rebootServer(array $params)
{
    try {
        if ($params["customfields"]["ovh_server_name"]) {
            $apiCall = new ApiCall();
            $location = $params["customfields"]["ovh_server_location"];
            $serverType = $params["moduletype"];
            $ovhServerName = $params["customfields"]["ovh_server_name"];
            $accountId = explode("-", $params["configoption3"])[0];
            //reboot server 
            $serverreboot = $apiCall->post("/vps/{$ovhServerName}/reboot", $accountId, $location, [], "Reboot Server ", true);
            if ($serverreboot["httpcode"] != 200) {
                return array(
                    'error' => $serverreboot["result"]->message,
                );
            }
            return 'success';
        }
    } catch (Exception $e) {
        /*         // Record the error in WHMCS's module log. */
        logModuleCall('soyoustart_vps', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());
        return $e->getMessage();
    }
    return 'success';
}
function soyoustart_vps_console(array $params)
{
    try {
        $apiCall = new ApiCall();
        $location = $params["customfields"]["ovh_server_location"];
        $serverType = $params["moduletype"];
        $ovhServerName = $params["customfields"]["ovh_server_name"];
        $accountId = explode("-", $params["configoption3"])[0];
        $response = $apiCall->post("/vps/{$ovhServerName}/getConsoleUrl", $accountId, $location, [], "console ", true);
        if ($response["httpcode"] != 200) {
            return array(
                'error' => $response["result"]->message,
            );
        } else {
            $consoleUrl = $response['result'];
            echo '<script>window.open("' . $consoleUrl . '")</script>';
            exit;
            // return 'success';
        }
        return 'success';
    } catch (Exception $e) {
        // Record the error in WHMCS's module log.
        logModuleCall('soyoustart_vps', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());
        return $e->getMessage();
    }
}
function soyoustart_vps_poweron(array $params)
{
    try {
        $apiCall = new ApiCall();
        $location = $params["customfields"]["ovh_server_location"];
        $ovhServerName = $params["customfields"]["ovh_server_name"];
        $accountId = explode("-", $params["configoption3"])[0];
        $response = $apiCall->post("/vps/{$ovhServerName}/start", $accountId, $location, [], "Request the machine to start", true);
        if ($response["httpcode"] != 200) {
            return $response["result"]->message;
        }
        return 'success';
    } catch (Exception $e) {
        logModuleCall('soyoustart_vps', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());
        return $e->getMessage();
    }
}
function soyoustart_vps_poweroff(array $params)
{
    try {
        $apiCall = new ApiCall();
        $location = $params["customfields"]["ovh_server_location"];
        $ovhServerName = $params["customfields"]["ovh_server_name"];
        $accountId = explode("-", $params["configoption3"])[0];
        $response = $apiCall->post("/vps/{$ovhServerName}/stop", $accountId, $location, [], "Request the machine to stop", true);
        if ($response["httpcode"] != 200) {
            return $response["result"]->message;
        }
        return 'success';
    } catch (Exception $e) {
        logModuleCall('soyoustart_vps', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());
        return $e->getMessage();
    }
}
function soyoustart_vps_ClientArea(array $params)
{
    try {
        if (isset($_SESSION['uid']) && !empty($_SESSION['uid'])) {
            $apiCall = new ApiCall();
            $result = Capsule::table("tbladdonmodules")->select('value')->where('setting', 'licenseNumtoactivate')->where('module', 'soyoustart')->first();
            $license = $apiCall->CheckLicense($result->value);
            if ($license["status"] != "Active") {
                return   $license["status"] . " License, Reason: " .$license["description"];
            }
            global $CONFIG;
            global $whmcs;
            /* adding lang file according to whmcs default language */
            $language = $CONFIG['Language'];
            $langfilename = __DIR__ . '/lang/' . $language . '.php';
            if (file_exists($langfilename)) {
                require($langfilename);
            } else {
                require(__DIR__ . '/lang/english.php');
            }
            $pid = $params['pid'];
            /* need to remove this */
            createCustomFields($params['pid']);
            /* need to remove this */
            $assets = $CONFIG['SystemURL'] . "/modules/servers/soyoustart_vps/assets";
            $apiCall = new ApiCall();
            $obj = new server();
            $helper = new Helper();
            $serviceId = $params["serviceid"];
            $location = $params["customfields"]["ovh_server_location"];
            $serverType = $params["moduletype"];
            $ovhServerName = trim($params["customfields"]["ovh_server_name"]);
            $ovhCustomHostname = $params["customfields"]["ovh_custom_hostname"];
            $ovhCustomFTPHostname = $params["customfields"]["ovh_ftp_custom_hostname"];
            $customHostName = '';
            $accountId = explode("-", $params["configoption3"])[0];
            $configoption2 = explode('@', $params['configoption2']);
            $planGroup = $configoption2["0"];
            $planCode = $configoption2["1"];
            $ovhSubsidiaryURL = explode("=", $params['configoption4']);
            $subsidiaryLocation = $ovhSubsidiaryURL[1];
            $billingCycle = $params['model']["billingcycle"];
            $billingData = $obj->formateBillingCycle($billingCycle);
            $additionalIpPrice = $helper->get_data("mod_soyoustart_pricesetting", ["servertype" => $params["configoption1"]], "first");
            /* getting enable setting/feature from service page */
            $enableSettings = $helper->get_data("mod_acl_settings", ["key" => "servicePageAclSettings_$serviceId"], "first");
            $enableSettings = (isset($enableSettings->id) ? json_decode($enableSettings->value, true) : []);
            /* getting enable setting/feature form addon setting  */
            $enableSettingsAddon = Capsule::table('mod_soyoustart_product_settings')->where("product", "like", "$pid\_%")->first();
            $enableSettingsAddon = (isset($enableSettingsAddon->id) ? explode(",", $enableSettingsAddon->settings) : []);
            $errors = [];
            if($ovhServerName == ""){
                $errors[] = "Your server has not been assigned yet, contact support!";
            } else{
                $serverInfo = $apiCall->get("/vps/{$ovhServerName}", $accountId, $location, "Getting Server Info", true);
                $serviceInfos = $apiCall->get("/vps/{$ovhServerName}/serviceInfos", $accountId, $location, "Getting Server Info", true);
                if (!in_array($serviceInfos["result"]->status,[ "active", "running", "ok"])) {
                    $errors[] = "Your server($ovhServerName) has been " . $serviceInfos["result"]->status;
                }
                if ($serverInfo["httpcode"] != 200) {
                    $errors[] = $serverInfo["result"]->message;
                }
            }
            if ($whmcs->get_req_var("monitoring") == "slaMonitoring") {
                $data = ["slaMonitoring" => ($whmcs->get_req_var("ftpAction") == "disable" ? false : true)];
                $response = $apiCall->enableDisableMonitoring($location, $accountId, $ovhServerName, $data, $serverType);
                echo json_encode($response);
                exit;
            } elseif ($whmcs->get_req_var("updateServerName")) {
                $customServerName = $whmcs->get_req_var("customServerName");
                $response = $apiCall->put("/vps/{$ovhServerName}", $accountId, $location, ["displayName" => $customServerName], "Updating custome server name", true);
                if ($response["httpcode"] != 200) {
                    echo json_encode($response);
                    exit;
                }
                $fields = ["ovh_custom_hostname" => $customServerName];
                $update = $helper->insert_custom_fields_value($serviceId, $pid, $fields);
                if ($update == "success") {
                    echo json_encode(["httpcode" => 200, "result" => ""]);
                } else {
                    echo json_encode(["httpcode" => 204, "result" => ["message" => $update]]);
                }
                exit;
            } elseif ($whmcs->get_req_var("manage_ips")) {
                if ($whmcs->get_req_var("getIpDetails")) {
                    $ip = $whmcs->get_req_var("ip");
                    $ipdetails = $apiCall->get("/vps/{$ovhServerName}/ips/$ip", $accountId, $location, "Get ip data", true);
                    $ipforewall = $apiCall->getIpDetails($location, $ovhServerName, $accountId, $ip);
                    if ($ipdetails["httpcode"] != 200) {
                        echo '<div class="alert alert-danger" role="alert">
                            ' . $ipdetails["result"]->message . '
                            </div>';
                        exit;
                    }
                    $ipDetailsHtml = $obj->createIPsHtml($ipdetails["result"], $ipforewall["result"], $_ADDONLANG);
                    echo $ipDetailsHtml;
                    exit;
                } else if ($whmcs->get_req_var("iPaction") == "addDesc") {
                    $ipBlock = urlencode($whmcs->get_req_var("ipblock"));
                    $data = ["description" => $whmcs->get_req_var("desc")];
                    $response = $apiCall->put("/ip/$ipBlock", $accountId, $location, $data, "Edit IP desc", true);
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("iPaction") == "cretaeFirewall") {
                    $ipblock = $whmcs->get_req_var("ip");
                    $response = $apiCall->createFirewall($location, $accountId, $ipblock);
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("iPaction") == "enableDisableFirewall") {
                    $actionType = $whmcs->get_req_var("actionType");
                    $data = ["enabled" => ($actionType == "enable" ? true : false)];
                    $ipBlock = $whmcs->get_req_var("ip");
                    $response = $apiCall->enableDisableFirewall($location, $accountId, $ipBlock, $data);
                    echo json_encode($response);
                    exit;
                } else if ($whmcs->get_req_var("iPaction") == "addFirewallRule") {
                    $data = html_entity_decode($whmcs->get_req_var("data"));
                    $ipReverse = str_replace("::", "", explode("/", $whmcs->get_req_var("ipblock")));
                    parse_str($data, $dataArray);
                    $ipblock = urlencode($whmcs->get_req_var("ipblock"));
                    $endPoint = "/ip/{$ipblock}/firewall/{$ipReverse["0"]}/rule";
                    $data = [
                        "action" => $dataArray["firewallAction"],
                        "protocol" => $dataArray["firewallProtocol"],
                        "sequence" => $dataArray["firewallSequence"],
                        "source" => $whmcs->get_req_var("ipblock"),
                        "destinationPort" => ($dataArray["firewallDestinationPort"]) == "" ? 0 : $dataArray["firewallDestinationPort"],
                        "sourcePort" => ($dataArray["sourcePort"] == "" ? 0 : $dataArray["sourcePort"])
                    ];
                    if ($dataArray["firewallProtocol"] == "tcp" || $dataArray["firewallProtocol"] == "udp") {
                        $data["tcpOption"] = [
                            "fragments" => isset($dataArray["firewallFragements"]) ? true : false,
                            "option" => $dataArray["firewallOption"],
                        ];
                    }
                    $response = $apiCall->post($endPoint, $accountId, $location, $data, "adding firewall rules", true);
                    echo json_encode($response);
                    exit;
                } else if ($whmcs->get_req_var("iPaction") == "getFirewallRules") {
                    $ipblock = urlencode($whmcs->get_req_var("ipblock"));
                    $ipReverse = str_replace("::", "", explode("/", $whmcs->get_req_var("ipblock")));
                    $endPoint = "/ip/{$ipblock}/firewall/{$ipReverse["0"]}/rule";
                    $response = $apiCall->get($endPoint, $accountId, $location, "getting firewall rules", true);
                    if ($response["httpcode"] != 200) {
                        echo json_encode($response);
                        exit;
                    }
                    $html = [];
                    foreach ($response["result"] as $value) {
                        $endPoint = "/ip/{$ipblock}/firewall/{$ipReverse["0"]}/rule/{$value}";
                        $response = $apiCall->get($endPoint, $accountId, $location, "getting firewall rules", true);
                        $state = '-';
                        $action = "";
                        if ($response["result"]->state == "ok") {
                            $state = "<span class=\"badge bg-success\">Active</span>";
                            $action = "<i class=\"fas fa-trash-alt deleteFirewallRule\"></i>";
                        } elseif ($response["result"]->state == "creationPending") {
                            $state = "<span class=\"badge bg-secondary\">Creating</span>";
                        } else {
                            $state = "<span class=\"badge bg-danger\">Deleting</span>";
                        }
                        $html[] = [
                            "sequence" => $response["result"]->sequence,
                            "action" => strtoupper($response["result"]->action),
                            "protocol" => strtoupper($response["result"]->protocol),
                            "destination" => $response["result"]->destination,
                            "sourcePort" => (is_null($response["result"]->sourcePort) ? "-" : $response["result"]->sourcePort),
                            "destinationPort" => is_null($response["result"]->destinationPort) ? "-" : $response["result"]->destinationPort,
                            "tcpOption" => ($response["result"]->fragments) ? "Fragments" : "-",
                            "state" => $state,
                            "delete" => $action,
                        ];
                    }
                    echo json_encode(["data" => $html]);
                    exit;
                } elseif ($whmcs->get_req_var("iPaction") == "deleteFirewallRule") {
                    $ipblock = urlencode($whmcs->get_req_var("ipblock"));
                    $ipReverse = str_replace("::", "", explode("/", $whmcs->get_req_var("ipblock")));
                    $endPoint = "/ip/{$ipblock}/firewall/{$ipReverse["0"]}/rule/{$whmcs->get_req_var("sequese")}";
                    $data = [];
                    $response = $apiCall->__delete($endPoint, $accountId, $location, $data, "deleting firewall rules", true);
                    echo json_encode($response);
                    exit;
                } else if ($whmcs->get_req_var("iPaction") == "addReverseIp") {
                    $ipReverse = str_replace("::", "", explode("/", $whmcs->get_req_var("ipblock")));
                    $data = ["ipReverse" => $ipReverse["0"], "reverse" => $whmcs->get_req_var("reverseIp")];
                    $test = urlencode($whmcs->get_req_var("ipblock"));
                    $endPoint = "/ip/{$test}/reverse";
                    $response = $apiCall->post($endPoint, $accountId, $location, $data, "adding reverse ip for IPv4", true);
                    echo json_encode($response);
                    exit;
                }
                elseif ($whmcs->get_req_var("iPaction") == "updateIP6Reverse") {
                    $data = ["ipReverse" => urlencode($whmcs->get_req_var("ip")), "reverse" => $whmcs->get_req_var("reverseDNS")];
                    $ipblock = urlencode($whmcs->get_req_var("ipblock"));
                    $endPoint = "/ip/{$ipblock}/reverse";
                    $response = $apiCall->post($endPoint, $accountId, $location, $data, "adding reverse dns for IPv6", true);
                    echo json_encode($response);
                    exit;
                }            
                elseif ($whmcs->get_req_var("iPaction") == "deleteFirewall") {
                    $ipblock = $whmcs->get_req_var("ipblock");
                    $response = $apiCall->deleteFirewall($location, $accountId, $ipblock);
                    echo json_encode($response);
                    exit;
                } else if ($whmcs->get_req_var("iPaction") == "mitigration") {
                    $ipv4 = explode("/", $whmcs->get_req_var("ipblock"));
                    $ipblock = urlencode($whmcs->get_req_var("ipblock"));
                    if ($whmcs->get_req_var("mitigrationIp")) {
                        $mitigrationIp = $whmcs->get_req_var("mitigrationIp");
                        $endPoint = "/ip/{$ipblock}/mitigation/{$mitigrationIp}";
                        $response = $apiCall->__delete($endPoint, $accountId, $location, [], "delete mitigration", true);
                    } else {
                        $endPoint = "/ip/{$ipblock}/mitigation";
                        $data = ["ipOnMitigation" => $ipv4[0]];
                        $response = $apiCall->post($endPoint, $accountId, $location, $data, "adding mitigration", true);
                    }
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("iPaction") == "addAdditionalIp") {
                    /* creating cart */
                    $cartDetails = $apiCall->createCart($location, $planCode . "add Additional IPs", $subsidiaryLocation);
                    if ($cartDetails["httpcode"] != 200) {
                        echo json_encode($cartDetails);
                        exit;
                    }
                    $cartId = $cartDetails["result"]->cartId;
                    $quantity = (int) $whmcs->get_req_var("numberOfIp");
                    $postData = array(
                        'duration' => $billingData["durationVal"],
                        'planCode' => 'ip-failover-arin',
                        'pricingMode' => $billingData["pricingModeVal"],
                        'quantity' => (int) $whmcs->get_req_var("numberOfIp")
                    );
                    /* assigning ip into cart */
                    $assignIpData = $apiCall->post("/order/cart/{$cartId}/ip", $accountId, $location, $postData, "Assigning ip into cart", true);
                    if ($assignIpData["httpcode"] != 200) {
                        echo json_encode($assignIpData);
                        exit;
                    }
                    /* assigning ip options */
                    $itemId = $assignIpData["result"]->itemId;
                    $ipconfig = $apiCall->post("/order/cart/{$cartId}/item/{$itemId}/configuration", $accountId, $location, ["label" => "country", "value" => "CA"], "assigning country to ip");
                    $cartassign = $apiCall->assignCart('/order/cart/' . $cartId . '/assign', $accountId, $location);
                    if ($cartassign["httpcode"] != 200) {
                        echo json_encode($cartassign);
                        exit;
                    }
                    $orderDetails = $apiCall->post("/order/cart/{$cartId}/checkout", $accountId, $location, [], "Getting checkout Info", true);
                    if ($orderDetails["httpcode"] == 200) {
                        $orderId = $orderDetails["result"]->orderId;
                        $userId = $params["userid"];
                        $results = $obj->createAdditionalIpInvoice($userId, $quantity, $additionalIpPrice);
                        // $createdinvoiceId = 3;
                        if ($results['result'] != "success") {
                            echo json_encode($results);
                            exit;
                        }
                        $createdinvoiceId = $results['invoiceid'];
                        $data = [
                            "invoiceid" => $createdinvoiceId,
                            "iporderid" => $orderId,
                            "service_id" => $params["serviceid"],
                            "status" => 0,
                        ];
                        $updatedata = $obj->InsertIpData("mod_soyoustart_ips_orders", $data);
                        if ($updatedata) {
                            $response = [
                                "httpcode" => 200,
                                "result" => [
                                    "invoiceid" => $createdinvoiceId,
                                    "message" => "Order has been created successfully!",
                                ]
                            ];
                            echo json_encode($response);
                            exit;
                        }
                    }
                } elseif ($whmcs->get_req_var("iPaction") == "viewIpDetails") {
                    $ip = explode("/", $whmcs->get_req_var("ipblock"));
                    $ipdetails = $apiCall->get("/vps/{$ovhServerName}/ips/$ip[0]", $accountId, $location, "Get ip data", true);
                    $ipdetail = $apiCall->getIpDetails($location, $ovhServerName, $accountId, $whmcs->get_req_var("ipblock"));
                    $html = $obj->createIpDetailsHtmlvps($ipdetails, $ipdetail, $_ADDONLANG);
                    echo $html;
                    exit;
                } else {
                    $ips = $apiCall->get("/vps/{$ovhServerName}/ips", $accountId, $location, "Get ip address", true);
                    if ($ips["httpcode"] != 200) {
                        echo '<div class="alert alert-danger" role="alert">
                            ' . $ips["result"]->message . '
                            </div>';
                        exit;
                    }
                    $ipsHtml = $obj->createIpListHtml($ips["result"], $apiCall, $location, $ovhServerName, $accountId, $_ADDONLANG);
                    echo $ipsHtml;
                    exit;
                }
            } elseif ($whmcs->get_req_var("power")) {
                if ($whmcs->get_req_var("boot") == "hardreboot") {
                    $response = $apiCall->post("/vps/{$ovhServerName}/reboot", $accountId, $location, [], "Reboot Server ", true);
                    if ($response["httpcode"] != 200) {
                        $error = $response["result"]->message;
                        echo json_encode($response);
                        exit;
                    }
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("boot") == "netBoot") {
                    $data = ($whmcs->get_req_var("type") == "local") ? ["netbootMode" => "local"] : ["netbootMode" => "rescue"];
                    $response = $apiCall->recuseService($location, $accountId, $ovhServerName, $data);
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("boot") == "serverOnOff") {
                    $response = $apiCall->post("/vps/{$ovhServerName}/{$whmcs->get_req_var("type")}", $accountId, $location, [], "Request the machine to {$whmcs->get_req_var("type")}", true);
                    echo json_encode($response);
                    exit;
                }
            } elseif ($whmcs->get_req_var("console")) {
                $response = $apiCall->post("/vps/{$ovhServerName}/getConsoleUrl", $accountId, $location, [], "console ", true);
                if ($response["httpcode"] != 200) {
                    $error = $response["result"]->message;
                    echo json_encode($response);
                    exit;
                }
                echo json_encode($response);
                exit;
            } elseif ($whmcs->get_req_var("getDatacenter")) {
                $dataCenter = $apiCall->get("/vps/{$ovhServerName}/datacenter", $accountId, $location, "Geting datacenter", true);
                if ($dataCenter["httpcode"] != 200) {
                    echo $dataCenter["result"]->message;
                    exit;
                }
                echo $dataCenter["result"]->longName;
                exit;
            } elseif ($whmcs->get_req_var("getOpetaingSystem")) {
                $operatingSystem = $apiCall->get("/vps/{$ovhServerName}/images/current", $accountId, $location, "Geting operating system", true);
                if ($operatingSystem["httpcode"] != 200) {
                    echo $operatingSystem["result"]->message;
                    exit;
                }
                echo $operatingSystem["result"]->name;
                exit;
            } elseif ($whmcs->get_req_var("getIps")) {
                $response = $apiCall->get("/ip?routedTo.serviceName=$ovhServerName", $accountId, $location, "Geting IPs", true);
                if ($response["httpcode"] != 200) {
                    echo $response["result"]->message;
                    exit;
                }
                $ipV4 = [];
                $ipV6 = [];
                foreach ($response["result"] as $ip) {
                    $ipchk = explode(':', $ip);
                    if (count($ipchk) < 2) {
                        $ipV4[] = explode("/", $ip)[0];
                    } else {
                        $ipV6[] = explode("::", $ip)[0];
                    }
                }
                echo json_encode(["ipv4" => $ipV4, "ipv6" => $ipV6]);
                exit;
            } elseif ($whmcs->get_req_var("snapshot")) {
                if ($whmcs->get_req_var("snapshotAction") == "orderSnapshot") {
                    /* creating cart */
                    $cartDetails = $apiCall->createCart($location, $planCode . "creating cart", $subsidiaryLocation);
                    if ($cartDetails["httpcode"] != 200) {
                        echo json_encode($cartDetails);
                        exit;
                    }
                    $cartId = $cartDetails["result"]->cartId;
                    $cartassign = $apiCall->assignCart('/order/cart/' . $cartId . '/assign', $accountId, $location);
                    if ($cartassign["httpcode"] != 200) {
                        echo json_encode($cartassign);
                        exit;
                    }
                    $snapshotPlanCode = false;
                    foreach ($params["templatevars"]["configurableoptions"] as $key => $options) {
                        if ($options["optionname"] == "Snapshot") {
                            $snapshotPlanCode = Capsule::table("tblproductconfigoptionssub")->where("id", $options["selectedvalue"])->select("optionname")->first();
                            $snapshotPlanCode = str_replace("_", "-", (explode("|", $snapshotPlanCode->optionname)[0]));
                        }
                    }
                    $data = ["cartId" => $cartId, "duration" => $billingData["durationVal"], "planCode" => $snapshotPlanCode, "pricingMode" => $billingData["pricingModeVal"], "quantity" => (int) 1];
                    $response = $apiCall->post("/order/cartServiceOption/vps/{$ovhServerName}", $accountId, $location, $data, "assigning snapshot option in cart", true);
                    if ($response["httpcode"] != 200) {
                        echo json_encode($response);
                        exit;
                    }
                    $itemId = $response["result"]->itemId;
                    // $itemId = 43438859;
                    $response = $apiCall->post("/order/cart/{$cartId}/checkout", $accountId, $location, [], "ordering snapshot", true);
                    if ($response["httpcode"] != 200) {
                        echo json_encode($response);
                        exit;
                    }
                    $orderId = $response["result"]->orderId;
                    // $orderId = 17291633;
                    $fields = ["ovh_snapshot_order_id" => $orderId];
                    $helper->insert_custom_fields_value($serviceId, $pid, $fields);
                    $userId = $params["userid"];
                    $snapshotPrice = $additionalIpPrice->snapprice;
                    $discription = "Creating snapshot";
                    $results = $obj->createInvoice($userId, $snapshotPrice, $discription);
                    $createdinvoiceId = $results['invoiceid'];
                    $data = [
                        "invoiceid" => $createdinvoiceId,
                        "iporderid" => $orderId,
                        "service_id" => $params["serviceid"],
                        "status" => 0,
                    ];
                    $updatedata = $obj->InsertIpData("mod_soyoustart_ips_orders", $data);
                    if ($updatedata) {
                        $response = [
                            "httpcode" => 200,
                            "result" => [
                                "invoiceid" => $createdinvoiceId,
                                "message" => "Order has been created successfully!",
                            ]
                        ];
                        echo json_encode($response);
                        exit;
                    }
                    exit;
                } elseif ($whmcs->get_req_var("snapshotAction") == "createSnapshot") {
                    $response = $apiCall->post("/vps/{$ovhServerName}/createSnapshot", $accountId, $location, ["description" => $whmcs->get_req_var("desc")], "creating snapshot", true);
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("snapshotAction") == "snapshoteditDesc") {
                    $data = ["description" => $whmcs->get_req_var("desc")];
                    $response = $apiCall->put("/vps/{$ovhServerName}/snapshot", $accountId, $location, $data, "updating snapshot description", true);
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("snapshotAction") == "deleteSnapshot") {
                    $response = $apiCall->__delete("/vps/{$ovhServerName}/snapshot", $accountId, $location, [], "deleting snapshot", true);
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("snapshotAction") == "revertSnapshot") {
                    $response = $apiCall->post("/vps/{$ovhServerName}/snapshot/revert", $accountId, $location, [], "reverting snapshot", true);
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("snapshotAction") == "getStatus") {
                    $taskid = $whmcs->get_req_var("taskID");
                    $response = $apiCall->get("/vps/{$ovhServerName}/tasks/{$taskid}", $accountId, $location, "Getting task status", true);
                    echo json_encode($response);
                    exit;
                } else {
                    $snapshotOrderId = $params["customfields"]["ovh_snapshot_order_id"];
                    $orderStatus = [];
                    if ($snapshotOrderId) {
                        $orderStatus = $apiCall->get("/me/order/{$snapshotOrderId}/status", $accountId, $location, "Getting snapshot order status", true);
                    }
                    /* Get Snapshot info */
                    $snapshotInfo = $apiCall->get("/vps/{$ovhServerName}/snapshot", $accountId, $location, "Getting snapshot information", true);
                    $html = $obj->cretateSnapshotHtml($snapshotInfo, $orderStatus, $_ADDONLANG);
                    echo $html;
                    exit;
                }
            } elseif ($whmcs->get_req_var("reinstall")) {
                if ($whmcs->get_req_var("reinstallAction") == "gettemplate") {
                    // $availableTemplates = $apiCall->get("/vps/{$ovhServerName}/templates", $accountId, $location, "Getting Templates ids", true);
                    $availableTemplates = $apiCall->get("/vps/{$ovhServerName}/images/available", $accountId, $location, "Getting Templates ids", true);
                    if ($availableTemplates["httpcode"] != 200) {
                        $error = $availableTemplates["result"]->message;
                        echo json_encode(["error" => "true", "html" => $error]);
                        exit;
                    }
                    $html = '';
                    foreach ($availableTemplates["result"] as $key => $value) {
                        $availableTemplateDetails = $apiCall->get("/vps/{$ovhServerName}/images/available/{$value}", $accountId, $location, "Getting Template details", true);
                        // $availableTemplateDetails = $apiCall->get("/vps/{$ovhServerName}/templates/{$value}", $accountId, $location, "Getting Template details", true);
                        if ($availableTemplateDetails["httpcode"] != 200) {
                            echo json_encode(["error" => "true", "html" => $availableTemplateDetails["result"]->message]);
                            exit;
                        }
                        $html .= '<option value="' . $value . '">' . ucwords(str_replace(array('-', '_'), ' ', $availableTemplateDetails["result"]->name)) . '</option>';
                    }
                    echo json_encode(["html" => $html]);
                    exit;
                } elseif ($whmcs->get_req_var("reinstallAction") == "re-install") {
                    $sshKey = $whmcs->get_req_var("sshKey");
                    $template = $whmcs->get_req_var("templateName");
                    $data = ["imageId" => $template];
                    // $response = $apiCall->post("/vps/{$ovhServerName}/reinstall", $accountId, $location, $data, "re-install the os", true);
                    $response = $apiCall->post("/vps/{$ovhServerName}/rebuild", $accountId, $location, $data, "re-install the os", true);
                    echo json_encode($response);
                    exit;
                }
            } elseif ($whmcs->get_req_var("backup")) {
                if ($whmcs->get_req_var("backupAction") == "orderBackup") {
                    $cartDetails = $apiCall->createCart($location, $planCode . "creating cart", $subsidiaryLocation);
                    if ($cartDetails["httpcode"] != 200) {
                        echo json_encode($cartDetails);
                        exit;
                    }
                    $cartId = $cartDetails["result"]->cartId;
                    $cartassign = $apiCall->assignCart('/order/cart/' . $cartId . '/assign', $accountId, $location);
                    if ($cartassign["httpcode"] != 200) {
                        echo json_encode($cartassign);
                        exit;
                    }
                    $backupPlanCode = false;
                    foreach ($params["templatevars"]["configurableoptions"] as $key => $options) {
                        if ($options["optionname"] == "Automated Backup") {
                            $backupPlanCode = Capsule::table("tblproductconfigoptionssub")->where("id", $options["selectedvalue"])->select("optionname")->first();
                            $backupPlanCode = str_replace("_", "-", (explode("|", $backupPlanCode->optionname)[0]));
                        }
                        $data = ["cartId" => $cartId, "duration" => $billingData["durationVal"], "planCode" => $backupPlanCode, "pricingMode" => $billingData["pricingModeVal"], "quantity" => (int) 1];
                        $response = $apiCall->post("/order/cartServiceOption/vps/{$ovhServerName}", $accountId, $location, $data, "assigning Autobackup option in cart", true);
                        if ($response["httpcode"] != 200) {
                            echo json_encode($response);
                            exit;
                        }
                        $itemId = $response["result"]->itemId;
                        $response = $apiCall->post("/order/cart/{$cartId}/checkout", $accountId, $location, [], "ordering automated Backup", true);
                        if ($response["httpcode"] != 200) {
                            echo json_encode($response);
                            exit;
                        }
                        $orderId = $response["result"]->orderId;
                        $fields = ["ovh_automated_backup_order_id" => $orderId];
                        $helper->insert_custom_fields_value($serviceId, $pid, $fields);
                        $userId = $params["userid"];
                        $snapshotPrice = $additionalIpPrice->snapprice;
                        $discription = "Creating snapshot";
                        $results = $obj->createInvoice($userId, $snapshotPrice, $discription);
                        $createdinvoiceId = $results['invoiceid'];
                        $data = [
                            "invoiceid" => $createdinvoiceId,
                            "iporderid" => $orderId,
                            "service_id" => $params["serviceid"],
                            "status" => 0,
                        ];
                        $updatedata = $obj->InsertIpData("mod_soyoustart_ips_orders", $data);
                        if ($updatedata) {
                            $response = [
                                "httpcode" => 200,
                                "result" => [
                                    "invoiceid" => $createdinvoiceId,
                                    "message" => "Order has been created successfully!",
                                ]
                            ];
                            echo json_encode($response);
                            exit;
                        }
                        die("kk");
                    }
                } else {
                    $BackupData = $apiCall->get("/vps/{$ovhServerName}/automatedBackup", $accountId, $location, "Getting backup data", true);
                    $html = $obj->cretateBackupHtml($BackupData, $BackupData, $_ADDONLANG);
                    echo $html;
                    exit;
                }
            }
            return array(
                "templatefile" => 'templates/clientareanew.tpl',
                'templateVariables' => array(
                    "hi" => "soyostart vps",
                    'LANG' => $_ADDONLANG,
                    'assets' => $assets,
                    'aditionalIpPrice' => $additionalIpPrice,
                    'errors' => $errors,
                    "ovhCustomHostname" => empty($ovhCustomHostname) ? (empty($serverInfo["result"]->displayName) ? $serverInfo["result"]->name : $serverInfo["result"]->displayName) : $ovhCustomHostname,
                    'params' => $params,    
                    'serverInfo' => $serverInfo["result"],
                    'aclSettingsVps' => $enableSettings,
                    'enableSettingsAddon' => $enableSettingsAddon,
                    'clientCurrency' => getCurrency($params["userid"]),
                    'clientareatemplate' => $params["clientareatemplate"],
                )
            );
        }
    } catch (Exception $e) {
        logModuleCall("soyoustart_vps", __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());
    }
}
function createCustomFields($pid)
{
    try {
        $customfieldarray = [
            'ovh_account' => [
                'type' => 'product',
                'fieldname' => 'ovh_account|OVH Account Name',
                'relid' => $pid,
                'fieldtype' => 'text',
                'description' => 'OVH Account Name.',
                'adminonly' => 'on',
                'sortorder' => '0'
            ],
            'ovh_server_name' => [
                'type' => 'product',
                'fieldname' => 'ovh_server_name|OVH Server Name',
                'relid' => $pid,
                'fieldtype' => 'text',
                'description' => 'OVH Server Name.',
                'adminonly' => 'on',
                'sortorder' => '0'
            ],
            'ovh_server_location' => [
                'type' => 'product',
                'fieldname' => 'ovh_server_location|OVH Server Location',
                'relid' => $pid,
                'fieldtype' => 'text',
                'description' => 'OVH Server Location.',
                'adminonly' => 'on',
                'sortorder' => '0'
            ],
            'ovh_custom_hostname' => [
                'type' => 'product',
                'fieldname' => 'ovh_custom_hostname|OVH Custom Hostname',
                'relid' => $pid,
                'fieldtype' => 'text',
                'description' => 'OVH Custom Hostname.',
                'adminonly' => 'on',
                'sortorder' => '0'
            ],
            'ovh_ftp_custom_hostname' => [
                'type' => 'product',
                'fieldname' => 'ovh_ftp_custom_hostname|OVH FTP Custom Hostname',
                'relid' => $pid,
                'fieldtype' => 'text',
                'description' => 'OVH FTP Custom Hostname.',
                'adminonly' => 'on',
                'sortorder' => '0'
            ],
            'ovh_reveser_dns_custom_hostname' => [
                'type' => 'product',
                'fieldname' => 'ovh_reveser_dns_custom_hostname|OVH Reveser DNS Custom Hostname',
                'relid' => $pid,
                'fieldtype' => 'text',
                'description' => 'OVH Reveser DNS Custom Hostname.',
                'adminonly' => 'on',
                'sortorder' => '0'
            ],
            'ovh_order_id' => [
                'type' => 'product',
                'fieldname' => 'ovh_order_id|OVH Order Id',
                'relid' => $pid,
                'fieldtype' => 'text',
                'description' => 'OVH Order Id.',
                'adminonly' => 'on',
                'sortorder' => '0'
            ],
            'ovh_snapshot_order_id' => [
                'type' => 'product',
                'fieldname' => 'ovh_snapshot_order_id|OVH Snapshot Order Id',
                'relid' => $pid,
                'fieldtype' => 'text',
                'description' => 'OVH Snapshot Order Id.',
                'adminonly' => 'on',
                'sortorder' => '0'
            ],
            'ovh_automated_backup_order_id' => [
                'type' => 'product',
                'fieldname' => 'ovh_automated_backup_order_id|OVH Automated Backup Order Id',
                'relid' => $pid,
                'fieldtype' => 'text',
                'description' => 'OVH Automated Backup Order Id.',
                'adminonly' => 'on',
                'sortorder' => '0'
            ]
        ];
        foreach ($customfieldarray as $key => $customfieldval) {
            $fieldname = explode('|', $customfieldval['fieldname']);
            $exist_custom_fields = Capsule::table('tblcustomfields')->where('type', $customfieldval['type'])->where('relid', $customfieldval['relid'])->where('fieldname', 'like', $fieldname[0] . '|%')->get();
            if (!isset($exist_custom_fields[0]->id)) {
                Capsule::table('tblcustomfields')->insert($customfieldval);
            } {
                Capsule::table('tblcustomfields')->where("relid", $pid)->where("type", "product")->where('fieldname', 'like', $fieldname[0] . '|%')->update(["fieldname" => $customfieldval["fieldname"], "description" => $customfieldval['description']]);
            }
        }
    } catch (\Exception $e) {
        logActivity("Creating Custom Fields Error: {$e->getMessage()}");
    }
}
