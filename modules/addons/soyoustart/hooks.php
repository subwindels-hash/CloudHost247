<?php

require_once __DIR__ . '/classes/ApiCall.php';

use WHMCS\DataBase\Capsule;
use \WHMCS\Module\Addon\Soyoustart\Helper;
use \WGSModule\Soyoustart\classes\ApiCall;


if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

add_hook('InvoicePaid', 1, function ($vars) {
    try {
        $apiCall = new ApiCall();
        $helper = new Helper();
        $invoiceid = $vars['invoiceid'];
        $additionipDatas = $apiCall->get_data("mod_soyoustart_ips_orders", ["invoiceid" => $invoiceid], "first");
        $response = UpdateConfigOption($additionipDatas);
    } catch (Exception $e) {
        logActivity('soyoustart vps Hook-error' . $e->getMessage());
    }
});

add_hook('ShoppingCartValidateProductUpdate', 1, function ($vars) {

    $helper = new Helper();
    $apiCall = new ApiCall();
    $aclSettings = $helper->get_data("mod_acl_settings", ["key" => "generalaclSettings"], "first")->value;
    $aclSettings = !empty($aclSettings) ? json_decode($aclSettings, true) : [];
    if (isset($aclSettings["showErrorOnCart"]) && $aclSettings["showErrorOnCart"] == "on") {
        $cartProduct = end($_SESSION["cart"]["products"]);
        $pid = $cartProduct["pid"];
        $productDetails = $helper->get_data("tblproducts", ["id" => $pid], "first");
        $subsidiaryHost = "https://" . parse_url($productDetails->configoption4, PHP_URL_HOST) . "/";
        if ($productDetails->servertype == "soyoustart_vps" || $productDetails->servertype == "soyoustart") {
            $ovhAccountData = explode('-', $productDetails->configoption3);
            if (count($ovhAccountData) == 4)
                unset($ovhAccountData[1]);
            $ovhAccountData = array_values($ovhAccountData);
            $location = $ovhAccountData["1"];
            $subsidiaryLocation = trim(explode("=", $productDetails->configoption4)[1]);
            $configoption2 = explode('@', $productDetails->configoption2);
            $planCode = trim($configoption2[1]);
            $productGroup = trim($configoption2[0]);

            $server = explode("-", $planCode)["0"];
            /* checking product */
            $response = $apiCall->get(trim($productDetails->configoption4), $ovhAccountData[0], $location, "Geting Info for eco server", true, true);

            if ($response["httpcode"] != 200) {
                logActivity("Error: shopping vard validation({$response["httpcode"]->message})");
                return ["There is some error, please contact to the support!"];
            }

            $productFound = false;
            foreach ($response["result"]->plans as $plan) {
                if ($plan->planCode === $planCode) {
                    $productFound = true;
                    break;
                }
            }

            if (!$productFound) {
                return ["This product is temporarily out of stock!"];
            }

            /* checking datacenter */

            $formatedData = [];
            foreach ($vars["configoption"] as $configoption => $selectedConfigoption) {
                $configOptionsDelails = $helper->get_data("tblproductconfigoptions", ["id" => $configoption], "first");
                $selectedConfigoptionDelails = $helper->get_data("tblproductconfigoptionssub", ["id" => $selectedConfigoption], "first");
                $formatedData[$configOptionsDelails->optionname] = $selectedConfigoptionDelails;
            }
            $serverLocation = explode("|", $formatedData["server_location|Server Location"]->optionname)[0];
            $memory = formatMemoryString($formatedData["memory|Memory"]->optionname);
            $storage = removeAfterLastHyphen($formatedData["storage|Storage"]->optionname);
            $subOptionName = $serverLocation;
            if ($productDetails->servertype == "soyoustart_vps") {
                $response = $apiCall->get("{$subsidiaryHost}engine/api/v1/vps/order/rule/datacenter?ovhSubsidiary={$subsidiaryLocation}&planCode={$planCode}", $ovhAccountData[0], $location, "Geting datacenter Info for vps server", true, true);
              if ($response["httpcode"] != 200) {
                    logActivity("Error: shopping vard validation({$response["httpcode"]->message})");
                    return ["There is some error, please contact to the support!"];
                }
                $datacenterFound = false;
                foreach ($response["result"]->datacenters as $status) {
                    $subOptionName = strtoupper($subOptionName);
                    if ($status->datacenter == $subOptionName) {
                        $datacenterFound = true;
                        if ($status->status == "unavailable" || $status->status == "out-of-stock") {
                            return ["{$subOptionName} server location is temporarily out of stock, please select another datacenter!"];
                        }
                    }
                }
                if (!$datacenterFound) {
                    return ["{$subOptionName} server location is not available, please select another datacenter!"];
                }

            } else {
                $response = $apiCall->get("{$subsidiaryHost}engine/apiv6/dedicated/server/datacenter/availabilities/?datacenters={$subOptionName}&excludeDatacenters=false&planCode={$planCode}", $ovhAccountData[0], $location, "Geting datacenter Info for dedicated server", true, true);
                if ($response["httpcode"] != 200) {
                    logActivity("Error: shopping vard validation({$response["httpcode"]->message})");
                    return ["There is some error, please contact to the support!"];
                }
                
                $datacenterFound = false;
                foreach($response["result"] as $value){
                    if($value->memory == $memory && str_contains($storage, $value->storage) && $planCode == $value->planCode){
                        $datacenterFound = true;
                        if ($value->datacenters["0"]->availability == "unavailable") {
                            return ["The combination of datacenter, memory, and storage is not available, please try with another combination!"];
                        }
                    }
                }
                if (!$datacenterFound) {
                    return ["The combination of datacenter, memory, and storage is not available, please try with another combination!"];
                }
            }
        }
    }
});


add_hook('ClientAreaPage', 1, function ($vars) {

    if ($vars["templatefile"] == "configureproduct") {
        $helper = new Helper();
        $addonDetails = $helper->get_data("tbladdonmodules", ["module" => "soyoustart", "setting" => "licenseNumtoactivate"], "first");
        $licenceError = '';
        $orderFormPurchase = false;
        if (empty($addonDetails)) {
            $licenceError .= "Please configure the addon module(soyoustart) with license!";
        } else {
            $licenseData = $helper->CheckLicense($addonDetails->value);
            $addonData = $helper->getProductAddonStatus($licenseData['addons']);
            if (isset($licenseData["addons"])) {
                if (array_key_exists("OVH Order Form", $addonData)) {
                    $orderFormPurchase = true;
                }
            }
        }

        $enableSettings = $helper->get_data("mod_acl_settings", ["key" => "orderformACLSettings"], "first");
        $enableSettingsResult = isset($enableSettings->id) ? json_decode($enableSettings->value, true) : [];
        $hideSidebarOnCart = isset($enableSettingsResult["hideSidebarOnCart"]) ? $enableSettingsResult["hideSidebarOnCart"] : '';
        $hideOs = $helper->get_data("mod_soyoustart_setting", ["settings" => "hideOS"], "first");

        $hideOs = isset($hideOs->value) ? json_decode($hideOs->value, true) : [];
        $randomClass = generateRandomString();
        $_SESSION["randomClass"] = $randomClass;
        return (["hideSidebarOnCart" => $hideSidebarOnCart, "licenceError" => $licenceError, "licenseData" => $licenseData, "orderFormPurchase" => $orderFormPurchase, "addonData" => $addonData, "randomClass" => $randomClass, "hideOs" => $hideOs]);
    }
});

add_hook('ClientAreaHeaderOutput', 1, function ($vars) {


    if ($vars["templatefile"] == "configureproduct" && isset($vars["carttpl"]) && $vars["carttpl"] == "ovh_cart") {
        $randomClass = $_SESSION["randomClass"];
        /*getting  os family configurable options id */
        $osFamilyOptionId = "inputConfigOption";
        $osVersionOptionId = "inputConfigOption";
        $controlPanelOptionId = "inputConfigOption";
        foreach ($vars["configurableoptions"] as $key => $value) {
            if ($value["optionname"] == "OS Family") {
                $osFamilyOptionId .= $value["id"];
            } elseif ($value["optionname"] == "OS Version") {
                $osVersionOptionId .= $value["id"];
            } elseif ($value["optionname"] == "Control Panel") {
                $controlPanelOptionId .= $value["id"];
            }
        }

        $script = '
            <script>
                $(document).ready(function(){
                    
                    if(!$("#main-body").find("#order-standard_cart").length){
                        $("#main-body").html(`<div class="alert alert-danger" role="alert">There is some problem, Please contact to the support!</div>`)
                    }
                    if(!$("#order-standard_cart").hasClass("'.$randomClass.'")){
                        $("#order-standard_cart").html(`<div class="alert alert-danger" role="alert">There is some problem, Please contact to the support!</div>`)
                    }

                    let osFamilyOptionId = "#' . $osFamilyOptionId . '";
                    let osVersionOptionId = "#' . $osVersionOptionId . '";
                    $(document).on("change","#' . $osFamilyOptionId . '", function(){
                    let selectedValue = $.trim($("#' . $osFamilyOptionId . ' option:selected").text());
                    if(selectedValue){
                            showHideOS(selectedValue);
                        }
                    })

                    jQuery(window).on("load", function(){
                        let selectedValue = $.trim($("#' . $osFamilyOptionId . ' option:selected").text());
                    if(selectedValue){
                            showHideOS(selectedValue);
                        }
                    }); 
                })
                function showHideOS(selectedValue){
                    let selectedW = false;
                    let selectedN= false;
                    let selectedO = false;
                    $("#' . $osVersionOptionId . ' option").prop("selected", false);
                    $("#' . $controlPanelOptionId . ' option").prop("selected", false);
                    $("#' . $osVersionOptionId . ' option").each(function(index ) {
                        let options= $.trim($(this).text());
                        if(selectedValue == "Windows"){
                            let currentSrc = $("#osImage").attr("src");
                            if(currentSrc !=undefined){
                                let lastSlashIndex = currentSrc.lastIndexOf("/");
                                let newSrc = currentSrc.substring(0, lastSlashIndex + 1) + "os-icon1.png";
                                $("#osImage").attr("src", newSrc);
                            }
                            if(options.includes("Windows") ){
                                $(this).attr("hidden", false);
                                if(!selectedW){
                                    $(this).prop("selected", true);
                                    $(this).change();
                                    selectedW =true;
                                }
                            } else{
                                $(this).attr("hidden", true);
                            }
                        }
                        else if (selectedValue == "None") {
                        let currentSrc = $("#osImage").attr("src");
                        if(currentSrc !=undefined){
                            let lastSlashIndex = currentSrc.lastIndexOf("/");
                            let newSrc = currentSrc.substring(0, lastSlashIndex + 1) + "os-none.png";
                            $("#osImage").attr("src", newSrc);
                        }
                            if(options.includes("None") ){
                                $(this).attr("hidden", false);
                                if(!selectedN){
                                    $(this).prop("selected", true);
                                    $(this).change();
                                    selectedN =true;
                                }
                            } else{
                                $(this).attr("hidden", true);
                            }
                        }
                    else if(selectedValue != "Windows" && selectedValue != "None") {
                        let currentSrc = $("#osImage").attr("src");
                        if(currentSrc != undefined){
                            let lastSlashIndex = currentSrc.lastIndexOf("/");
                            let newSrc = currentSrc.substring(0, lastSlashIndex + 1) + "os-icon2.png";
                            $("#osImage").attr("src", newSrc);
                        }
                            if(options.includes("Windows") || options.includes("None")  ){
                                $(this).attr("hidden", true);
                            } else{
                                $(this).attr("hidden", false);
                                if(!selectedO){
                                    $(this).prop("selected", true);
                                    $(this).change();
                                    selectedO =true;
                                }
                            }
                        }
                    });
                    selectedW =false;
                    $("#' . $controlPanelOptionId . ' option").each(function(index ) {
                        let options= $.trim($(this).text());
                        if(selectedValue == "None"){
                            if(options == "None"){
                                $(this).prop("selected", true).change();
                                selectedW =true;
                            }
                        }
                        if(selectedValue == "Windows"){
                            if(options.includes("Plesk") || options.includes("None")){
                                $(this).attr("hidden", false);
                                if(selectedW){
                                    $(this).prop("selected", true).change();
                                    selectedW =true;
                                }
                            }
                            else{
                                $(this).attr("hidden", true); 
                            }
                        }else{
                            $(this).attr("hidden", false);
                            if(selectedW && options =="None"){
                                $(this).prop("selected", true).change();
                                selectedW =true;
                            }
                        }
                    });
                }
            </script>
        ';
        return $script;
    }
});

add_hook('AdminAreaHeadOutput', 1, function ($vars) {
    global $whmcs;

    $moduleAction = $whmcs->get_req_var("action");

    if ($vars["filename"] == "addonmodules" &&  $moduleAction == "existingserver") {

        $script = '
        <script>
            $(document).ready(function(){

                $("#product-list").on("change", function(){

                    $(document).ajaxComplete(function(event,xhr,options){
                        let data = options.data;
                        data = data.split(\'&\');
                        data = data[0].split(\'=\');
                        let action = data[0];
                        if (action == "getProductConfOption") {

                            let os_version = $.trim($(\'select[name="OS Family"] option:selected\').text());
                            let selectedW = false;
                            let selectedN= false;
                            let selectedO = false;
                            if(os_version == "None" || os_version == "none"){
                                $(\'select[name="OS Version"]\').find(\'option\').each(function() {
                                    let options= $.trim($(this).text());
                                    if(options.includes("None") ){
                                        $(this).attr("hidden", false);
                                        if(!selectedN){
                                            $(this).prop("selected", true);
                                            $(this).change();
                                            selectedN =true;
                                        }
                                    } else{
                                        $(this).attr("hidden", true);
                                    }
                                })
                                $(\'select[name="Control Panel"]\').find(\'option\').each(function() {
                                    let options= $.trim($(this).text());
                                    if(options.includes("None") ){
                                        $(this).attr("hidden", false);
                                        if(!selectedN){
                                            $(this).prop("selected", true);
                                            $(this).change();
                                            selectedN =true;
                                        }
                                    } else{
                                        $(this).attr("hidden", true);
                                    }
                                })

                            } 
                                
                        $("#OS_Family").on("change", function(){
                            let os_version = $.trim($(\'#OS_Family option:selected\').text());

                            if(os_version == "Windows" || os_version == "windows"){
                                $(\'select[name="OS Version"]\').find(\'option\').each(function() {
                                    let options= $.trim($(this).text());
                                    if(options.includes("Windows")|| options.includes("None") ){
                                        $(this).attr("hidden", false);
                                        if(!selectedN){
                                            $(this).prop("selected", true);
                                            $(this).change();
                                            selectedN =true;
                                        }
                                    } else{
                                        $(this).attr("hidden", true);
                                    }
                                })
                                $(\'select[name="Control Panel"]\').find(\'option\').each(function() {
                                    let options= $.trim($(this).text());
                                    if(options.includes("Plesk") || options.includes("None")){
                                        $(this).attr("hidden", false);
                                        if(!selectedN){
                                            $(this).prop("selected", true);
                                            $(this).change();
                                            selectedN =true;
                                        }
                                    } else{
                                        $(this).attr("hidden", true);
                                    }
                                })

                            } 
                            else  if(os_version == "None" || os_version == "none"){
                                $(\'select[name="OS Version"]\').find(\'option\').each(function() {
                                    let options= $.trim($(this).text());
                                    if(options.includes("None") ){
                                        $(this).attr("hidden", false);
                                        if(!selectedN){
                                            $(this).prop("selected", true);
                                            $(this).change();
                                            selectedN =true;
                                        }
                                    } else{
                                        $(this).attr("hidden", true);
                                    }
                                })
                                $(\'select[name="Control Panel"]\').find(\'option\').each(function() {
                                    let options= $.trim($(this).text());
                                    if(options.includes("None") ){
                                        $(this).attr("hidden", false);
                                        if(!selectedN){
                                            $(this).prop("selected", true);
                                            $(this).change();
                                            selectedN =true;
                                        }
                                    } else{
                                        $(this).attr("hidden", true);
                                    }
                                })

                            } 
                            else{
                                $(\'select[name="OS Version"]\').find(\'option\').each(function() {
                                    let options= $.trim($(this).text());
                                    if(options.includes("Windows") ){
                                        $(this).attr("hidden", true);
                                        if(!selectedN){
                                            $(this).prop("selected", true);
                                            $(this).change();
                                            selectedN =true;
                                        }
                                    } else{
                                        $(this).attr("hidden", false);
                                    }
                                })
                                $(\'select[name="Control Panel"]\').find(\'option\').each(function() {
                                    $(this).attr("hidden", false);
                                })
                            }
                        })
                        }
                    });
                })

               
            })
        </script>';
        return $script;
    }
});


function generateRandomString($length = 15)
{
    $characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    $charactersLength = strlen($characters);
    $randomString = '';
    for ($i = 0; $i < $length; $i++) {
        $randomString .= $characters[rand(0, $charactersLength - 1)];
    }
    return $randomString;
}

function UpdateConfigOption($additionipDatas)
{
    $helper = new Helper();
    $serviceId = $additionipDatas->service_id;
    if ($additionipDatas) {
        $hostingdata = $helper->get_data("tblhosting", ["id" => $serviceId], "first");
        $productId = $hostingdata->id;
        $configLinkData = $helper->get_data("tblproductconfiglinks", ["pid" => $productId], "first");
        if ($configLinkData) {
            $gid = $configLinkData->gid;
            $configOptionData = Capsule::table('tblproductconfigoptions')->where("optionname", 'Snapshot')->where('gid', $gid)->first();
            $configOptionID = $configOptionData->id;
            $configSubOptionData = Capsule::table('tblproductconfigoptionssub')->where("configid", $configOptionID)->first();
            $optionId = $configSubOptionData->id;
            $updateSnapshot = Capsule::table('tblhostingconfigoptions')
                ->where("relid", $serviceId)
                ->where('configid', $configOptionID)
                ->where('optionid', $optionId)
                ->update(['qty' => 1]);

            if ($updateSnapshot != "1") {
                logActivity("Error: snapshot update : $configSubOptionData ");
            }
        }
    }
}

function formatMemoryString($input)
{
    preg_match('/(\d+)GB/', $input, $matches);
    $ramSize = $matches[1] . 'g';
    $ecc = strpos($input, 'ECC') !== false ? 'ecc' : '';
    preg_match('/(\d+)MHz/', $input, $matches);
    $speed = $matches[1];
    $formattedString = 'ram-' . $ramSize . '-' . $ecc . '-' . $speed;
    return $formattedString;
}

function removeAfterLastHyphen($input)
{
    $lastHyphenPos = strrpos($input, '-');
    if ($lastHyphenPos !== false) {
        return substr($input, 0, $lastHyphenPos);
    }
    return $input;
}