<?php

namespace WGSModule\Soyoustart\classes;

require_once __DIR__ . DS . '/ApiCall.php';

use WGSModule\Soyoustart\classes\ApiCall;
use WHMCS\Module\Addon\Soyoustart\Helper;
use WHMCS\Database\Capsule;

if (!defined("WHMCS")) {
    exit("This file cannot be accessed directly");
}

class ConsumerSetting extends ApiCall
{
    public $apiCall, $redirectUrl, $helper;
    function __construct()
    {
        $this->apiCall = new ApiCall();
        $this->helper = new Helper();
        global $CONFIG;
        $systemURL = $CONFIG['SystemURL'];

        $this->redirectUrl = "{$systemURL}/{$GLOBALS["configuredAdminDir"]}/addonmodules.php?module=soyoustart&action=consumerSetting";
        // $this->redirectUrl = $systemURL . '/modules/addons/soyoustart/oauth2callback.php';
    }


    /*  */
    private function generateApiAccess()
    {
        try {
            $json = array(
                'accessRules' =>
                array(
                    0 =>
                    array(
                        'method' => 'GET',
                        'path' => '/*',
                    ),
                    1 =>
                    array(
                        'method' => 'POST',
                        'path' => '/*',
                    ),
                    2 =>
                    array(
                        'method' => 'PUT',
                        'path' => '/*',
                    ),
                    3 =>
                    array(
                        'method' => 'DELETE',
                        'path' => '/*',
                    ),
                ),
                'redirection' => '{redirect__url}',
            );
            $json = json_encode($json);
            $json = str_replace("{redirect__url}", $this->redirectUrl, $json);

            return $json;
        } catch (\Exception $e) {
            throw new \Exception('Error while generateApiAccess: ' . $e->getMessage());
        }
    }

    public function authApiUrl($location)
    {
        try {
            switch ($location) {
                case "europe":
                    $url = "https://eu.api.ovh.com/1.0/auth/credential";
                    break;
                case "canada":
                    $url = "https://ca.api.ovh.com/1.0/auth/credential";
                    break;
                case "us":
                    $url = "https://api.us.ovhcloud.com/1.0/auth/credential";
                    break;
                case "uk":
                    $url = "https://api.ovh.com/1.0/auth/credential";
                    break;
                case "singapore":
                    $url = "https://api.ovh.com/1.0/auth/credential";
                    break;
                case "world":
                    $url = "https://api.ovh.com/1.0/auth/credential";
                    break;
            }

            return $url;
        } catch (\Exception $e) {
            throw new \Exception('Error while creating authApiUrl: ' . $e->getMessage());
        }
    }

    /* 
    * @param string $apiUrl 
    * @param string $applicationKey 

    @return array header.

    */

    public function getConsumerKey($apiUrl, $applicationKey)
    {
        try {
            $data = self::generateApiAccess($this->redirectUrl);
            $action = "Generate Consumer Key";
            $header = [
                'Content-Type: application/json',
                'X-Ovh-Application:' . $applicationKey
            ];
            $response = $this->apiCall->__curlCall("POST", $data, $apiUrl, $header, $action);
            return $response;
        } catch (\Exception $e) {
            throw new \Exception('Error while generating getConsumerKey: ' . $e->getMessage());
        }
    }


    public function checkStatus($authData)
    {
        try {
            $data = null;
            $location = (filter_var($authData->location, FILTER_VALIDATE_URL) ? $authData->service_location  : $authData->location);
            $apiUrl =  str_replace("credential", "currentCredential", $this->authApiUrl($location));
            // $apiUrl = "https://api.us.ovhcloud.com/1.0/auth/currentCredential";
            $action = "check status";
            $signature = self::generateSignature(trim($authData->secret_key), trim($authData->consumer_key), "GET", $apiUrl);
            $header = self::createHeader(trim($authData->application_key), trim($authData->consumer_key), $signature);
            $response = $this->apiCall->__curlCall("GET", [], $apiUrl, $header, $action);
            if ($response["httpcode"] == 200) {

                $timestamp = strtotime($response["result"]->expiration);
                $date = new \DateTime();
                $date->setTimestamp($timestamp);
                $date->setTimezone(new \DateTimeZone(date_default_timezone_get()));
                $response["result"]->local_formate = $date->format('Y-m-d H:i:s');
            }
            $response["result"]->url = $apiUrl;

            //             echo"<pre>";
            // print_r($response);
            return $response;
        } catch (\Exception $e) {
            throw new \Exception('Error while checking status: ' . $e->getMessage());
        }
    }

    /* 
        * @param string $applicationKey 
        * @param string $consumerKey 
        * @param string $signature 

        @return array header.

    */
    private function createHeader($applicationKey, $consumerKey, $signature)
    {
        try {
            $time = time() + 0;
            return [
                'Accept:application/json',
                'content-type:application/json',
                'X-Ovh-Application:' . $applicationKey,
                'X-Ovh-Consumer:' . $consumerKey,
                'X-Ovh-Timestamp:' . $time,
                'X-Ovh-Signature:' . $signature,
            ];
        } catch (\Exception $e) {
            throw new \Exception('Error while generating header: ' . $e->getMessage());
        }
    }
    /* 
        * @param string $secretKey 
        * @param string $consumerKey 
        * @param string $method 
        * @param array $data, if method is not get,

        @return string in sha1 formate.

    */
    private function generateSignature($secretKey, $consumerKey, $method, $url, $data = null)
    {
        try {
            $time = time() + 0;
            $toSign = $secretKey . '+' . $consumerKey . '+' . $method . '+' . $url . '+' . $data . '+' . $time;

            $signature = '$1$' . sha1($toSign);

            return $signature;
        } catch (\Exception $e) {
            throw new \Exception('Error while generating signature: ' . $e->getMessage());
        }
    }


    public function createPriceSettingHtml($lang = [], $moduleLink = null)
    {
        $priceSettings =  $this->helper->getData("mod_soyoustart_pricesetting", null);
        $html = '';
        if (!isset($priceSettings[0])) {
            $html .= '<td colspan="9" class="text-center">' . $lang["no_record_found"] . '</td>';
            return $html;
        }

        foreach ($priceSettings as $key => $priceSetting) {
            $html .= ' <tr>
                <td class="text-center">' . $priceSetting->server . '</td>
                <td class="text-center">' . $priceSetting->servertype . '</td>
                <td class="text-center">' . $priceSetting->productprice . '</td>
                <td class="text-center">' . $priceSetting->additionalIPprice . '</td>
                <td class="text-center">' . $priceSetting->setupprice . '</td>
                <td class="text-center">' . $priceSetting->paymentmethod . '</td>
                <td class="text-center" width="25">
                    <a href="javascript:void(0)" class="editPrice" data-id="' . $priceSetting->id . '"><img src="images/edit.gif" width="16" height="16" border="0" alt="Edit" ></a>
                </td>
                <td width="25" class="text-center">
                    <a href="javascript:void(0)" class="deletePrice" data-id="' . $priceSetting->id . '"><img src="images/delete.gif" width="16" height="16" border="0" alt="Delete" ></a>
                </td>
            </tr>';
        }

        return $html;
    }

    public function createImapNotificationSettingHtml($lang = [], $imapAclSettings = null)
    {
        $enableSettings = $this->helper->get_data("mod_acl_settings", ["key" => "imap_aclSettings"]);
        $enableSettingsResult = [];
        foreach ($enableSettings as $key => $value) {
            $enableSettingsResult[$value->key] = !empty($value) ? json_decode($value->value, true) : [];
        }

        $html = '';
        $html .= '
        <div class="row">';
        foreach ($imapAclSettings as $key => $imapAclSetting) {
            $html .= '
                <div class="col-md-4">
                <div class="form-group imapNotificationForm">';
            $name = str_replace(' ', '', $imapAclSetting);
            if (isset($enableSettingsResult["imap_aclSettings"]) && array_key_exists($name, $enableSettingsResult["imap_aclSettings"])) {
                $html .= '<input type="checkbox" name="' . $name . '" id="' . $name . '" checked> <label class="form-check-label" for="' . $name . '">' . $imapAclSetting . '</label>
                </div>
            </div>';
            } else {
                $html .= '<input type="checkbox" name="' . $name . '" id="' . $name . '"><label class="form-check-label" for="' . $name . '">' . $imapAclSetting . '</label>
                    </div>
                </div>';
            }
        }
        $html .= '</div>
            <div class="imapACLSettingsFooter">
                <button type="button" class="btn btn-primary updateImapAclSettings" style="margin-top: 5px;"> '.$lang["imap_save_btn"].'</button>
            </div>';
        return $html;
    }

    public function createGeneralACLSettingsHtml($lang = [], $domainName = null)
    {

        $enableSettings = $this->helper->get_data("mod_acl_settings", ["key" => "generalaclSettings"]);
        $enableSettingsResult = [];
        foreach ($enableSettings as $key => $value) {
            $enableSettingsResult[$value->key] = !empty($value) ? json_decode($value->value, true) : [];
        }
        $html = '
        <div class="form-group row">
            <label  class="col-sm-2 col-form-label">'.$lang["validate_product_cart"].'</label>
            <div class="col-sm-10">
                <input type="checkbox" name="showErrorOnCart" id="showError"';
        ($enableSettingsResult["generalaclSettings"]["showErrorOnCart"] == "on" ? $html .= "checked" : "");
        $html .= '><label for="showError" class="labelcustom"> '.$lang["validate_product_cart_desc"].'</label>
            </div>
        </div>
        <div class="form-group row">
            <label class="col-sm-2 col-form-label">'.$lang["service_termination"].'</label>
            <div class="col-sm-10">
                <input type="checkbox" name="serverTemination" id="serverTemination"';
        ($enableSettingsResult["generalaclSettings"]["serverTemination"] == "on" ? $html .= "checked" : "");
        $html .= '><label for="serverTemination" class="labelcustom">'.$lang["service_termination_desc"].'</label>
            </div>
        </div>

        <div class="form-group row">
            <label class="col-sm-2 col-form-label">'.$lang["module_logging"].'</label>
            <div class="col-sm-10">
                <input type="checkbox" name="moduleLogstatus" id="moduleLogstatus"';
        ($enableSettingsResult["generalaclSettings"]["moduleLogstatus"] == "on" ? $html .= "checked" : "");
        $html .= '><label for="moduleLogstatus" class="labelcustom"> ' . $lang['enable_disbale_log'] . '.</label>
            </div>
        </div>
        <div class="form-group row">
            <label for="deleteLogafter" class="col-sm-2 col-form-label">'.$lang["delete_log_after"].'</label>
            <div class="col-sm-4" style="display: flex; align-items: center;">
                <input type="text" class="form-control" id="deleteLogafter" placeholder="Enter days here.." name="deleteLogafter" 
                value="';
        (isset($enableSettingsResult["generalaclSettings"]["deleteLogafter"]) ? $html .= $enableSettingsResult["generalaclSettings"]["deleteLogafter"] : $html .= "7");
        $html .= '" required> <span style=" margin-left: 10px;"> Days </span>
            </div>
        </div>

        <div class="form-group row">
            <label for="defaultCustomHostName" class="col-sm-2 col-form-label">'.$lang["default_custom_hostname"].'</label>
            <div class="col-sm-4">
                <input type="text" class="form-control" id="defaultCustomHostName" placeholder="Default Custom Hostname" name="defaultCustomHostName" 
                value="';
        (isset($enableSettingsResult["generalaclSettings"]["defaultCustomHostName"]) ? $html .= $enableSettingsResult["generalaclSettings"]["defaultCustomHostName"] : $html .= "WHMCS_ServiceID_$domainName");
        $html .= '" required>
                <small><b>WHMCS_serviceid_your domain name</b></small>
            </div>
        </div>
        <div class="generalACLSettingsFooter">
            <button type="button" class="btn btn-primary updateGeneralAclSettings" style="margin-top: 5px;"> '.$lang["general_setting_btn"].'</button>
        </div>';
        return $html;
    }
    public function createOrderformACLSettingstml($lang = [], $licenseDetails = [])
    {

        $enableSettings = $this->helper->get_data("mod_acl_settings", ["key" => "orderformACLSettings"]);
        $orderFormTemplate = $this->helper->getOvhProductGroups();

        $enableSettingsResult = [];
        foreach ($enableSettings as $key => $value) {
            $enableSettingsResult[$value->key] = !empty($value) ? json_decode($value->value, true) : [];
        }
        $html = '
        <div class="form-group row">
            <label class="col-sm-2 col-form-label">'.$lang["hide_cart_sidebar"].' </label>
            <div class="col-sm-10">
                <input type="checkbox" name="hideSidebarOnCart" id="hideSidebar"';
        ($enableSettingsResult["orderformACLSettings"]["hideSidebarOnCart"] == "on" ? $html .= "checked" : "");
        $html .= '><label for="hideSidebar" class="labelcustom" > '.$lang["hide_cart_sidebar_note"].'</label>
            </div>
        </div>';

        if (isset($licenseDetails["addons"])) {

            $addonDetails = $this->helper->getProductAddonStatus($licenseDetails["addons"]);

            if (array_key_exists("OVH Order Form", $addonDetails)) {
                $html .= '<div class="form-group row">
                    <label class="col-sm-2 col-form-label">'.$lang["order_form_cart_service_status"].'</label>
                    <div class="col-sm-10">
                        <span class="badge badge-success">'.$lang["order_form_addon_purchased"].'</span>
                    </div>
                </div>
                <div class="form-group row">
                    <label class="col-sm-2 col-form-label">'.$lang["order_form_cart_license_status"].'</label>
                    <div class="col-sm-10">';
                    ($addonDetails["OVH Order Form"]["status"])  == "Active" ? $html .='<span class="badge badge-success">' . ($addonDetails["OVH Order Form"]["status"]) . '</span>' : $html .= '<span class="badge badge-danger">' . ($addonDetails["OVH Order Form"]["status"]) . '</span>';
                    $html .= '</div>
                </div>';

                $html .= '<div class="form-group row">
                    <label class="col-sm-2 col-form-label">'.$lang["order_form_status"].'</label>
                    <div class="col-sm-10">';
                    

                (isset($orderFormTemplate[array_key_first($orderFormTemplate)]) && $orderFormTemplate[array_key_first($orderFormTemplate)]->orderfrmtpl != '' ? $html .= '<span style="margin-right: 10px;"><i class="fas fa-check" style="color: #28a745;"></i></span><button type="button" class="btn btn-info activateDeactiveTheme" data-action="deactive">Deactivate</button>' : 
                $html .= '<span style="margin-right: 10px;"><i class="fas fa-times" style="color: #d44950;"></i></i></span><button type="button" class="btn btn-primary activateDeactiveTheme" data-action="active">Activate</button>');
                $html .= '</div>
                </div>';
            } else {
                $html .= '<div class="form-group row">
                    <label class="col-sm-2 col-form-label">'.$lang["order_form_status"].'</label>
                    <div class="col-sm-10">
                        <span class="badge badge-danger">'.$lang["order_form_addon_not_purchased"] .' </span>
                       <a href="https://members.whmcsglobalservices.com/cart.php?gid=addons" class="btn btn-primary" target="_blank"> '.$lang["buy_now"].'</a>
                    </div>
                </div>';
            }
        } else {

            $html .= '<div class="form-group row">
                <label class="col-sm-2 col-form-label">Cart License: </label>
                <div class="col-sm-10">';
            (isset($licenseDetails["cartAddon"])) ? $html .= '<span class="badge badge-success">Activated</span>' : $html .= ' <a href="https://members.whmcsglobalservices.com/cart.php?gid=addons" class="btn btn-primary" target="_blank"> '.$lang["buy_now"].'</a>
                </div>
            </div>';
        }

        $html .= ' <div class="generalACLSettingsFooter">
    <button type="button" class="btn btn-primary updateOrderformACLSettings" style="margin-top: 5px;"> Save Settings </button>
    </div>';


        return $html;
    }

    public function createAclSettingsHtml($lang = [], $products = null, $Configuration = null, $moduleLink = '')
    {
        $html = '';
        foreach ($products as $id => $value) {

            if ($value->servertype == "soyoustart") {
                $productSettings = $Configuration->aclSettingsDedicated();
                $serverType = "Dedicated";
            } else {
                $productSettings = $Configuration->aclSettingsVps();
                $serverType = "VPS";
            }
            $html .= '
            <tr>
                <td class="text-center">' . $value->name . ' (' . $serverType . ')</td>
                <td>
                    <select name="productSettings[' . $value->id . '_' . $value->name . '][]" class="form-control select2" multiple="multiple">';
            foreach ($productSettings as $key => $productSetting) {
                if (isset($value->settings)) {
                    $html .= '<option value="' . $key . '"';
                    (in_array($key, $value->settings) ? $html .= "selected" : "");
                    $html .= '>' . $productSetting . '</option>';
                } else
                    $html .= '<option value="' . $key . '">' . $productSetting . '</option>';
            }
            $html .= '</select>
                </td>   
            </tr>
            ';
        }
        return $html;
    }


    public function updateProductAclSettings($data)
    {

        if (empty($data['productSettings'])) {
            return Capsule::table("mod_soyoustart_product_settings")->update(["settings" => ""]);
        } else {
            $products = $data['productSettings'];
            foreach ($products as $key => $value) {
                $productsetting = implode(',', $value);
                $postData = ["product" => trim($key), "settings" => $productsetting];
                $response = $this->helper->insert_update("mod_soyoustart_product_settings", ["product" => trim($key)], $postData);
                if (str_contains("error", $response)) {
                    return $response;
                }
            }
            Capsule::table("mod_soyoustart_product_settings")->whereNotIn("product", array_keys($data["productSettings"]))->update(["settings" => ""]);
        }
    }


    public function checkServicecreatedWithCredential($authId)
    {
        $response = Capsule::table("tblproducts")
            ->join("tblhosting", "tblproducts.id", "=", "tblhosting.packageid")
            ->whereIn("tblproducts.servertype", ["soyoustart", "soyoustart_vps"])
            ->where("tblproducts.configoption3", "like", "{$authId}-%")
            ->where("tblhosting.domainstatus", "Active")
            ->select('tblhosting.id as serviceId')
            ->get()->toArray();
        return $response;
    }
    public function checkProductImportedWithCredential($authId)
    {
        $response = Capsule::table("tblproducts")
            ->whereIn("servertype", ["soyoustart", "soyoustart_vps"])
            ->where("configoption3", "like", "{$authId}-%")
            ->select('id as poductId')
            ->get()->toArray();
        return $response;
    }
}
