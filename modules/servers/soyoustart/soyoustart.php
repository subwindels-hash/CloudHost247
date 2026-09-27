<?php

require_once __DIR__ . '/../../addons/soyoustart/classes/ApiCall.php';
require_once __DIR__ . '/../../addons/soyoustart/classes/Configuration.php';

use WGSModule\Soyoustart\classes\ApiCall;
use WHMCS\Module\Server\Soyoustart\SoyoustartServer;
use WHMCS\Database\Capsule;
use WGSModule\Soyoustart\classes\Configuration;
use WHMCS\Module\Addon\Soyoustart\Helper;

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

function soyoustart_MetaData()
{
    return array(
        'DisplayName' => 'Soyoustart',
        'APIVersion' => '1.1',
    );
}

function soyoustart_ConfigOptions()
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
            'Description' => 'Account details from setting tab Eg: id-location-emial(1-canada-abc@gmail.com)',
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
/**
 * Provision a new instance of a product/service.
 *
 * Attempt to provision a new instance of a given product/service. This is
 * called any time provisioning is requested inside of WHMCS. Depending upon the
 * configuration, this can be any of:
 * * When a new order is placed
 * * When an invoice for a new order is paid
 * * Upon manual request by an admin user
 *
 * @param array $params common module parameters
 *
 * @see https://developers.whmcs.com/provisioning-modules/module-parameters/
 *
 * @return string "success" or an error message
 */
function soyoustart_CreateAccount(array $params)
{
    try {
        global $CONFIG;
        $obj = new SoyoustartServer();
        $apiCall = new ApiCall();
        $helper = new Helper();
        $result = Capsule::table("tbladdonmodules")->select('value')->where('setting', 'licenseNumtoactivate')->where('module', 'soyoustart')->first();
        $license = $apiCall->CheckLicense($result->value);

        if ($license["status"] != "Active") {
            return   $license["ststus"] . " License";
        }

        $serviceId = $params['serviceid'];

        // $serviceConfigs = $obj->getServiceConfigs($serviceId);

        $pid = $params['pid'];

        $domainName = explode("//", $CONFIG["Domain"])[1];
        $defaultCustomHostName = $helper->get_data("mod_acl_settings", ["key" => "generalaclSettings"], "first");
        $defaultCustomHostName = (!empty($defaultCustomHostName->id) ? json_decode($defaultCustomHostName->value, true)["defaultCustomHostName"] : "WHMCS_$serviceId'_'$domainName");

        /* formating billing cycle data for API */
        $billingCycle = $params['model']["billingcycle"];
        $billingData = $obj->formateBillingCycle($billingCycle);

        $configoption2 = explode('@', $params['configoption2']);
        $ovhAccountData = explode('-', $params['configoption3']);
        if (count($ovhAccountData) == 4)
            unset($ovhAccountData[1]);

        $ovhAccountData = array_values($ovhAccountData);

        $location = $ovhAccountData["1"];
        $planGroup = $configoption2["0"];
        $planCode = $configoption2["1"];
        $ovhSubsidiaryURL = explode("=", $params['configoption4']);

        $subsidiaryLocation = $ovhSubsidiaryURL[1];
        $ovhPaymentMethod = $helper->get_data("mod_soyoustart_pricesetting", ["server" => "OVH", "servertype" => $params["configoption1"]], "first");
        $orderid = $params['customfields']['ovh_order_id'];
        $paymentmethod = $ovhPaymentMethod->paymentmethod;

        if (!empty($params['customfields']['ovh_order_id'])) {
            $paymentresponse = $apiCall->getpaymentdetail($params, $orderid, $paymentmethod, $pid, $serviceId, $ovhAccountData, $location);

            if (is_array($paymentresponse)) {
                if ($paymentresponse["httpcode"] == 200) {
                    if (!empty($paymentresponse["result"]->domain) && !str_contains($paymentresponse["result"]->domain, "*001")) {
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

        $postData = [];
        if ($planGroup == "kimsufi" || $planGroup == "soyoustart" || $planGroup == "rise") {
            // $productInfo = $apiCall->get('/order/cart/' . $cartId . '/eco', $ovhAccountData[0], $location, "Get Info for eco server");
            $productInfo = $apiCall->get("/order/cart/{$cartId}/eco/options?planCode={$planCode}", $ovhAccountData[0], $location, "Get Info for eco server");
            if ($productInfo["httpcode"] != 200) {
                return $productInfo['result']->message;
            }
            $postData = array('duration' => $billingData["durationVal"], 'planCode' => $planCode, 'pricingMode' => $billingData["pricingModeVal"], 'quantity' => (int) 1);
        } else {
            // $productInfo = $apiCall->get('/order/cart/' . $cartId . '/baremetalServers', $ovhAccountData[0], $location, "Get info for baremetal server");
            $productInfo = $apiCall->get("/order/cart/{$cartId}/baremetalServers/options?planCode={$planCode}", $ovhAccountData[0], $location, "Get info for baremetal server");
            if ($productInfo["httpcode"] != 200) {
                return $productInfo['result']->message;
            }
            $postData = array('duration' => $billingData["durationVal"], 'planCode' => $planCode, 'pricingMode' => $billingData["pricingModeVal"], 'quantity' => (int) 1);
        }

        // if (empty($postData)) {
        //     return 'Product is not found. Please check product again on OVH.';
        // }
        /* assigning product in cart     */

        if ($planGroup == "kimsufi" || $planGroup == "soyoustart" || $planGroup == "rise") {
            $response = $apiCall->addItemInCart('/order/cart/' . $cartId . '/eco', $ovhAccountData[0], $postData, $location);
        } else {
            $response = $apiCall->addItemInCart('/order/cart/' . $cartId . '/baremetalServers', $ovhAccountData[0], $postData, $location);
        }

        if ($response["httpcode"] != 200) {
            return $response['result']->message;
        }

        $itemid = $response["result"]->itemId;

        $requiredConfiguration = $apiCall->get('/order/cart/' . $cartId . '/item/' . $itemid . '/requiredConfiguration', $ovhAccountData[0], $location, "Getting required configurations");
        if ($requiredConfiguration["httpcode"] != 200) {
            return $requiredConfiguration['result']->message;
        }
        $serviceConfigs = $params["configoptions"];
        foreach ($serviceConfigs as $opname => $config) {
            // $opname = explode("|", $config->opname)[0];
            if (in_array($opname, ["storage", "disk", "memory", "private_network", "public_network", "additional_ips", "cpanel", "windows", "sqlserver", "plesk", "system_storage", "application_license", "distribution_license"]) && !str_contains($config, "none")) {
                $planCode = $config;
                // $planCode = explode('|', $config->optionname);
                $postData = array('duration' => $billingData["durationVal"], 'itemId' => $itemid, 'planCode' => $planCode, 'pricingMode' => $billingData["pricingModeVal"], 'quantity' => 1);
                /* assigning config option to the cart */
                if ($planGroup == "kimsufi" || $planGroup == "soyoustart" || $planGroup == "rise") {
                    $assignConfOptionToCart = $apiCall->addConfigOptInCart('/order/cart/' . $cartId . '/eco/options', $ovhAccountData[0], $postData, $location);
                } else {
                    $assignConfOptionToCart = $apiCall->addConfigOptInCart('/order/cart/' . $cartId . '/baremetalServers/options', $ovhAccountData[0], $postData, $location);
                }

                if ($assignConfOptionToCart["httpcode"] != 200) {
                    return $assignConfOptionToCart['result']->message;
                }
            } else if (
                in_array($opname, ["server_location", "Server Location", "Opreating_system", "opreating_system"]) && !str_contains($config, "none")
            ) {
                foreach ($requiredConfiguration["result"] as $requiredConfigurationData) {
                    $postData = [];
                    if ($requiredConfigurationData->required || $requiredConfigurationData->label == 'dedicated_datacenter') {
                        if ($requiredConfigurationData->label == 'dedicated_datacenter' && (in_array($opname, ["Server Location", "server_location"]))) {
                            $optionname = $config;
                            // $optionname = explode("|", $config->optionname);
                            $dedicatedlabelvalue = $optionname;
                            $postData = array('label' => $requiredConfigurationData->label, 'value' => $dedicatedlabelvalue);
                        } elseif ($requiredConfigurationData->label == 'dedicated_os') {
                            $dedicatedlabelvalue = $requiredConfigurationData->allowedValues[0];
                            if (empty($dedicatedlabelvalue)) {
                                $dedicatedlabelvalue = 'en';
                            }
                            $postData = array('label' => $requiredConfigurationData->label, 'value' => $dedicatedlabelvalue);
                        } else {
                            $dedicatedlabelvalue = $requiredConfigurationData->allowedValues[0];
                            $postData = array('label' => $requiredConfigurationData->label, 'value' => $dedicatedlabelvalue);
                        }
                        if (!empty($postData)) {
                            $response = $apiCall->addConfigOptInCart('/order/cart/' . $cartId . '/item/' . $itemid . '/configuration', '', $postData, $location);
                            if ($response["httpcode"] != 200) {
                                return $response['result']->message;
                            }
                        }
                    }
                }
            }
        }
        $response = $apiCall->createOrder('/order/cart/' . $cartId . '/checkout', $ovhAccountData[0], $location);
        if ($response["httpcode"] != 200) {
            if (isset($response['result']->message) && $response['result']->message == "You are not allowed") {
                return"This plan has depricated by OVH and cannot be ordered. Please choose another plan.";
            }else {
                return $response['result']->message;
            }

        }
        $orderid = $response["result"]->orderId;
        /* updating admin custom fields */

        $fields = ["ovh_account" => $ovhAccountData[2], "ovh_server_location", $location, "ovh_order_id" => $orderid, "ovh_custom_hostname" => $defaultCustomHostName];
        $helper->insert_custom_fields_value($serviceId, $pid, $fields);
        $paymentmethod = $ovhPaymentMethod->paymentmethod;

        $paymentresponse = $apiCall->getpaymentdetail($params, $orderid, $paymentmethod, $pid, $serviceId, $ovhAccountData, $location);

        if (is_array($paymentresponse)) {
            if ($paymentresponse["httpcode"] == 200) {
                if (!empty($paymentresponse["result"]->domain) && !str_contains($paymentresponse["result"]->domain, "*001")) {
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

        return $paymentresponse;
        return 'success';
    } catch (Exception $e) {
        logModuleCall('soyoustart', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());
        return $e->getMessage();
    }
    return 'success';
}

function soyoustart_Renew(array $params)
{
    try {
        // return false;
        // $apiCall = new ApiCall();
        // $location = $params["customfields"]["ovh_server_location"];
        // $serverType = $params["moduletype"];
        // $ovhServerName = $params["customfields"]["ovh_server_name"];
        // $accountId = explode("-", $params["configoption3"])[0];

        // /* getting service details */
        // $serverInfo = $apiCall->get("/dedicated/server/{$ovhServerName}/serviceInfos", $accountId, $location, "getting service details", true);


        // // if($serverInfo["httpcode"] != 200){
        // //     return $serverInfo["result"]->message;
        // // }
        // // $serviceId = $serverInfo["result"]->serverId;
        // $serviceId = 38584247;

        // /* getting server details */
        // // $serverdetails = $apiCall->get("/service/{$serviceId}", $accountId, $location, "getting server details", true);

        // // if ($serverdetails["httpcode"] != 200) {
        // //     return $serverdetails["result"]->message;
        // // }


        // // $renewDetails = $apiCall->post("/service/{$serviceId}/renew", $accountId, $location, ["dryRun" => False,"duration" => "P1M","services" => array($serviceId)], "getting server details", true);
        // $renewDetails = $apiCall->post("/service/{$serviceId}/reopen", $accountId, $location, [], "getting server details", true);

        // echo "<pre>";
        // print_r($renewDetails);
        // exit;




    } catch (Exception $e) {
        logModuleCall('soyoustart', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());

        return $e->getMessage();
    }

    return 'success';
}


function soyoustart_AdminServicesTabFields(array $params)
{
    try {

        if ($params["customfields"]["ovh_server_name"] && $params["customfields"]["ovh_order_id"]) {
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
            $obj = new SoyoustartServer();
            $configuration = new Configuration();
            $serviceId = $params["serviceid"];
            $location = $params["customfields"]["ovh_server_location"];
            $serverType = $params["moduletype"];
            $ovhServerName = $params["customfields"]["ovh_server_name"];
            $accountId = explode("-", $params["configoption3"])[0];
            $ovhCustomHostname = $params["customfields"]["ovh_custom_hostname"];
            $result = $apiCall->get_data("tblproducts", ["id" => $params["pid"]], "first")->description;

            $processor = $obj->seachData($result, "Processor :</b>");
            $disk = $obj->seachData($result, "Disk:</b>");
            $dataCenter = $configuration->dataCenter();

            $ipsErrors = '';
            if ($whmcs->get_req_var("ajaxAction")) {

                if ($whmcs->get_req_var("serviceinfoAction") == "getServiceInfo") {
                    $serverInfo = $apiCall->getServerInfo($location, $serverType, $ovhServerName, $accountId);
                    $hardwareInfo = $apiCall->getHardwareInfo($location, $serverType, $ovhServerName, $accountId);

                    $html = $obj->serviceInfoHtml($serverInfo, $_ADDONLANG, $hardwareInfo["result"], $processor, $disk, $dataCenter, $apiCall, $location, $serverType, $ovhServerName, $accountId, true);
                    echo $html;
                    exit;
                } elseif ($whmcs->get_req_var("serviceAction") == "getIpsInfo") {
                    $ips = $apiCall->get("/dedicated/server/{$ovhServerName}/ips", $accountId, $location, "Getting IPs", true);

                    if ($ips["httpcode"] != 200) {
                        $ipsErrors = $ips["result"]->message;
                    }

                    $allIpDetails = [];

                    foreach ($ips["result"] as $ip) {
                        $ipDetails = $apiCall->getIpDetails($location, $ovhServerName, $accountId, $ip);
                        if ($ipDetails["httpcode"] != 200) {
                            $allIpDetails[] = ["ip" => $ip, "error" => $ipDetails["result"]->message];
                        } else {
                            $allIpDetails[] =  $ipDetails["result"];
                        }
                    }

                    $html = $obj->ipsInfoHtml($allIpDetails, $ipsErrors,  $_ADDONLANG, true);
                    echo $html;
                    exit;
                } elseif ($whmcs->get_req_var("iPaction") == "viewIpDetails") {

                    $ip = $whmcs->get_req_var("ipblock");
                    $ipdetails = $apiCall->getIpDetails($location, $ovhServerName, $accountId, $ip);
                    $html = $obj->createIpDetailsHtml($ipdetails, $_ADDONLANG);
                    echo $html;
                    exit;
                } elseif ($whmcs->get_req_var("iPaction") == "cretaeFirewall") {
                    $ipblock = $whmcs->get_req_var("ip");
                    $data = ["ipOnFirewall" => explode("/", $ipblock)[0]];
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
                } elseif ($whmcs->get_req_var("iPaction") == "addDesc") {

                    $ipBlock = urlencode($whmcs->get_req_var("ipblock"));
                    $endPoint = "/ip/{$ipBlock}";
                    $data = ["description" => $whmcs->get_req_var("desc")];
                    $response = $apiCall->put($endPoint, $accountId, $location, $data, "adding IP desc", true);
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("iPaction") == "addReverseIp") {
                    $ipReverse = str_replace("::", "", explode("/", $whmcs->get_req_var("ipblock")));
                    $data = ["ipReverse" => $ipReverse["0"], "reverse" => $whmcs->get_req_var("reverseIp")];

                    $test = urlencode($whmcs->get_req_var("ipblock"));
                    $response = $apiCall->post("/ip/{$test}/reverse", $accountId, $location, $data, "adding reverse ip", true);
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("iPaction") == "mitigration") {

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
                } elseif ($whmcs->get_req_var("iPaction") == "deleteFirewall") {

                    $ipblock = $whmcs->get_req_var("ip");
                    $response = $apiCall->deleteFirewall($location, $accountId, $ipblock);
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
                } elseif ($whmcs->get_req_var("iPaction") == "deleteFirewallRule") {
                    $ipblock = urlencode($whmcs->get_req_var("ipblock"));
                    $ipReverse = str_replace("::", "", explode("/", $whmcs->get_req_var("ipblock")));
                    $endPoint = "/ip/{$ipblock}/firewall/{$ipReverse["0"]}/rule/{$whmcs->get_req_var("sequese")}";
                    $response = $apiCall->__delete($endPoint, $accountId, $location, [], "deleting firewall rules", true);
                    echo json_encode($response);
                    exit;
                }
            }

            $fieldsarray = array(
                ' ' => $obj->serviceInfoHtml([], $_ADDONLANG, $ovhCustomHostname, $processor, $disk, $dataCenter, $apiCall, $location, $serverType, $ovhServerName, $accountId, false),
                '' => $obj->ipsInfoHtml([], $ipsErrors,  $_ADDONLANG, false),
                '   ' => $obj->featureHtml($configuration->aclSettingsDedicated(), $serviceId),
            );

            return $fieldsarray;
        }
    } catch (Exception $e) {
        logModuleCall('soyoustart', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());
    }

    return array();
}

function soyoustart_AdminServicesTabFieldsSave(array $params)
{
    try {
        $serviceId = $params["serviceid"];
        $configuration = new Configuration();
        $helper = new Helper();
        $aclSettings = $configuration->aclSettingsDedicated();
        $postData = [];

        foreach ($aclSettings as $key => $value) {
            $find = str_replace(' ', '_', $value);
            (array_key_exists($find, $_POST) ? $postData[$find] = "on" : $postData[$find] = "");
        }

        if (!empty($postData)) {
            $response = $helper->insert_update("mod_acl_settings", ["key" => "servicePageAclSettings_$serviceId"], ["key" => "servicePageAclSettings_$serviceId", "value" => json_encode($postData)]);
        }
    } catch (Exception $e) {
        logModuleCall('soyoustart_vps', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());
    }
}

/**
 * Additional actions an admin user can invoke.
 *
 * Define additional actions that an admin user can perform for an
 * instance of a product/service.
 *
 * @see soyoustart_rebootServer()
 *
 * @return array
 */
function soyoustart_AdminCustomButtonArray()
{
    return array(
        "Reboot" => "rebootServer",

    );
}

/**
 * Custom function for performing an additional action.
 *
 * You can define an unlimited number of custom functions in this way.
 *
 * Similar to all other module call functions, they should either return
 * 'success' or an error message to be displayed.
 *
 * @param array $params common module parameters
 *
 * @see https://developers.whmcs.com/provisioning-modules/module-parameters/
 * @see soyoustart_AdminCustomButtonArray()
 *
 * @return string "success" or an error message
 */
function soyoustart_rebootServer(array $params)
{
    try {
        $apiCall = new ApiCall();
        $location = $params["customfields"]["ovh_server_location"];
        $accountId = explode("-", $params["configoption3"])[0];
        $ovhServerName = $params["customfields"]["ovh_server_name"];
        // $response = $apiCall->reboot($location, $accountId, $ovhServerName);
        $response = $apiCall->post("/dedicated/server/{$ovhServerName}/reboot", $accountId, $location, [], "reBooting server", true);

        if ($response["httpcode"] != 200) {
            return $response["result"]->message;
        }
    } catch (Exception $e) {
        logModuleCall('soyoustart', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());

        return $e->getMessage();
    }

    return 'success';
}


/**
 * Terminate instance of a product/service.
 *
 * Called when a termination is requested. This can be invoked automatically for
 * overdue products if enabled, or requested manually by an admin user.
 *
 * @param array $params common module parameters
 *
 * @see https://developers.whmcs.com/provisioning-modules/module-parameters/
 *
 * @return string "success" or an error message
 */
function soyoustart_TerminateAccount(array $params)
{
    try {
        $apiCall = new ApiCall();
        $location = $params["customfields"]["ovh_server_location"];
        $serverType = $params["moduletype"];
        $ovhServerName = $params["customfields"]["ovh_server_name"];
        $accountId = explode("-", $params["configoption3"])[0];
        $response = $apiCall->terminateServer($location, $serverType, $ovhServerName, $accountId);

        if ($response["httpcode"] != 200) {
            return $response["result"]->message;
        }
    } catch (Exception $e) {
        logModuleCall('soyoustart', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());

        return $e->getMessage();
    }

    return 'success';
}

/**
 * Client area output logic handling.
 *
 * This function is used to define module specific client area output. It should
 * return an array consisting of a template file and optional additional
 * template variables to make available to that template.
 *
 * The template file you return can be one of two types:
 *
 * * tabOverviewModuleOutputTemplate - The output of the template provided here
 *   will be displayed as part of the default product/service client area
 *   product overview page.
 *
 * * tabOverviewReplacementTemplate - Alternatively using this option allows you
 *   to entirely take control of the product/service overview page within the
 *   client area.
 *
 * Whichever option you choose, extra template variables are defined in the same
 * way. This demonstrates the use of the full replacement.
 *
 * Please Note: Using tabOverviewReplacementTemplate means you should display
 * the standard information such as pricing and billing details in your custom
 * template or they will not be visible to the end user.
 *
 * @param array $params common module parameters
 *
 * @see https://developers.whmcs.com/provisioning-modules/module-parameters/
 *
 * @return array
 */
function soyoustart_ClientArea(array $params)
{
    try {

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

        $assets = $CONFIG['SystemURL'] . "/modules/servers/soyoustart/assets";
        $apiCall = new ApiCall();
        $helper = new Helper;
        $result = Capsule::table("tbladdonmodules")->select('value')->where('setting', 'licenseNumtoactivate')->where('module', 'soyoustart')->first();
        $license = $helper->CheckLicense($result->value);

        if ($license["status"] == "Active") {
            $obj = new SoyoustartServer();
            $pid = $params['pid'];
            $location = $params["customfields"]["ovh_server_location"];
            $serviceId = $params["serviceid"];
            $serverType = $params["moduletype"];
            $ovhServerName = $params["customfields"]["ovh_server_name"];
            $ovhCustomHostname = $params["customfields"]["ovh_custom_hostname"];
            $ovhCustomFTPHostname = $params["customfields"]["ovh_ftp_custom_hostname"];
            $ovhReveserDNSCustomHostname = $params["customfields"]["ovh_reveser_dns_custom_hostname"];
            $accountId = explode("-", $params["configoption3"])[0];
            $configoption2 = explode('@', $params['configoption2']);
            $planCode = $configoption2["1"];
            $ovhSubsidiaryURL = explode("=", $params['configoption4']);
            $subsidiaryLocation = $ovhSubsidiaryURL[1];
            $billingCycle = $params['model']["billingcycle"];
            $billingData = $obj->formateBillingCycle($billingCycle);

            /* getting enable setting/feature from service page */
            $enableSettings = $helper->get_data("mod_acl_settings", ["key" => "servicePageAclSettings_$serviceId"], "first");
            $enableSettings = (isset($enableSettings->id) ? json_decode($enableSettings->value, true) : []);

            /* getting enable setting/feature form addon setting  */
            $enableSettingsAddon = Capsule::table('mod_soyoustart_product_settings')->where("product", "like", "$pid\_%")->first();
            $enableSettingsAddon = (isset($enableSettingsAddon->id) ? explode(",", $enableSettingsAddon->settings) : []);

            if ($whmcs->get_req_var("getServerDetails")) {
                if ($whmcs->get_req_var("getServerDetails") == "hardware") {
                    $hardwareInfo = $apiCall->getHardwareInfo($location, $serverType, $ovhServerName, $accountId);
                    $hardwareHtml = $obj->cretaeHardwareInfoHtml($hardwareInfo, $_ADDONLANG);
                    echo $hardwareHtml;
                    exit;
                } elseif ($whmcs->get_req_var("getServerDetails") == "service") {
                    $serverreInfo = $apiCall->getServerInfo($location, $serverType, $ovhServerName, $accountId);
                    $serverHtml = $obj->cretaeServerInfoHtml($serverreInfo, $_ADDONLANG);
                    echo $serverHtml;
                    exit;
                }
                exit;
            } elseif ($whmcs->get_req_var("intervention")) {

                $interventions = $apiCall->get("/dedicated/server/{$ovhServerName}/intervention", $accountId, $location, "Getting Interventions", true);

                if ($interventions["httpcode"] != 200) {
                    echo $interventions["result"]->message;
                    exit;
                }
                $interventionInfo = $apiCall->getInterventionInfo($location, $interventions["result"], $ovhServerName, $accountId);

                $interventionHtml = $obj->cretaeInterventionHtml($interventionInfo, $_ADDONLANG);
                echo $interventionHtml;
                exit;
            } elseif ($whmcs->get_req_var("manage_ips")) {
                if ($whmcs->get_req_var("getIpDetails")) {
                    $ip = $whmcs->get_req_var("ip");
                    $ipdetails = $apiCall->getIpDetails($location, $ovhServerName, $accountId, $ip);
                    if ($ipdetails["httpcode"] != 200) {
                        echo '<div class="alert alert-danger" role="alert">
                        ' . $ipdetails["result"]->message . '
                        </div>';
                        exit;
                    }
                    $ipDetailsHtml = $obj->createIPsHtml($ipdetails["result"], $_ADDONLANG);
                    echo $ipDetailsHtml;
                    exit;
                } else if ($whmcs->get_req_var("iPaction") == "addDesc") {
                    $ipBlock = urlencode($whmcs->get_req_var("ipblock"));
                    $endPoint = "/ip/{$ipBlock}";
                    $data = ["description" => $whmcs->get_req_var("desc")];
                    $response = $apiCall->put($endPoint, $accountId, $location, $data, "adding IP desc", true);
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
                } elseif ($whmcs->get_req_var("iPaction") == "updateIP6Reverse") {
                    $data = ["ipReverse" => urlencode($whmcs->get_req_var("ip")), "reverse" => $whmcs->get_req_var("reverseDNS")];
                    $ipblock = urlencode($whmcs->get_req_var("ipblock"));
                    $endPoint = "/ip/{$ipblock}/reverse";

                    $response = $apiCall->post($endPoint, $accountId, $location, $data, "adding reverse dns for IPv6", true);
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
                } elseif ($whmcs->get_req_var("iPaction") == "cretaeFirewall") {
                    $ipblock = $whmcs->get_req_var("ip");
                    $ipV4 = explode("/", $ipblock);
                    $data = ["ipOnFirewall" => $ipV4[0]];
                    $response = $apiCall->createFirewall($location, $accountId, $ipblock);

                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("iPaction") == "deleteFirewall") {
                    $ipblock = $whmcs->get_req_var("ip");
                    $response = $apiCall->deleteFirewall($location, $accountId, $ipblock);
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("iPaction") == "enableDisableFirewall") {

                    $actionType = $whmcs->get_req_var("actionType");
                    $data = ["enabled" => ($actionType == "enable" ? true : false)];
                    $ipBlock = $whmcs->get_req_var("ip");
                    $response = $apiCall->enableDisableFirewall($location, $accountId, $ipBlock, $data);
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
                        $userId = $params["userid"];
                        $orderId = $orderDetails["result"]->orderId;
                        $results = $obj->createAdditionalIpInvoice($userId, $quantity, $additionalIpPrice);
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

                    $ip = $whmcs->get_req_var("ipblock");
                    $ipdetails = $apiCall->getIpDetails($location, $ovhServerName, $accountId, $ip);

                    $html = $obj->createIpDetailsHtml($ipdetails, $_ADDONLANG);
                    echo $html;
                    exit;
                } else {
                    $ips = $apiCall->get("/dedicated/server/{$ovhServerName}/ips", $accountId, $location, "Getting IPs", true);
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

                exit;
            } elseif ($whmcs->get_req_var("ftp_backup")) {
                if ($whmcs->get_req_var("ftpAction") == "enableACL") {
                    $data = html_entity_decode($whmcs->get_req_var("data"));
                    parse_str($data, $dataArray);

                    $postData = ["cifs" => isset($dataArray["cifs"]) ? true : false, "ftp" => isset($dataArray["ftp"]) ? true : false, "ipBlock" => $dataArray["ipBlock"], "nfs" => isset($dataArray["nfs"]) ? true : false];
                    $response = $apiCall->post("/dedicated/server/{$ovhServerName}/features/backupFTP/access", $accountId, $location, $postData, "Creating FTPs", true);
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("ftpAction") == "getAuthorizableBlocks") {
                    $FTPblockips = $apiCall->get("/dedicated/server/{$ovhServerName}/features/backupFTP/access", $accountId, $location, "Getting FTPs Blocke IPs", true);
                    if ($FTPblockips["httpcode"] != 200) {
                        echo json_encode($FTPblockips);
                        exit;
                    }
                    $authorizableBlocks = $apiCall->get("/dedicated/server/{$ovhServerName}/features/backupFTP/authorizableBlocks", $accountId, $location, "Getting FTPs Authorizable Blocke IPs", true);

                    if ($authorizableBlocks["httpcode"] != 200) {
                        echo json_encode($authorizableBlocks);
                        exit;
                    }
                    $response = $obj->createACLBlockIPs($FTPblockips["result"], $authorizableBlocks["result"]);

                    echo json_encode($response);
                    exit;
                } else if ($whmcs->get_req_var("ftpAction") == "getIpBlockData") {
                    $ipBlock = urlencode($whmcs->get_req_var("ip"));

                    $response = $apiCall->get("/dedicated/server/{$ovhServerName}/features/backupFTP/access/{$ipBlock}", $accountId, $location, "Getting FTPs Blocke IP details", true);

                    if ($response["httpcode"] != 200) {
                        echo '<div class="alert alert-danger" role="alert">
                        ' . $response["result"]->message . '
                        </div>';
                        exit;
                    }
                    $ftpBlockIPDetail = $obj->createFtpBlockIPDetailHtml($response["result"], $_ADDONLANG);
                    echo ($ftpBlockIPDetail);
                    exit;
                } elseif ($whmcs->get_req_var("ftpAction") == "updateFTPBackup") {
                    $data = html_entity_decode($whmcs->get_req_var("data"));
                    $ipBlock = html_entity_decode($whmcs->get_req_var("ipBlock"));
                    $ipBlock = urlencode($ipBlock);
                    parse_str($data, $dataArray);
                    $postData = ["cifs" => isset($dataArray["cifs"]) ? true : false, "ftp" => isset($dataArray["ftp"]) ? true : false, "nfs" => isset($dataArray["nfs"]) ? true : false];

                    $response = $apiCall->put("/dedicated/server/{$ovhServerName}/features/backupFTP/access/{$ipBlock}", $accountId, $location, $postData, "Updating ACL FTP Backup", true);

                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("ftpAction") == "deleteFTPBackupIPBlock") {
                    $ipBlock = html_entity_decode($whmcs->get_req_var("ipBlock"));
                    $ipBlock = urlencode($ipBlock);
                    $response = $apiCall->__delete("/dedicated/server/{$ovhServerName}/features/backupFTP/access/{$ipBlock}", $accountId, $location, [], "Deletin ACL FTP Backup ipBlock", true);

                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("ftpAction") == "deleteFTPBackup") {
                    $response = $apiCall->__delete("/dedicated/server/{$ovhServerName}/features/backupFTP", $accountId, $location, [], "Deleting ACL FTP Backup", true);

                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("ftpAction") == "enableFTPBackup") {

                    $response = $apiCall->post("/dedicated/server/{$ovhServerName}/features/backupFTP", $accountId, $location, [], "Enabling FTP storage", true);

                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("ftpAction") == "changeFtppass") {
                    $response = $apiCall->post("/dedicated/server/{$ovhServerName}/features/backupFTP/password", $accountId, $location, [], "Changing FTP Password", true);

                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("ftpAction") == "FTPBackupStaus") {
                    $taskId = $whmcs->get_req_var("taskID");
                    $response = $apiCall->get("/dedicated/server/{$ovhServerName}/task/{$taskId}", $accountId, $location, "Getting task status", true);
                    echo json_encode($response);
                    exit;
                } else {
                    $ftps = $apiCall->get("/dedicated/server/{$ovhServerName}/features/backupFTP", $accountId, $location, "Getting FTP Backup details", true);
                    $FTPblockips = $apiCall->get("/dedicated/server/{$ovhServerName}/features/backupFTP/access", $accountId, $location, "Getting FTPs Blocke IPs", true);

                    $ftpBackupHtml = $obj->createFtpBackupHtml($ftps["result"], $FTPblockips["result"], $_ADDONLANG, $ovhServerName, $ovhCustomHostname, $ovhCustomFTPHostname, $location, $accountId, $apiCall);
                    echo $ftpBackupHtml;
                    exit;
                }
                exit;
            } elseif ($whmcs->get_req_var("monitoring")) {

                if ($whmcs->get_req_var("monitoringAction") == "EnableWithProactive") {
                    $data = ["monitoring" => true, "noIntervention" => true];
                } else if ($whmcs->get_req_var("monitoringAction") == "disable") {
                    $data = ["monitoring" => false];
                } elseif ($whmcs->get_req_var("monitoringAction") == "EnableWithoutProactive") {
                    $data = ["monitoring" => true, "noIntervention" => false];
                }
                $response = $apiCall->enableDisableMonitoring($location, $accountId, $ovhServerName, $data);
                echo json_encode($response);
                exit;
            } elseif ($whmcs->get_req_var("power")) {
                $type = $whmcs->get_req_var("type");
                $selectnetwork = '';

                if ($whmcs->get_req_var("boot") == "hardreboot") {
                    $response = $apiCall->post("/dedicated/server/{$ovhServerName}/reboot", $accountId, $location, [], "reBooting server", true);
                    if ($response["httpcode"] != 200) {
                        echo json_encode($response);
                        exit;
                    }
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("boot") == "hardrebootConf") {
                    $taskId = $whmcs->get_req_var("taskID");
                    $response = $apiCall->getTaskStatus($location, $accountId, $ovhServerName, $taskId);

                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("boot") == "netBoot") {

                    if ($whmcs->get_req_var("rootdevice") == "none") {
                        $data = ['bootId' => (int)$whmcs->get_req_var("bootid")];
                    } else {
                        $data = ['bootId' => (float)$whmcs->get_req_var("bootid"), 'rootDevice' => $whmcs->get_req_var("rootdevice")];
                    }

                    $response = $apiCall->put("/dedicated/server/{$ovhServerName}", $accountId, $location, $data, "netBooting server", true);

                    echo json_encode($response);
                    exit;
                }
                /* getting compatible os */ elseif ($type == "reInstall") {
                    $compatibleOs = $apiCall->get("/dedicated/server/{$ovhServerName}/install/compatibleTemplates", $accountId, $location, "Getting compatible OS", true);
                    $installationStatus = $apiCall->get("/dedicated/server/{$ovhServerName}/install/status", $accountId, $location, "Getting installation status", true);

                    if ($compatibleOs["httpcode"] != 200) {
                        $error = $compatibleOs["result"]->message;
                        $html = "<div class=\"alert alert-danger alert-dismissible fade show\" role=\"alert\"><strong>Error!</strong> $error <button type=\"button\" class=\"close\" data-dismiss=\"alert\" aria-label=\"Close\"><span aria-hidden=\"true\">&times;</span></button>
                    </div>";
                        echo json_encode(["type" => $type, "html" => $html]);
                        exit;
                    }
                    $html = '';
                    foreach ($compatibleOs["result"]->ovh  as $value) {
                        $html .= '<option value="' . $value . '">' . ucfirst(str_replace('-', " ", str_replace('_', " ", $value))) . '</option>';
                    }
                    echo json_encode(["type" => $type, "html" => $html, "installationStatus" => $installationStatus]);
                    exit;
                } elseif ($type == "getInstallationStatus") {

                    $installationStatus = $apiCall->get("/dedicated/server/{$ovhServerName}/install/status", $accountId, $location, "Getting installation status", true);
                    if ($installationStatus["httpcode"] != 200) {
                        unset($_SESSION["installationTaskId"]);
                    }
                    echo json_encode($installationStatus);
                    exit;
                }
                /* re-installing os */ elseif ($whmcs->get_req_var("boot") == "re-install os") {

                    $response = $apiCall->post("/dedicated/server/{$ovhServerName}/install/start", $accountId, $location, ["templateName" => $whmcs->get_req_var("templateName")], "reinstalling os", true);

                    if ($response["httpcode"] == 200) {
                        $_SESSION["installationTaskId"] = $response["result"]->taskId;
                    }
                    echo json_encode($response);
                    exit;
                }
                /* cancel re-installing os */ elseif ($whmcs->get_req_var("type") == "cancleReinstallation") {

                    $taskId = (!isset($_SESSION["installationTaskId"]) ? 12345 : $_SESSION["installationTaskId"]);
                    $response = $apiCall->post("/dedicated/server/{$ovhServerName}/task/{$taskId}/cancel", $accountId, $location, [], "Cancel Re-intallation", true);
                    echo json_encode($response);
                    exit;
                }

                if ($type == "network" || $type == "rescue") {
                    $bootType = $type;
                    $netBootIds = $apiCall->get("/dedicated/server/{$ovhServerName}/boot?bootType={$bootType}", $accountId, $location, "Getting Boot IDs", true);

                    if ($netBootIds["httpcode"] != 200) {
                        echo json_encode(["type" => $type, "html" => $netBootIds["result"]->message]);
                        die();
                    }
                    $selectnetwork = '<option value="">Choose</option>';
                    foreach ($netBootIds["result"] as $netBootId) {
                        $netBootDetails = $apiCall->get("/dedicated/server/{$ovhServerName}/boot/{$netBootId}", $accountId, $location, "Getting Boot details", true);

                        $netBootDetails = $netBootDetails["result"];
                        $selectnetwork .= '<option value="' . $netBootDetails->bootId . '">' . ucfirst($netBootDetails->kernel) . ' ' . $netBootDetails->description . '</option>';
                    }

                    echo json_encode(["type" => $type, "html" => $selectnetwork]);
                    exit;
                }
                $PowerHtml = $obj->createPowerHtml($_ADDONLANG, $type, $ovhCustomHostname, $selectnetwork);

                echo json_encode(["type" => $type, "html" => $PowerHtml]);
                exit;
            } elseif ($whmcs->get_req_var("impi")) {

                if ($whmcs->get_req_var("impiAction") == "testImpi") {
                    $data = html_entity_decode($whmcs->get_req_var("data"));
                    parse_str($data, $postData);
                    $postData = ["ttl" => $postData["ttl"], "type" => $postData["impiType"]];
                    $response = $apiCall->post("/dedicated/server/{$ovhServerName}/features/ipmi/test", $accountId, $location, $postData, "Testing IMPI", true);
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("impiAction") == "rebootImpi") {
                    $response = $apiCall->post("/dedicated/server/{$ovhServerName}/features/ipmi/resetInterface", $accountId, $location, [], "Rebooting IMPI", true);
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("impiAction") == "openImpi") {
                    $type = $whmcs->get_req_var("type");
                    $ip = $whmcs->get_req_var("ip");
                    if ($type == "browserImpi") {
                        $type = "kvmipHtml5URL";
                    } elseif ($type == "htmlImpi") {
                        $type = "serialOverLanURL";
                    } else {
                        $type = "kvmipJnlp";
                    }
                    $postData = ["ipToAllow" => $ip, "ttl" => '5', "type" => $type];
                    $response = $apiCall->openImpi($location, $accountId, $ovhServerName, $postData);

                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("impiAction") == "impiTaskStaus") {
                    $taskId = $whmcs->get_req_var("taskID");
                    $response = $apiCall->getTaskStatus($location, $accountId, $ovhServerName, $taskId);

                    if (isset($response["result"]) && $response["result"]->status == "done") {
                        $type = $whmcs->get_req_var("type");
                        if ($type == "browserImpi") {
                            $type = "kvmipHtml5URL";
                        } elseif ($type == "htmlImpi") {
                            $type = "serialOverLanURL";
                        } else {
                            $type = "kvmipJnlp";
                        }
                        $response = $apiCall->openImpi($location, $accountId, $ovhServerName, [], $type);

                        echo json_encode($response);
                        exit;
                    }
                    echo json_encode($response);
                    exit;
                }
                exit;
            } else {

                if ($ovhServerName == "") {
                    $errors[] = "Your server has not been assigned yet, contact support!";
                } else {
                    $serverInfo = $apiCall->getServerInfo($location, $serverType, $ovhServerName, $accountId);

                    $errors = [];
                    if ($serverInfo["httpcode"] != 200) {
                        $errors[] = $serverInfo["result"]->message;
                    }
                    $hardwareInfo = $apiCall->getHardwareInfo($location, $serverType, $ovhServerName, $accountId);

                    $result = $helper->get_data("tblproducts", ["id" => $params["pid"]], "first")->description;

                    $processor = $obj->seachData($result, "Processor </b>");
                    $memory = $obj->seachData($result, "Memory</b>");
                    $disk = $obj->seachData($result, "Disk</b>");

                    if ($hardwareInfo["httpcode"] != 200) {
                        $errors[] = $hardwareInfo["result"]->message;
                    }
                }
            }

            return array(
                'templatefile' => "clientareanew",
                'templateVariables' => array(
                    'LANG' => $_ADDONLANG,
                    'assets' => $assets,
                    'errors' => $errors,
                    'aditionalIpPrice' => $helper->get_data("mod_soyoustart_pricesetting", ["servertype" => $params["configoption1"]], "first"),
                    'serverInfo' => $serverInfo["result"],
                    'hardwareInfo' => $hardwareInfo["result"],
                    "dataCenters" => dataCenter(),
                    'params' => $params,
                    'processor' => $processor,
                    'memory' => $memory,
                    'disk' => $disk,
                    'clientCurrency' => getCurrency($params["userid"]),
                    'ovhCustomHostname' => empty($ovhCustomHostname) ? $serverInfo["result"]->name : $ovhCustomHostname,
                    'ovhReveserDNSCustomHostname' => empty($ovhReveserDNSCustomHostname) ? $serverInfo["result"]->reverse : $ovhReveserDNSCustomHostname,
                    'aclSettingsDedicated' => $enableSettings,
                    'enableSettingsAddon' => $enableSettingsAddon,
                    'clientareatemplate' => $params["clientareatemplate"],
                ),
            );
        } else {
            return array(
                'templatefile' => "clientareanew",
                'templateVariables' => array(
                    'LANG' => $_ADDONLANG,
                    'assets' => $assets,
                    'errors' => [$license["status"] . " License"],
                ),
            );
        }
    } catch (Exception $e) {
        logModuleCall('soyoustart', __FUNCTION__, $params, $e->getMessage(), $e->getTraceAsString());
    }
}

function dataCenter()
{

    return [
        "bhs" => "Canada(Beauharnois - BHS)",
        "gra2" => "France(Gravelines - GRA2)",
        "gra" => "France(Gravelines - GRA)",
        "sbg" => "France (Strasbourg - SBG)",
        "waw" => "Poland (Varsovie - WAW)",
        "sgp" => "Asia-Pacific > Singapour (SG)",
        "syd" => "Sydney",
        "de1" => "Northern Europe - Frankfurt",
        "waw1" => "Warsaw (Poland)",
        "uk1" => "Western Europe - London",
        "usw" => "US West",
        "use" => "US East",
        "can" => "Canada",
        "ca" => "North America, Canada, (CA)",
        "ger" => "Germany",
        "sin" => "Singapore",
        "aus" => "Australia",
        "au" => "Australia",
        "uk" => "United Kingdom",
        "lon" => "United Kingdom (London - LON)",
        "rbx" => "France(Roubaix - RBX)",
        "fra" => "Germany(Frankfurt - FRA)",
        "de" => "Europe, Germany, Frankfurt (DE)",
        "vin" => "United States (Vint Hill - VIN)",
        "hil" => "United States (Hillsboro - HIL)",
        "us-east-va" => "North America, VA, USA, Vint Hill (US-EAST-VA)",
        "us-west-or" => "North America, OR, USA, Hillsboro (US-WEST-OR)",
        "ynm" => "Asia Pacific (India - Mumbai)",
        "mum" => "India (Mumbai - YNM)",
        "pl" => "Central Europe, Poland, (PL)",
        "sg" => "Asia-Pacific > Singapour (SG)",
        "fr" => "France",
        "ca-east-tor-a" => "Canada (Toronto - YYZ)",
        "yyz" => "Canada (Toronto - YYZ)"
    ];
}
