<?php
namespace WHMCS\Module\Addon\Soyoustart\Admin;
use WHMCS\Module\Addon\Soyoustart\Helper;
use WHMCS\Database\Capsule;
use Smarty;
use WGSModule\Soyoustart\classes\ConsumerSetting;
use WGSModule\Soyoustart\classes\Configuration;
use WGSModule\Soyoustart\classes\ProductSetting;
use WGSModule\Soyoustart\classes\EmailTemplates;
use WGSModule\Soyoustart\classes\ExistingServer;
use WGSModule\Soyoustart\classes\ServerStatus;
use WGSModule\Soyoustart\classes\ApiCall;
use WGSModule\Soyoustart\classes\OrderManage;
use WGSModule\Soyoustart\classes\CustomDatabase;
use WGSModule\Soyoustart\classes\Upgrade;
if (!defined("WHMCS")) {
    exit("This file cannot be accessed directly");
}
if (file_exists(__DIR__ . '/php-ovh/src/Api.php')) {
    require_once __DIR__ . '/php-ovh/src/Api.php';
}
if (file_exists(__DIR__ . DS . 'classes/ApiCall.php')) {
    require_once __DIR__ . DS . 'classes/ApiCall.php';
}
if (file_exists(__DIR__ . DS . '/../../classes/Configuration.php')) {
    require_once __DIR__ . DS . '/../../classes/Configuration.php';
}
class Controller
{
    public $tplFileName;
    public $tplDIR;
    public $smarty;
    public $tplVar = array();
    public function __construct($params)
    {
        global $CONFIG;
        global $whmcs;
        $this->params = $params;
        $this->tplVar['rootURL'] = $CONFIG["SystemURL"];
        $this->tplVar['urlPath'] = $CONFIG["SystemURL"] . "/modules/addons/{$params['module']}/";
        $this->tplVar['_lang'] = $params["_lang"];
        $this->tplVar['moduleLink'] = $params['modulelink'];
        $this->tplVar['module'] = $params['module'];
        $this->tplVar['license'] = $params['license'];
        $this->tplVar['version'] = $params['version'];
        $this->tplVar['action'] = $whmcs->get_req_var("action");
        $this->tplVar['license_key'] = $params['licenseNumtoactivate'];
        $this->tplVar['tplDIR'] = ROOTDIR . "/modules/addons/{$params['module']}/templates/admin/";
        $this->tplVar['header'] = ROOTDIR . "/modules/addons/{$params['module']}/templates/admin/header.tpl";
        $this->tplVar['footer'] = ROOTDIR . "/modules/addons/{$params['module']}/templates/admin/footer.tpl";
    }
    public function fileNotFound()
    {
        $this->tplFileName = __FUNCTION__;
        $this->output();
    }
    public function dasboard()
    {
        global $whmcs;
        if (isset($_SESSION["adminid"])) {
            if (file_exists(__DIR__ . DS . '/../../classes/CustomDatabase.php')) {
                require_once __DIR__ . DS . '/../../classes/CustomDatabase.php';
            }
            if (file_exists(__DIR__ . DS . '/../../classes/upgrade.php')) {
                require_once __DIR__ . DS . '/../../classes/upgrade.php';
            }
            if ($whmcs->get_req_var("ajaxAction") == "upgradeDB") {
                $obj = new CustomDatabase();
                $helper = new Helper();
                $upgrade = new Upgrade();
                // /* updating credentials */
                $credentials = $helper->get_data("mod_soyoustart");
                $helper->updateCredentials($credentials);
                // /* updating custom fields */
                $upgrade->updateCustomFields();
                $response = $obj->upgradeDB();
                echo "success";
                exit;
            }
            if ($whmcs->get_req_var("ajaxAction") == "refreshLicense") {
                $helper = new Helper();
                $licenseKey = $whmcs->get_req_var("licenseKey");
                $response = $helper->CheckLicense($licenseKey, 0);
                echo json_encode($response);
                exit;
            }
        }
        $this->tplFileName = __FUNCTION__;
        $this->output();
    }
    public function consumersetting()
    {
        global $whmcs;
        global $CONFIG;
        require_once __DIR__ . DS . '/../../classes/ConsumerSetting.php';
        $consumerSetting = new ConsumerSetting();
        $helper = new Helper();
        $Configuration = new Configuration();
        if (isset($_SESSION["adminid"])) {
            /* editing, generating and regenerating of API keys */
            if ($whmcs->get_req_var("submit") || $whmcs->get_req_var("reGenerateKey")) {
                if ($whmcs->get_req_var("auth_id") && $whmcs->get_req_var("reGenerateKey")) {
                    $authData = $helper->get_data("mod_soyoustart", ["id" => $whmcs->get_req_var("auth_id")], "first");
                }
                $applicationKey = ($whmcs->get_req_var('application') ? trim($whmcs->get_req_var('application')) : trim($authData->application_key));
                $location = ($whmcs->get_req_var('location') ? trim($whmcs->get_req_var('location')) : trim($authData->location));
                $accountNumber = ($whmcs->get_req_var("account_number") ? trim($whmcs->get_req_var("account_number")) : trim($authData->account_number));
                $secretKey = ($whmcs->get_req_var("secret") ? trim($whmcs->get_req_var("secret")) : trim($authData->secret_key));
                $apiUrl = $consumerSetting->authApiUrl($location);
                $consumerKeyData = $consumerSetting->getConsumerKey($apiUrl, $applicationKey);
                /* insrting required data in custom table mod_soyoustart*/
                if ($consumerKeyData["httpcode"] == "200" && !empty($consumerKeyData["result"])) {
                    $data = ["account_number" => trim($accountNumber), "location" => trim($location), "status" => "1", "application_key" => trim($applicationKey), "consumer_key" => trim($consumerKeyData["result"]->consumerKey), "secret_key" => trim($secretKey)];
                    $added = $helper->insert_update("mod_soyoustart", ["account_number" => $accountNumber, "location" => $location], $data);
                    $_SESSION["ovh_auth1"] = "validated";
                    $this->tplVar["message"] = "API Key setting added successfully!";
                    if ($whmcs->get_req_var("auth_id") && $whmcs->get_req_var("reGenerateKey")) {
                        $response = ["status" => "success", "message" => $consumerKeyData["result"]->validationUrl];
                        echo json_encode($response);
                        exit;
                    }
                    header("Location:" . $consumerKeyData["result"]->validationUrl);
                    exit;
                } else {
                    if ($whmcs->get_req_var("auth_id") && $whmcs->get_req_var("reGenerateKey")) {
                        $response = ["status" => "error", "message" => $consumerKeyData["result"]->message];
                        echo json_encode($response);
                        exit;
                    }
                    $this->tplVar["warning"] = $consumerKeyData["result"]->message;
                }
            }
            /* checking status of credentials */ elseif ($whmcs->get_req_var("getStatus")) {
                $authId = $whmcs->get_req_var("auth_id");
                $authData = $helper->get_data("mod_soyoustart", ["id" => $authId], "first");
                if (filter_var($authData->service_location, FILTER_VALIDATE_URL)) {
                    $helper->insert_update("mod_soyoustart", ["id" => $authId], ["location" => $authData->service_location]);
                    $authData = $helper->get_data("mod_soyoustart", ["id" => $authId], "first");
                }
                $status = $consumerSetting->checkStatus($authData);
                if ($status["httpcode"] == 200) {
                    $response = ["status" => "success", "auth_id" => $authId, "message" => "", "expiry_date" => $status["result"]->expiration == '' ? "Lifetime" : $status["result"]->local_formate];
                    $helper->insert_update("mod_soyoustart", ["id" => $authId], ["status" => "1"]);
                } else {
                    $response = ["status" => "error", "message" => $status["result"]->message, "account_user" => $authData->account_number, "auth_id" => $authId, "expiry_date" => null];
                    $helper->insert_update("mod_soyoustart", ["id" => $authId], ["status" => "0"]);
                }
                echo json_encode($response);
                exit;
            } elseif ($whmcs->get_req_var("viewCredentials")) {
                $credentials = $helper->get_data("mod_soyoustart", ["id" => $whmcs->get_req_var("auth_id")], "first");
                echo json_encode($credentials);
                exit;
            }
            /*  deleting consumer key data  */ elseif ($whmcs->get_req_var("tab") == "deleteCredential") {
                /* checking any product created with this credentials or any active service */
                if (!empty($response)) {
                    echo json_encode(["status" => "exist", "message" => "You can not delete this credential. There are some active services with this account."]);
                    die;
                }
                if (empty($response)) {
                    $response = $consumerSetting->checkProductImportedWithCredential($whmcs->get_req_var("authId"));
                    echo json_encode([
                        "status" => "exist",
                        "message" => "You can not delete this credential. There are some active services with this account.",
                        "authId" => $whmcs->get_req_var("authId")
                    ]);
                    die;
                } else {
                    $helper->deleteData("mod_soyoustart", $whmcs->get_req_var("authId"));
                    echo json_encode(["status" => "not exist", "message" => "Credentials has been deleted successfully!."]);
                }
                die;
            } elseif ($whmcs->get_req_var("tab") == "mergeAndDeleteCredential") {
                $merge_account = $whmcs->get_req_var("merge_account");
                $delete_account = $whmcs->get_req_var("authId");
                $merge_account_data = $helper->get_data("mod_soyoustart", ["id" => $merge_account], "first");
                $delete_account_data = $helper->get_data("mod_soyoustart", ["id" => $delete_account], "first");
                if (!$merge_account_data) {
                    echo json_encode(["status" => "error", "message" => "Selected account to merge not found."]);
                    die;
                }
                if ($delete_account_data->location != $merge_account_data->location) {
                    echo json_encode(["status" => "error", "message" => "Selected account to merge is not valid. Please select account with same location."]);
                    die;
                }
                $update_data = "{$merge_account_data->id}-{$merge_account_data->location}-{$merge_account_data->account_number}";
                $response = Capsule::table("tblproducts")
                    ->whereIn("servertype", ["soyoustart", "soyoustart_vps"])
                    ->where("configoption3", "like", "{$delete_account}-%")
                    ->update(['configoption3' => html_entity_decode($update_data)]);
                if ($response > 0) {
                    $helper->deleteData("mod_soyoustart", $delete_account);
                    echo json_encode(["status" => "success", "message" => "Credentials has been merged and deleted successfully!."]);
                } else {
                    echo json_encode(["status" => "error", "message" => "No service found to merge with selected account."]);
                }
                die;
            }
            /* editing consumer key data */ elseif ($whmcs->get_req_var("tab") == "edit" && !empty($whmcs->get_req_var("id"))) {
                $this->tplVar["edit_data"] = $helper->get_data("mod_soyoustart", ["id" => $whmcs->get_req_var("id")], "first");
            } elseif (($whmcs->get_req_var("tab") == "editPrice") && $whmcs->get_req_var("id")) {
                $response = $helper->getData("mod_soyoustart_pricesetting", $_GET["id"]);
                $this->tplVar['priceEditSettings'] = $response;
            }
            if (isset($_SESSION["ovh_auth1"]) &&  $_SESSION["ovh_auth1"] == "validated") {
                $this->tplVar["message"] = "API Key setting added successfully!";
                unset($_SESSION["ovh_auth1"]);
            }
            if ($whmcs->get_req_var("tabAction")) {
                if ($whmcs->get_req_var("tabAction") == "priceSettings") {
                    $html = $consumerSetting->createPriceSettingHtml($this->tplVar['_lang'], $this->tplVar['moduleLink']);
                    echo $html;
                    exit;
                } elseif ($whmcs->get_req_var("tabAction") == "editPrice") {
                    $response = $helper->getData("mod_soyoustart_pricesetting", $whmcs->get_req_var("id"));
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("tabAction") == "updatePrice") {
                    $data = html_entity_decode($whmcs->get_req_var("data"));
                    parse_str($data, $dataArray);
                    $id = $dataArray["priceId"];
                    unset($dataArray["token"]);
                    unset($dataArray["sameMargin"]);
                    unset($dataArray["priceId"]);
                    $dataArray["server"] = "OVH";
                    $response = $helper->updatePricesSetting("mod_soyoustart_pricesetting", $id, $dataArray);
                    echo json_encode($response);
                    exit;
                } elseif ($whmcs->get_req_var("tabAction") == "deletePrice") {
                    $response = $helper->deleteData("mod_soyoustart_pricesetting", $whmcs->get_req_var("id"));
                    echo $response;
                    exit;
                } elseif ($whmcs->get_req_var("tabAction") == "addPriceMargin") {
                    $data = html_entity_decode($whmcs->get_req_var("data"));
                    parse_str($data, $dataArray);
                    unset($dataArray["token"]);
                    unset($dataArray["priceId"]);
                    $dataArray["server"] = "OVH";
                    if (isset($dataArray["sameMargin"]) && $dataArray["sameMargin"] == "on") {
                        unset($dataArray["sameMargin"]);
                        $serverType = ["Dedicated", "VPS", "PublicCloud"];
                        foreach ($serverType as $key => $value) {
                            $dataArray["servertype"] = $value;
                            $response = $helper->insertData("mod_soyoustart_pricesetting", $dataArray);
                            if ($response != "1") {
                                echo $response;
                                exit;
                            }
                        }
                    } else {
                        $response = $helper->insertData("mod_soyoustart_pricesetting", $dataArray);
                    }
                    echo $response;
                    exit;
                } elseif ($whmcs->get_req_var("tabAction") == "imapNotificationSettings") {
                    $html = $consumerSetting->createImapNotificationSettingHtml($this->tplVar['_lang'],  $Configuration->imapAclSetting());
                    echo $html;
                    exit;
                } elseif ($whmcs->get_req_var("tabAction") == "updateImapAclSettings") {
                    $data = html_entity_decode($whmcs->get_req_var("data"));
                    parse_str($data, $dataArray);
                    unset($dataArray["token"]);
                    $response = $helper->insert_update("mod_acl_settings", ["key" => "imap_aclSettings"], ["key" => "imap_aclSettings", "value" => json_encode($dataArray)]);
                    echo $response;
                    exit;
                } elseif ($whmcs->get_req_var("tabAction") == "generalACLSettings") {
                    $domainName = explode("//", $CONFIG["Domain"])[1];
                    $html = $consumerSetting->createGeneralACLSettingsHtml($this->tplVar['_lang'], $domainName);
                    echo $html;
                    exit;
                } elseif ($whmcs->get_req_var("tabAction") == "updateGeneralAclSettings") {
                    $data = html_entity_decode($whmcs->get_req_var("data"));
                    parse_str($data, $dataArray);
                    unset($dataArray["token"]);
                    $response = $helper->insert_update("mod_acl_settings", ["key" => "generalaclSettings"], ["key" => "generalaclSettings", "value" => json_encode($dataArray)]);
                    echo $response;
                    exit;
                } elseif ($whmcs->get_req_var("tabAction") == "orderformACLSettings") {
                    $html = $consumerSetting->createOrderformACLSettingstml($this->tplVar['_lang'], $this->tplVar['license']);
                    echo $html;
                    exit;
                } elseif ($whmcs->get_req_var("tabAction") == "activateDeactiveTheme") {
                    if (!is_dir(__DIR__ . "/../../../../../templates/orderforms/ovh_cart")) {
                        echo "Order form file is not uploaded properly, Please upload it to whmcs_dir/templates/orderform.";
                        exit;
                    }
                    $allOvhProductGroup = $helper->getOvhProductGroups();
                    if (empty($allOvhProductGroup)) {
                        echo "There is no prduct/group found related to OVH";
                        exit;
                    }
                    if ($whmcs->get_req_var("themeAction") == "deactive") {
                        foreach ($allOvhProductGroup as $productGroup) {
                            $response = $helper->insert_update("tblproductgroups", ["id" => $productGroup->id], ["orderfrmtpl" => ""]);
                        }
                        echo "Order form has been deactivated successfully!";
                        exit;
                    } else {
                        foreach ($allOvhProductGroup as $productGroup) {
                            $response = $helper->insert_update("tblproductgroups", ["id" => $productGroup->id], ["orderfrmtpl" => "ovh_cart"]);
                        }
                        echo "Order form has been activated successfully!";
                        exit;
                    }
                    // $html = $consumerSetting->createOrderformACLSettingstml($this->tplVar['_lang'], $this->tplVar['license']);
                    // echo $html;
                    exit;
                } elseif ($whmcs->get_req_var("tabAction") == "updateOrderformACLSettings") {
                    $data = html_entity_decode($whmcs->get_req_var("data"));
                    parse_str($data, $dataArray);
                    unset($dataArray["token"]);
                    $response = $helper->insert_update("mod_acl_settings", ["key" => "orderformACLSettings"], ["key" => "orderformACLSettings", "value" => json_encode($dataArray)]);
                    echo $response;
                    exit;
                } elseif ($whmcs->get_req_var("tabAction") == "aclSettings") {
                    $html = $consumerSetting->createAclSettingsHtml($this->tplVar['_lang'], $helper->productSettings(), $Configuration, $this->tplVar['moduleLink']);
                    echo $html;
                    exit;
                } elseif ($whmcs->get_req_var("tabAction") == "UpdateAclSettings") {
                    $data = html_entity_decode($whmcs->get_req_var("data"));
                    parse_str($data, $dataArray);
                    unset($dataArray["token"]);
                    $response = $consumerSetting->updateProductAclSettings($dataArray);
                    echo $response;
                    exit;
                }
            }
        }
        $this->tplVar['consumerKeyData'] = $helper->get_data("mod_soyoustart");
        $this->tplFileName = __FUNCTION__;
        $this->output();
    }
    public function pricesetting()
    {
        if (isset($_SESSION["adminid"])) {
            global $whmcs;
            $helper = new Helper();
            if ($whmcs->get_req_var("tab") == "deletePrice" && $whmcs->get_req_var("id")) {
                $helper->deleteData("mod_soyoustart_pricesetting", $whmcs->get_req_var("id"));
                $this->tplVar["message"] = "Price setting deleted successfully!";
            }
            if ($whmcs->get_req_var("priceSettingData")) {
                unset($_POST["token"]);
                unset($_POST["priceSettingData"]);
                $data = $_POST;
                $data["server"] = "OVH";
                $response = $helper->insertData("mod_soyoustart_pricesetting", $data);
                if (is_string($response)) {
                    $this->tplVar["warning"] = $response;
                } else {
                    $this->tplVar["message"] = "Price setting added successfully!";
                }
            } elseif ($whmcs->get_req_var("editedPriceSettingData")) {
                unset($_POST["token"]);
                unset($_POST["editedPriceSettingData"]);
                $data = $_POST;
                $data["server"] = "OVH";
                $response = $helper->updatePricesSetting("mod_soyoustart_pricesetting", $whmcs->get_req_var("id"), $data);
                ($response["exist"]) ? $this->tplVar["warning"] = $response["message"] : $this->tplVar["message"] = $response["message"];
            }
            if (($whmcs->get_req_var("tab") == "editPrice") && $whmcs->get_req_var("id")) {
                $response = $helper->getData("mod_soyoustart_pricesetting", $_GET["id"]);
                $this->tplVar['priceEditSettings'] = $response;
            }
            $result = $helper->getData("mod_soyoustart_pricesetting", null);
            $this->tplVar['priceSettings'] = $result;
        }
        $this->tplFileName = __FUNCTION__;
        $this->output();
    }
    public function imapsetting()
    {
        if (isset($_SESSION["adminid"])) {
            global $whmcs;
            global $GLOBALS;
            global $CONFIG;
            $Configuration = new Configuration();
            /*  // delete operation */
            $helper = new Helper();
            if ($whmcs->get_req_var("tab") && $whmcs->get_req_var("tab") == "delete") {
                $response =  $helper->deleteData("mod_soyoustart_imap", $whmcs->get_req_var("id"));
                if ($response) {
                    $this->tplVar["message"] = "Deleted successfully!";
                } else {
                    $this->tplVar["warning"] = $response;
                }
            } elseif ($whmcs->get_req_var("aclSettings")) {
                $data = $_POST;
                unset($data["aclSettings"]);
                unset($data["token"]);
                $response = $helper->insert_update("mod_acl_settings", ["key" => "imap_aclSettings"], ["key" => "imap_aclSettings", "value" => json_encode($data)]);
                $this->tplVar["message"] = $response;
            }
            // get all gmail clients
            $gmailImapDatas = Capsule::table('mod_soyoustart_imap')->where("gmail_secretkey", "!=", "")->get();
            $gmailImapDatas = $gmailImapDatas->toArray();
            $customadminpath = $GLOBALS["customadminpath"] != "" ? $GLOBALS["customadminpath"] : "admin";
            $redirecturl = $CONFIG["SystemURL"] . '/' . $customadminpath . '/addonmodules.php?module=soyoustart&action=imapsetting';
            if (!empty($gmailImapDatas) && $whmcs->get_req_var("account")) {
                $scope = urlencode("https://www.googleapis.com/auth/gmail.readonly https://mail.google.com");
                $url = "https://accounts.google.com/o/oauth2/v2/auth"
                    . "?scope={$scope}"
                    . "&redirect_uri=" . urlencode($redirecturl)
                    . "&response_type=code"
                    . "&client_id=" . $gmailImapDatas[0]->gmail_clientId
                    . "&access_type=offline"
                    . "&prompt=consent";
                if (headers_sent()) {
                    die('Headers already sent.');
                }
                header("Location: $url");
                exit;
                // require_once __DIR__ . '/gmail_conf.php';
            }
            // google auth verification
            if ($whmcs->get_req_var("code")) {
                $url = 'https://oauth2.googleapis.com/token';
                $data = [
                    "code" => $whmcs->get_req_var("code"),
                    "client_id" => trim($gmailImapDatas[0]->gmail_clientId),
                    "client_secret" => trim($gmailImapDatas[0]->gmail_secretkey),
                    "redirect_uri" => trim($redirecturl),
                    "grant_type" => "authorization_code"
                ];
                $response = $helper->getAccessToken($url, $data);
                if ($response["httpcode"] != 200) {
                    $this->tplVar["warning"] = $response["result"]->error . " : " . $response["result"]->error_description;
                } else {
                    $gmailImapDatas = Capsule::table('mod_soyoustart_imap')->where(["gmail_secretkey" => $gmailImapDatas[0]->gmail_secretkey, "gmail_clientId"  => $gmailImapDatas[0]->gmail_clientId])->first();
                    $token = $response["result"];
                    if (!empty($gmailImapDatas)) {
                        $checkaccount = Capsule::table('mod_soyoustart_imap')->where(['account_user' => $gmailImapDatas->account_user, "gmailaddr" => $gmailImapDatas->gmailaddr])->get();
                        if (empty($checkaccount)) {
                            Capsule::table('mod_soyoustart_imap')->insert(['accesstoken' => $token->access_token, 'refereshtoken' => $token->refresh_token, 'created_at' => date("d/m/Y h:i:s A T", $token->created), 'account_user' => $gmailImapDatas->account_user, "status" => 1]);
                        } else {
                            $fetch = (array) $checkaccount[0];
                            $data = ['account_user' => $gmailImapDatas->account_user, "gmailaddr" => $gmailImapDatas->account_user, 'accesstoken' => $token->access_token, 'refereshtoken' => $token->refresh_token, 'created_at' => date("d/m/Y h:i:s A T", $token->created), "status" => 1];
                            if ($fetch['accesstoken'] != '') {
                                Capsule::table('mod_soyoustart_imap')->where(['account_user' => $gmailImapDatas->account_user, "gmailaddr" => $gmailImapDatas->gmailaddr])->update(['accesstoken' => $token->access_token, 'created_at' => date("d/m/Y h:i:s A T", $token->created), "status" => 1]);
                            } else {
                                Capsule::table('mod_soyoustart_imap')->where(['account_user' => $gmailImapDatas->account_user, "gmailaddr" => $gmailImapDatas->gmailaddr])->update(['accesstoken' => $token->access_token, 'refereshtoken' => $token->refresh_token, 'created_at' => date("d/m/Y h:i:s A T", $token->created), "status" => 1]);
                            }
                        }
                        $this->tplVar["message"] = "Google auth2 has been configured successfully!";
                    } else {
                        $this->tplVar["warning"] = $gmailImapDatas;
                    }
                }
            }
            $gmailImapDatas = Capsule::table('mod_soyoustart_imap')->where("gmail_secretkey", "!=", "")->get();
            $gmailImapDatas = $gmailImapDatas->toArray();
            $this->tplVar['gmailImapDatas'] = $gmailImapDatas;
            $imapDatas = Capsule::table('mod_soyoustart_imap')->whereNull('gmail_secretkey')->orWhere('gmail_secretkey', '')->get();
            $imapDatas = $imapDatas->toArray();
            $this->tplVar['imapDatas'] = $imapDatas;
            $this->tplVar['crondirpath'] = isset($GLOBALS["crons_dir"]) ? $GLOBALS["crons_dir"] : $_SERVER["DOCUMENT_ROOT"] . '/crons/';
            $alcSettings = $helper->get_data("mod_acl_settings")->first();
            $this->tplVar['imapAclSetting'] = $Configuration->imapAclSetting();
            $this->tplVar['alcSettings'] = !empty($alcSettings) ? json_decode($alcSettings->value, true) : [];
            $this->tplVar['cronConfigStatus'] = $helper->cronConfigStatus($this->tplVar['crondirpath']);
        }
        $this->tplFileName = __FUNCTION__;
        $this->output();
    }
    public function addimap()
    {
        $helper = new Helper();
        global $whmcs;
        if (isset($_SESSION["adminid"])) {
            if ($whmcs->get_req_var("ajaxaction") == "imapTestConnection") {
                $data = html_entity_decode($whmcs->get_req_var("data"));
                parse_str($data, $dataArray);
                unset($dataArray["token"]);
                $response =  $helper->checkWebMailConn($dataArray);
                echo $response;
                exit;
            } elseif ($whmcs->get_req_var("ajaxaction") == "addWebmail") {
                $data = html_entity_decode($whmcs->get_req_var("data"));
                parse_str($data, $dataArray);
                $hostName = $dataArray["hostname"];
                $password = $dataArray["password"];
                $userName = $dataArray["username"];
                $portNumber = $dataArray["portnumber"];
                $sslType = $dataArray["ssltype"];
                $userAccount = explode("_", $dataArray["userAccount"])[0];
                $encUserName = $helper->encryptData($dataArray["username"]);
                $encPassword = $helper->encryptData($dataArray["password"]);
                $dataExist = false;
                // $decryptedData = openssl_decrypt($encryptedData, "AES-256-CBC","encryptionKey123", 0, 1234567891011121);
                if ($whmcs->get_req_var("type") != "Update") {
                    $dataExist = $helper->get_data("mod_soyoustart_imap", ['account_user' => $userAccount, "soyouimaphost" => $hostName])->count();
                }
                if ($dataExist) {
                    $response = "WebMail account user already exist!";
                } else {
                    $response =  $helper->checkWebMailConn(["hostname" => $hostName, "portnumber" => $portNumber, "ssltype" => $sslType, "username" => $userName, "password" => $password]);
                    if ($response == "Connection success!") {
                        $data = ["soyouimaphost" => $hostName, "soyouimapuser" => $encUserName, "soyouimappass" => $encPassword, "soyouimapport" => $portNumber, "soyouimapssl" => $sslType, "language" => $dataArray["language"], "account_user" => $userAccount, "status" => "Active"];
                        $helper->insert_update("mod_soyoustart_imap", ['account_user' => $userAccount, "soyouimaphost" => $hostName], $data);
                    }
                }
                echo $response;
                exit;
            }
            /*  get gmailImapDatas data to showe while editing */ elseif ($whmcs->get_req_var("id") && $whmcs->get_req_var("tab") == "edit") {
                $this->tplVar['gmailImapDatas'] = $helper->get_data("mod_soyoustart_imap", ["id" => $whmcs->get_req_var("id")])->toArray();
            } elseif ($whmcs->get_req_var("id") && $whmcs->get_req_var("tab") == "editWebMail") {
                $this->tplVar['webMailImapDatas'] = $helper->decryptData($helper->get_data("mod_soyoustart_imap", ["id" => $whmcs->get_req_var("id")])->toArray());
            }
            if (isset($_POST) && !empty($_POST)) {
                if ($_POST["saveGsettings"]) {
                    if (empty($_POST["gclientid"]) || empty($_POST["gclientSecret"]) || empty($_POST["gmailaddr"]) || empty($_POST["language"])) {
                        $this->tplVar["warning"] = "All fields are required!";
                    } else {
                        $insert_array = [
                            "gmail_clientId" => $whmcs->get_req_var("gclientid"),
                            "gmail_secretkey" => $whmcs->get_req_var("gclientSecret"),
                            "gmailaddr" => $whmcs->get_req_var("gmailaddr"),
                            "created_at" => date("Y-m-d H:i:s", time()),
                            "language" => $whmcs->get_req_var("language"),
                            "account_user" => explode("_", $whmcs->get_req_var("gmailUserAccount"))[0]
                        ];
                        Capsule::table('mod_soyoustart_imap')->insert($insert_array);
                        $this->tplVar["message"] = "Gmail credential inserted successfully!";
                    }
                } elseif ($whmcs->get_req_var("editGsettings")) {
                    Capsule::table('mod_soyoustart_imap')->where('id', '=', $_GET["id"])->update([
                        "gmail_clientId" => $whmcs->get_req_var("gclientid"),
                        "gmail_secretkey" => $whmcs->get_req_var("gclientSecret"),
                        "gmailaddr" => $whmcs->get_req_var("gmailaddr"),
                        "language" => $whmcs->get_req_var("language"),
                        "account_user" => explode("_", $whmcs->get_req_var("gmailUserAccount"))[0]
                    ]);
                    $this->tplVar["message"] = "Gmail credential updated successfully!";
                } else {
                    // webmail insert data 
                    if ($whmcs->get_req_var("submit")) {
                        $queryCheckUser = Capsule::table('mod_soyoustart_imap')->where('account_user', $whmcs->get_req_var('userAccount'))->count();
                        if (empty($queryCheckUser)) {
                            // checking webmail connection 
                            $response =  $helper->checkWebMailConn($_POST);
                            if ($response == "Connection success!") {
                                Capsule::table('mod_soyoustart_imap')->insert(["soyouimaphost" => $whmcs->get_req_var("hostname"), "soyouimapuser" => $whmcs->get_req_var("username"), "soyouimappass" => $whmcs->get_req_var("password"), "soyouimapport" => $whmcs->get_req_var("portnumber"), "soyouimapssl" => $whmcs->get_req_var("ssltype"), "language" => $whmcs->get_req_var("language"), "account_user" => $whmcs->get_req_var("userAccount"), "status" => "Active"]);
                                $this->tplVar["message"] = "WebMail data inserted successfully!";
                            } else {
                                $this->tplVar["warning"] = $response;
                            }
                        } else {
                            $this->tplVar["warning"] = "WebMail account user already exist!";
                        }
                    } elseif ($_POST["editImap"] && isset($_POST["editImap"])) {
                        //edit webmail  
                        $response =  $helper->checkWebMailConn($_POST);
                        if ($response == "Connection success!") {
                            Capsule::table('mod_soyoustart_imap')->where('id', '=', $_GET["id"])->update(["soyouimaphost" => $_POST["hostname"], "soyouimapuser" => $_POST["username"], "soyouimappass" => $_POST["password"], "soyouimapport" => $_POST["portnumber"], "soyouimapssl" => $_POST["ssltype"], "language" => $_POST["language"], "account_user" => $_POST["userAccount"], "status" => "Active"]);
                            $this->tplVar["message"] = "WebMail data updated successfully!";
                        } else {
                            $this->tplVar["warning"] = $response;
                        }
                    }
                    // webmail test 
                    elseif ($_POST["webmailtest"] && isset($_POST["webmailtest"])) {
                        $response =  $helper->checkWebMailConn($_POST);
                        // echo "<pre>";
                        // print_r($_POST);
                        // print_r($response);
                        // exit;
                        if ($response == "Connection success!") {
                            $this->tplVar["message"] = "WebMail Connection success!";
                        } else {
                            $this->tplVar["warning"] = $response;
                        }
                    }
                }
            }
        }
        $allOvhAccounts = $helper->get_data("mod_soyoustart")->toArray();
        $this->tplVar['allOvhAccounts'] = $allOvhAccounts;
        $this->tplFileName = __FUNCTION__;
        $this->output();
    }
    public function existingserver()
    {
        global $whmcs;
        require_once __DIR__ . DS . '/../../classes/ExistingServer.php';
        $existingServer = new ExistingServer();
        $helper = new Helper();
        $apiCall = new ApiCall();
        if (isset($_SESSION["adminid"])) {
            if ($whmcs->get_req_var("serverList")) {
                $html = $existingServer->getClientProduts($whmcs->get_req_var('userId'));
                echo json_encode($html);
                exit;
            } elseif ($whmcs->get_req_var("accountNumber")) {
                $accountList = $existingServer->getOvhAccounts($whmcs->get_req_var('location'));
                echo json_encode($accountList);
                exit;
            } elseif ($whmcs->get_req_var("ajaxAction") == "createNewOrder") {
                $data = html_entity_decode($whmcs->get_req_var("data"));
                parse_str($data, $dataArray);
                $response = $existingServer->createOrder($dataArray, $apiCall);
                echo json_encode($response);
                exit;
                if ($response["result"] == "success") {
                    $this->tplVar["message"] = "Order has been created successfully!";
                } else {
                    $this->tplVar["warning"] = $response["error"];
                }
            } elseif ($whmcs->get_req_var("getProductConfOption")) {
                $productDetails = $existingServer->getProductDetails($whmcs->get_req_var("productId"));
                $billingCycle = $whmcs->get_req_var("billingCycle");
                $createProductCongifHtml = $existingServer->createProductCongifHtml($productDetails, $billingCycle);
                echo $createProductCongifHtml;
                exit;
            } elseif ($whmcs->get_req_var("existServer")) {
                $apiCall = new ApiCall();
                $service = explode("_", $whmcs->get_req_var("service"));
                $packageId = $service[1];
                $serviceId = $service[0];
                $location = $whmcs->get_req_var("locationexist");
                $ovhServerName = $whmcs->get_req_var("ovhservernameexist");
                $accountId = (explode("_", $whmcs->get_req_var("accountexist")));
                $productDetails = $apiCall->get_data("tblproducts", ["id" => $packageId], "first");
                $producServer = $productDetails->servertype;
                $serverInfo = $apiCall->getServerInfo($location, $producServer, $ovhServerName, $accountId[0]);
                if ($serverInfo["httpcode"] == 200) {
                    $data = ["ovh_server_name" => $whmcs->get_req_var("ovhservernameexist"), "ovh_server_location" => $whmcs->get_req_var("locationexist"), "ovh_custom_hostname" => $whmcs->get_req_var("newovhCustomHostName")];
                    $response = $existingServer->insert_custom_fields_values($data, $serviceId, $packageId);
                    if ($response == "success") {
                        $this->tplVar["message"] = "Server has been assigned successfully!";
                    } else {
                        $this->tplVar["warning"] = "There is some problem.";
                    }
                } else {
                    $this->tplVar["warning"] = $serverInfo["result"]->message . " for (location: $location, Account: $accountId[1], Server Name: $ovhServerName)";
                }
            }
        }
        $this->tplVar["users"] = $helper->get_data("tblclients");
        $this->tplVar["paymentMethods"] = $helper->getAllPaymentMethods();
        $this->tplVar["Products"] = $existingServer->getAllProducts();
        $this->tplVar["serverLocation"] = $existingServer->serverLocation();
        $this->tplFileName = __FUNCTION__;
        $this->output();
    }
    public function manageemailtemplates()
    {
        global $whmcs;
        require_once __DIR__ . DS . '/../../classes/EmailTemplates.php';
        $emailTemplates = new EmailTemplates();
        if (isset($_SESSION["adminid"])) {
            /* disable selected email templates */
            if ($whmcs->get_req_var("manageEmailTemplate")) {
                if ($whmcs->get_req_var("templateID")) {
                    foreach ($whmcs->get_req_var("templateID") as $id) {
                        $emailTemplates->insert_update("tblemailtemplates", ["id" => $id], ["disabled" => 1]);
                        // Capsule::table("tblemailtemplates")->where('id', '=', $id)->update(["disabled" => 1]);
                    }
                    $this->tplVar["message"] = "success";
                    echo json_encode($this->tplVar["message"]);
                    exit;
                } else {
                    echo json_encode("errror");
                    exit;
                }
            }
            /* disable single email template */ elseif ($whmcs->get_req_var("disableTemplate")) {
                $emailTemplates->insert_update("tblemailtemplates", ["id" => $whmcs->get_req_var("templateID")], ["disabled" => 1]);
                echo json_encode("success");
                exit;
            }
            /* enable single email template */ elseif ($whmcs->get_req_var("enableTemplate")) {
                $emailTemplates->insert_update("tblemailtemplates", ["id" => $whmcs->get_req_var("templateID")], ["disabled" => 0]);
                echo json_encode("success");
                exit;
            }
            /* update email template data */ elseif ($whmcs->get_req_var("updateTemplateData")) {
                $message = $whmcs->get_req_var('message');
                $templateID = $whmcs->get_req_var('templateId');
                $subject = $whmcs->get_req_var('tempsubject');
                $emailTemplates->insert_update("tblemailtemplates", ["id" => $templateID], ['subject' => $subject, 'message' => $message]);
                $this->tplVar["message"] = "Email template data updated successfully!";
            }
            if ($whmcs->get_req_var("tab") == "edittemplate" && $whmcs->get_req_var("templateId") != "") {
                $templateData = Capsule::table('tblemailtemplates')->where('id', $whmcs->get_req_var("templateId"))->get();
                $templateData = $templateData->toArray();
                $this->tplVar["editTemplateData"] = $templateData;
            }
        }
        $this->tplVar["custommailTemplate"] = $emailTemplates->getAllCustomEmailTemp();
        $this->tplFileName = __FUNCTION__;
        $this->output();
    }
    public function productsetting()
    {
        global $whmcs;
        $helper = new Helper();
        $Configuration = new Configuration();
        require_once __DIR__ . DS . '/../../classes/ProductSetting.php';
        $productSetting = new ProductSetting();
        $apiCall = new ApiCall();
        /*  ajax hit */
        if ($whmcs->get_req_var("subsidiarytype")) {
            $acountDetails = explode("-", $whmcs->get_req_var("account"));
            $accountId = $acountDetails[0];
            $location = $acountDetails[1];
            $response = $apiCall->get("/partner", $accountId, $location, "Getting Partner Details", true);
            if ($response["httpcode"] == 200 && $response["result"]->acceptanceStatus == "Registered") {
                $result = $productSetting->getSubsidiaryType($_POST, "Registered");
            } else {
                $result = $productSetting->getSubsidiaryType($_POST);
            }
            echo $result;
            exit;
        } elseif ($whmcs->get_req_var("location")) {
            $locationname = $_POST['account'];
            $locationexplode = explode("-", $locationname);
            $string = preg_replace('/\s+/', '', $locationexplode[1]);
            echo $string;
            exit;
        } elseif ($whmcs->get_req_var("productgroup")) {
            $result = $helper->getproductgroup($_POST, $Configuration);
            echo $result;
            exit;
        } elseif ($whmcs->get_req_var("getproduct")) {
            $result = $helper->getProducts($_POST, $Configuration);
            echo json_encode($result);
            exit;
        } elseif ($whmcs->get_req_var("saveHideOs")) {
            $selectedOs = $whmcs->get_req_var("selectedOs");
            $allInstalledOs = $apiCall->getOs();
            if ($allInstalledOs["httpcode"] != "200") {
                echo ($allInstalledOs["result"]->message);
                exit;
            }
            $allInstalledOsDetails = $apiCall->getOsDetails($allInstalledOs["result"]);
            /* hiding configurable options related to os subfamily */
            $response = $helper->hideConfigurableOptions($allInstalledOsDetails, $selectedOs);
            if ($response == "There is no configurable option for the OS!") {
                echo $response;
                exit;
            }
            $response = $helper->insert_update("mod_soyoustart_setting", ["settings" => "hideOS"], ["settings" => "hideOS", "value" => (empty($selectedOs) ? '' : json_encode($selectedOs))]);
            echo ($response);
            exit;
        } elseif ($whmcs->get_req_var("ajaxAction") == "soyouStartproductSetup") {
            $data = html_entity_decode($whmcs->get_req_var("data"));
            parse_str($data, $dataArray);
            foreach ($dataArray as $key => $value) {
                if (strpos($key, '_') !== false && strpos($data, str_replace('_', '.', $key)) !== false) {
                    $dataArray[str_replace('_', '.', $key)] = $value;
                    unset($dataArray[$key]);
                }
            }
            $serverLocation = explode("-", $dataArray['ovhservicetype'])[1];
            /* create new product group  */
            $productGroupName = $dataArray['ovhgroupname'];
            // $productGroupName = $dataArray['ovhgroupname'] . ' ' . $serverLocation;
            $slug = $dataArray['ovhproducttype'] . "-server-" . $serverLocation;
            $productGroupId = $productSetting->createProductGroups($productGroupName, $slug);
            /* start create dedicated product in ovh type  */
            if ($dataArray['ovhlocationtype'] == "Ovh" && $dataArray['ovhproductgroupname'] == "Dedicated") {
                $getproductMargin = $helper->get_data("mod_soyoustart_pricesetting", ["server" => "OVH", "servertype" => "Dedicated"], "first");
                $productsFromApi = $productSetting->formateProductData($dataArray['ovhsubsidiarytype'], $dataArray['ovhproducttype'], "DEDICATED", $Configuration);
                $exchangeRates = $helper->getWhmcsConversionRate($productsFromApi["currency"]);
                /*  importing only checked products into Whmcs from api */
                foreach ($dataArray['productcheck'] as $productcheck) {
                    foreach ($productsFromApi["products"] as $productDetails) {
                        if ($productcheck == $productDetails->planCode) {
                            $productDesc = $productSetting->productDescription($productDetails, $dataArray["ovhproducttype"], $productsFromApi["productsProcessor"], $productsFromApi["addons"], $Configuration);
                            $ovhproductgroupname = "soyoustart";
                            $checkproduct = $helper->get_data("mod_soyoustart_products", ["plancode" => $productcheck], "first");
                            $checkproductexist = $helper->get_data("tblproducts", ["id" => $checkproduct->productid], "first");
                            if (empty($checkproductexist)) {
                                $helper->delete("mod_soyoustart_products", ["plancode" => $productcheck]);
                            }
                            $configoption2 = $dataArray['ovhproducttype'] . '@' . $productcheck;
                            $productName = $dataArray[$productcheck];
                            $data = ["type" => "hostingaccount", "gid" => $productGroupId, "name" => $productName, "slug" => $productcheck, "description" => $productDesc, "paytype" => "recurring", "autosetup" => "payment", "servertype" => $ovhproductgroupname, "configoption1" => "OVH", "configoption2" => $configoption2, "configoption3" => $dataArray['ovhservicetype'], "configoption4" => $dataArray['ovhsubsidiarytype'], "configoption5" => json_encode($dataArray['hideOS'])];
                            /*  create new product .................................................... */
                            /* inserting or updating products */
                            $createnewproductid = $helper->updateOrCreateGetId("tblproducts", ["id" => $checkproduct->productid], $data);
                            $productSlug = $helper->getProductSlug($createnewproductid);
                            // $helper->insert_update("mod_soyoustart_products", ["productid" => $createnewproductid], ["plancode" => $productcheck, "productid" => $createnewproductid]);
                            $helper->insert_update("mod_soyoustart_products", ["productid" => $createnewproductid], ["plancode" => $productSlug, "productid" => $createnewproductid]);
                            /* creating Product Custom fields */
                            $productSetting->createCustomFields($createnewproductid);
                            /* creating or updating slug  */
                            // $slugData = ["product_id" => $createnewproductid, "group_id" => $productGroupId, "group_slug" => $dataArray['ovhproducttype'], "slug" => $productcheck, "active" => "1"];
                            $slugData = ["product_id" => $createnewproductid, "group_id" => $productGroupId, "group_slug" => $dataArray['ovhproducttype'], "slug" => $productSlug, "active" => "1"];
                            $test =  $helper->insert_update("tblproducts_slugs", ["product_id" => $createnewproductid, "group_id" => $productGroupId], $slugData);
                            //update price of products ............................................................. 
                            $priceUpdationVarProducts = $productSetting->soyouStartPriceUpdation($productDetails->pricings, $getproductMargin->productprice, $getproductMargin->setupprice);
                            $updateproductprice = $productSetting->updateprice($productsFromApi["currency"], $createnewproductid, 'product', $priceUpdationVarProducts, $exchangeRates);
                            /* .................... start create a  product config group ....................... */
                            $chkGroup02 = Capsule::table('tblproductconfiggroups')->select('id')->where('description', $productcheck)->first();
                            if (!empty($chkGroup02)) {
                                $groupID = $chkGroup02->id;
                            } else {
                                $groupID = Capsule::table('tblproductconfiggroups')->insertGetId(array('name' => $productcheck, 'description' => $productcheck));
                            }
                            $chkProGpLink = Capsule::table('tblproductconfiglinks')->where('gid', $groupID)->where('pid', $createnewproductid)->count();
                            if ($chkProGpLink == '0') {
                                Capsule::table('tblproductconfiglinks')->insertGetId(array('gid' => $groupID, 'pid' => $createnewproductid));
                            }
                            /*....................... start server location detail ................................... */
                            $optionNameVal = 'server_location|Server Location';
                            // $chkOption = $helper->get_data("tblproductconfigoptions", ['gid' => $groupID, 'optionname' => $optionNameVal, 'optiontype' => 1], "first");
                            $chkOption = Capsule::table("tblproductconfigoptions")->where('optionname', "like", "%" . explode("|", $optionNameVal)[0])->where(['gid' => $groupID, 'optiontype' => 1])->first();
                            if (is_null($chkOption)) {
                                $optionId = Capsule::table('tblproductconfigoptions')->insertGetId(array('gid' => $groupID, 'optionname' => $optionNameVal, 'optiontype' => '1', 'order' => '1'));
                            } else {
                                $optionId = $chkOption->id;
                            }
                            /* creating server location product configurable options */
                            $productsDatacenters = $helper->setproductconfig($productDetails, 'configurations', 'dedicated_datacenter');
                            $productSetting->createServerLocConfig($productsDatacenters, $optionId, $productsFromApi["currency"], $exchangeRates);
                            /* creating API product addon configurable options */
                            $productSetting->createAddonConfigOptions($productDetails, $productsFromApi["addons"], $getproductMargin, $groupID, $productsFromApi["currency"], $exchangeRates);
                            /* creating Aditinal IP configurable options */
                            $configOptionsData =  $Configuration->aditinalIpConfigOptionsData();
                            $productSetting->createAditinalIpConfigOptions($configOptionsData, $getproductMargin, $groupID, $productsFromApi["currency"], $exchangeRates);
                            /* assign OS license config group .............................................................................................. */
                            // $getdedicatedgroupid = $helper->get_data("tblproductconfiggroups", ['name' => "Soyoustart OS"], "first");
                            // if (is_object($getdedicatedgroupid)) {
                            //     $productSetting->assignOsLicenseConfigGroup($getdedicatedgroupid, $createnewproductid);
                            // } else {
                            //     echo "Assign OS license config group failed.";
                            //     exit;
                            // }
                            
                        }
                    }
                }
                echo "Product has been created successfully!";
                exit;
            } elseif ($dataArray['ovhlocationtype'] == "Ovh" && $dataArray['ovhproductgroupname'] == "VPS") {
                $getproductMargin = $helper->get_data("mod_soyoustart_pricesetting", ["server" => "OVH", "servertype" => "VPS"], "first");
                $productsFromApi = $productSetting->formateProductData($dataArray['ovhsubsidiarytype'], $dataArray['ovhproducttype'], "VPS", $Configuration);
                $exchangeRates = $helper->getWhmcsConversionRate($productsFromApi["currency"]);
                foreach ($dataArray['productcheck'] as $productcheck) {
                    foreach ($productsFromApi["products"] as $productDetails) {
                        if ($productcheck == $productDetails->planCode) {
                            $ovhproductgroupname = "soyoustart_vps";
                            $productDesc = $productSetting->planVPSDescription($productDetails->product, $productsFromApi);
                            $checkproduct = $helper->get_data("mod_soyoustart_products", ["plancode" => $productcheck], "first");
                            $checkproductexist = $helper->get_data("tblproducts", ["id" => $checkproduct->productid], "first");
                            if (empty($checkproductexist)) {
                                $helper->delete("mod_soyoustart_products", ["plancode" => $productcheck]);
                            }
                            $configoption2 = $dataArray['ovhproducttype'] . '@' . $productcheck;
                            $productName = $dataArray[$productcheck];
                            $data = ["type" => "hostingaccount", "gid" => $productGroupId, "name" => $productName, "slug" => $productcheck, "description" => $productDesc, "paytype" => "recurring", "autosetup" => "payment", "servertype" => $ovhproductgroupname, "configoption1" => "VPS", "configoption2" => $configoption2, "configoption3" => $dataArray['ovhservicetype'], "configoption4" => $dataArray['ovhsubsidiarytype'], "configoption5" => json_encode($dataArray['hideOS'])];
                            /*  create new product .................................................... */
                            /* inserting or updating products */
                            $createnewproductid = $helper->updateOrCreateGetId("tblproducts", ["id" => $checkproduct->productid], $data);
                            $productSlug = $helper->getProductSlug($createnewproductid);
                            // $helper->insert_update("mod_soyoustart_products", ["productid" => $createnewproductid], ["plancode" => $productcheck, "productid" => $createnewproductid], $dataArray['ovhservicetype'] ?? null);
                            $helper->insert_update("mod_soyoustart_products", ["productid" => $createnewproductid], ["plancode" => $productSlug, "productid" => $createnewproductid], $dataArray['ovhservicetype'] ?? null);
                            /* creating Product Custom fields */
                            $productSetting->createCustomFields($createnewproductid);
                            // /* creating or updating slug  */
                            // $slugData = ["product_id" => $createnewproductid, "group_id" => $productGroupId, "group_slug" => $dataArray['ovhproducttype'], "slug" => $productcheck, "active" => "1"];
                            $slugData = ["product_id" => $createnewproductid, "group_id" => $productGroupId, "group_slug" => $dataArray['ovhproducttype'], "slug" => $productSlug, "active" => "1"];
                            $test =  $helper->insert_update("tblproducts_slugs", ["product_id" => $createnewproductid, "group_id" => $productGroupId], $slugData);
                            //update price of products ............................................................. 
                            /* calculating product price with margin */
                            $priceUpdationVarProducts = $productSetting->soyouStartPriceUpdation($productDetails->pricings, $getproductMargin->productprice, $getproductMargin->setupprice);
                            // /* updating product price*/
                            $updateproductprice = $productSetting->updateprice($productsFromApi["currency"], $createnewproductid, 'product', $priceUpdationVarProducts, $exchangeRates);
                            /*  start create a  product config group ........................................... */
                            $chkGroup02 = Capsule::table('tblproductconfiggroups')->select('id')->where('description', $productcheck)->first();
                            if (!empty($chkGroup02)) {
                                $groupID = $chkGroup02->id;
                            } else {
                                $groupID = Capsule::table('tblproductconfiggroups')->insertGetId(array('name' => $productcheck, 'description' => $productcheck));
                            }
                            $chkProGpLink = Capsule::table('tblproductconfiglinks')->where('gid', $groupID)->where('pid', $createnewproductid)->count();
                            if ($chkProGpLink == '0') {
                                Capsule::table('tblproductconfiglinks')->insertGetId(array('gid' => $groupID, 'pid' => $createnewproductid));
                            }
                            // /* start server location detail .......................................................... */
                            $optionNameVal = 'server_location|Server Location';
                            // $chkOption = $helper->get_data("tblproductconfigoptions", ['gid' => $groupID, 'optionname' => $optionNameVal, 'optiontype' => 1], "first");
                            $chkOption = Capsule::table("tblproductconfigoptions")->where('optionname', "like", "%" . explode("|", $optionNameVal)[0])->where(['gid' => $groupID, 'optiontype' => 1])->first();
                            if (!isset($chkOption->id)) {
                                $optionId = Capsule::table('tblproductconfigoptions')->insertGetId(array('gid' => $groupID, 'optionname' => $optionNameVal, 'optiontype' => 1, 'order' => '1'));
                            } else {
                                $optionId = $chkOption->id;
                            }
                            /* creating server location product configurable options */
                            $productsDatacenters = $helper->setproductconfig($productDetails, 'configurations', 'vps_datacenter');
                            $productSetting->createServerLocConfig($productsDatacenters, $optionId, $productsFromApi["currency"], $exchangeRates);
                            /* creating product addonFamilies configurable options */
                            $productSetting->createAddonFamiliesConfigOptions($productDetails, $productsFromApi["addons"], $getproductMargin, $groupID, $productsFromApi["currency"], $exchangeRates);
                            $productSetting->createVpsConfigOptions($productDetails, $productsFromApi["addons"], $getproductMargin, $groupID, $productsFromApi["currency"], $exchangeRates);
                            /* creating product configurations configurable options */
                            $configOptionsData = $Configuration->aditinalIpConfigOptionsData();
                            $productSetting->createAditinalIpConfigOptions($configOptionsData, $getproductMargin, $groupID, $productsFromApi["currency"], $exchangeRates);
                        }
                    }
                }
                echo "Product has been created successfully!";
                exit;
            } else {
                $getproductMargin = $helper->get_data("mod_soyoustart_pricesetting", ["server" => "OVH", "servertype" => "PublicCloud"], "first");
                $productsFromApi = $productSetting->formateProductData($dataArray['ovhsubsidiarytype'], $dataArray['ovhproducttype'], "ECO_DIDICATED", $Configuration);
                $exchangeRates = $helper->getWhmcsConversionRate($productsFromApi["currency"]);
                foreach ($dataArray['productcheck'] as $productcheck) {
                    foreach ($productsFromApi["products"] as $productDetails) {
                        if ($productcheck == $productDetails->planCode) {
                            $ovhproductgroupname = "soyoustart";
                            $productDesc = $productSetting->productDescription($productDetails, $dataArray["ovhproducttype"], $productsFromApi["productsProcessor"], $productsFromApi["addons"], $Configuration);
                            $checkproduct = $helper->get_data("mod_soyoustart_products", ["plancode" => $productcheck], "first");
                            $checkproductexist = $helper->get_data("tblproducts", ["id" => $checkproduct->productid], "first");
                            if (empty($checkproductexist)) {
                                $helper->delete("mod_soyoustart_products", ["plancode" => $productcheck]);
                            }
                            $configoption2 = $dataArray['ovhproducttype'] . '@' . $productcheck;
                            $productName = $dataArray[$productcheck];
                            $data = ["type" => "hostingaccount", "gid" => $productGroupId, "name" => $productName, "slug" => $productcheck, "description" => $productDesc, "paytype" => "recurring", "autosetup" => "payment", "servertype" => $ovhproductgroupname, "configoption1" => "PublicCloud", "configoption2" => $configoption2, "configoption3" => $dataArray['ovhservicetype'], "configoption4" => $dataArray['ovhsubsidiarytype'], "configoption5" => json_encode($dataArray['hideOS'])];
                            /*  create new product .................................................... */
                            /* inserting or updating products */
                            $createnewproductid = $helper->updateOrCreateGetId("tblproducts", ["id" => $checkproduct->productid], $data);
                            $productSlug = $helper->getProductSlug($createnewproductid);
                            // $helper->insert_update("mod_soyoustart_products", ["productid" => $createnewproductid], ["plancode" => $productcheck, "productid" => $createnewproductid]);
                            $helper->insert_update("mod_soyoustart_products", ["productid" => $createnewproductid], ["plancode" => $productSlug, "productid" => $createnewproductid]);
                            /* creating Product Custom fields */
                            $productSetting->createCustomFields($createnewproductid);
                            /* creating or updating slug  */
                            // $slugData = ["product_id" => $createnewproductid, "group_id" => $productGroupId, "group_slug" => $dataArray['ovhproducttype'], "slug" => $productcheck, "active" => "1"];
                            $slugData = ["product_id" => $createnewproductid, "group_id" => $productGroupId, "group_slug" => $dataArray['ovhproducttype'], "slug" => $productSlug, "active" => "1"];
                            $test =  $helper->insert_update("tblproducts_slugs", ["product_id" => $createnewproductid, "group_id" => $productGroupId], $slugData);
                            //update price of products ............................................................. 
                            $priceUpdationVarProducts = $productSetting->soyouStartPriceUpdation($productDetails->pricings, $getproductMargin->productprice, $getproductMargin->setupprice);
                            $updateproductprice = $productSetting->updateprice($productsFromApi["currency"], $createnewproductid, 'product', $priceUpdationVarProducts, $exchangeRates);
                            /*  start create a  product config group ........................................... */
                            $chkGroup02 = Capsule::table('tblproductconfiggroups')->select('id')->where('description', $productcheck)->first();
                            if (!empty($chkGroup02)) {
                                $groupID = $chkGroup02->id;
                            } else {
                                $groupID = Capsule::table('tblproductconfiggroups')->insertGetId(array('name' => $productcheck, 'description' => $productcheck));
                            }
                            $chkProGpLink = Capsule::table('tblproductconfiglinks')->where('gid', $groupID)->where('pid', $createnewproductid)->count();
                            if ($chkProGpLink == '0') {
                                Capsule::table('tblproductconfiglinks')->insertGetId(array('gid' => $groupID, 'pid' => $createnewproductid));
                            }
                            /* start server location detail .......................................................... */
                            $optionNameVal = 'server_location|Server Location';
                            $chkOption = Capsule::table("tblproductconfigoptions")->where('optionname', "like", "%" . explode("|", $optionNameVal)[0])->where(['gid' => $groupID, 'optiontype' => 1])->first();
                            if (is_null($chkOption)) {
                                $optionId = Capsule::table('tblproductconfigoptions')->insertGetId(array('gid' => $groupID, 'optionname' => $optionNameVal, 'optiontype' => '1', 'order' => '1'));
                            } else {
                                $optionId = $chkOption->id;
                            }
                            $productsDatacenters = $helper->setproductconfig($productDetails, 'configurations', 'dedicated_datacenter');
                            /* creating server location product configurable options */
                            $productSetting->createServerLocConfig($productsDatacenters, $optionId, $productsFromApi["currency"], $exchangeRates);
                            /* creating Aditinal IP configurable options */
                            $configOptionsData =  $Configuration->aditinalIpConfigOptionsData();
                            $productSetting->createAditinalIpConfigOptions($configOptionsData, $getproductMargin, $groupID, $productsFromApi["currency"], $exchangeRates);
                            /* creating API product addon configurable options */
                            $productSetting->createAddonConfigOptions($productDetails, $productsFromApi["addons"], $getproductMargin, $groupID, $productsFromApi["currency"], $exchangeRates);
                            /* assign OS license config group .............................................................................................. */
                            // $getdedicatedgroupid = $helper->get_data("tblproductconfiggroups", ['name' => "Soyoustart OS"], "first");
                            // if (is_object($getdedicatedgroupid)) {
                            //     $productSetting->assignOsLicenseConfigGroup($getdedicatedgroupid, $createnewproductid);
                            // } else {
                            //     echo "Assign OS license config group failed.";
                            //     exit;
                            // }
                        }
                    }
                }
            }
            echo "Product has been created successfully!";
            exit;
        } elseif ($whmcs->get_req_var("ajaxAction") == "deleteProduct" && $whmcs->get_req_var("Id")) {
            $pid = $whmcs->get_req_var("Id");
            $response = $productSetting->deleteWhmcsProduct($pid);
            echo $response;
            exit;
        } elseif ($whmcs->get_req_var("ajaxAction") == "enableDisablePriceSync") {
            $data = [
                "pricesync" => ($whmcs->get_req_var("actionType") == "disable" ? 1 : 0),
            ];
            $response = $helper->insert_update("mod_soyoustart_products", ["productid" => $whmcs->get_req_var("Id")], $data);
            if ($response == "Data has been inserted successfully!" || $response == "Data has been updated successfully!") {
                echo json_encode(["status" => "success", "actionType" => $whmcs->get_req_var("actionType")]);
            } else {
                echo json_encode(["status" => $response, "actionType" => $whmcs->get_req_var("actionType")]);
            }
            exit;
        } elseif ($whmcs->get_req_var("ajaxAction") == "hideDepricatedProduct") {
            if (empty($whmcs->get_req_var("values"))) {
                echo json_encode(["status" => "error", "message" => "No deprecated product selected/found!"]);
                exit;
            }
            foreach ($whmcs->get_req_var("values") as $key => $value) {
                $productId = $helper->get_data("mod_soyoustart_products", ["plancode" => $value], "first")->productid;
                if (!is_null($productId)) {
                    $helper->insert_update("tblproducts", ["id" => $productId], ["hidden" => 1]);
                }
            }
            echo json_encode(["status" => "success", "message" => "Selected deprecated products have been hidden successfully!"]);
            exit;
        }
        $this->tplVar["productType"] = $Configuration->productType();
        $this->tplVar["hideOsName"] = $Configuration->hideOsName();
        $this->tplVar["defaultOsList"] = $Configuration->defaultOsList();
        $this->tplVar["accountName"] = $productSetting->getAccountName();
        $this->tplVar["products"] = $productSetting->getAllProducts();
        $this->tplVar["hideOs"] = $helper->get_data("mod_soyoustart_setting", ["settings" => "hideOS"], "first");
        $this->tplVar["hideOs"] =  ($this->tplVar["hideOs"]->value == "" ? [] : json_decode($this->tplVar["hideOs"]->value));
        $this->tplFileName = __FUNCTION__;
        $this->output();
    }
    public function productpricesetting()
    {
        global $whmcs;
        $productId = $whmcs->get_req_var('id');
        $helper = new Helper();
        if (isset($_SESSION["adminid"])) {
            if ($whmcs->get_req_var('soyouStartproductpriceSetup')) {
                $data = $_POST;
                $update = $helper->updateProductPrices($data, $productId);
                if ($update == true) {
                    $this->tplVar["message"] = "Updated successfully!";
                } else {
                    $this->tplVar["warning"] = $update;
                }
            }
        }
        $currency = Capsule::table("tblcurrencies")->get();
        $totalcurrency  =  count($currency);
        $productdetail = Capsule::table("tblproducts")->where("id", $productId)->first();
        $productprices = [];
        foreach ($currency as $key => $value) {
            $productprices[$value->id] = $value;
            $productprices[$value->id]->prices = Capsule::table("tblpricing")->where("type", "product")->where("relid", $productdetail->id)->where("currency", $value->id)->first();
        }
        // geting product configuration  options
        $productconfigDetails = $helper->getConfigOptions($productId);
        $this->tplVar["productdetail"] = $productdetail;
        $this->tplVar["totalcurrency"] = $totalcurrency;
        $this->tplVar["productprices"] = $productprices;
        $this->tplVar["productconfigDetails"] = $productconfigDetails;
        $this->tplFileName = __FUNCTION__;
        $this->output();
    }
    public function logs()
    {
        global $whmcs;
        $helper = new Helper();
        if (isset($_SESSION["adminid"])) {
            if ($whmcs->get_req_var("deleteLog")) {
                $response = $helper->delete("mod_soyoustart_log");
                $response = $helper->delete("mod_soyoustart_email_log");
                if (str_contains($response, "error")) {
                    echo "success";
                } else {
                    echo $response;
                }
                exit;
            } elseif ($whmcs->get_req_var("getLogs")) {
                $start  = $whmcs->get_req_var('start');
                $length = $whmcs->get_req_var('length');
                $search = $whmcs->get_req_var('search')['value'] ?? '';
                $draw   = $whmcs->get_req_var('draw') ?? 1;
                $totalData = Capsule::table('mod_soyoustart_log')->count();
                $query = Capsule::table('mod_soyoustart_log');
                if ($search != '') {
                    $query->where(function ($q) use ($search) {
                        $q->where('type', 'like', "%$search%")
                            ->orWhere('action', 'like', "%$search%")
                            ->orWhere('request', 'like', "%$search%");
                    });
                }
                $filteredQuery = clone $query;
                $filteredData = $filteredQuery->count();
                $data = $query->orderBy('id', 'DESC')->offset($start)->limit($length)->get();
                $response = [];
                foreach ($data as $key => $value) {
                    $response[] = [
                        "date" => $value->datetime,
                        "type" => $value->type,
                        "action" => $value->action,
                        "request"  => '<textarea rows="5" class="form-control">' . ($value->request) . '</textarea>',
                        "response" => '<textarea rows="5" class="form-control">' . ($value->response) . '</textarea>',
                    ];
                }
                echo json_encode([
                    "draw" => intval($draw),
                    "recordsTotal" => $totalData,
                    "recordsFiltered" => $filteredData,
                    "data" => $response
                ]);
                die;
            }
        }
        // $this->tplVar['moduleLogs'] = Capsule::table("mod_soyoustart_log")->orderBy('datetime', 'DESC')->get()->toArray();
        $this->tplVar['cronLogs'] = Capsule::table("mod_soyoustart_email_log")->orderBy('datetime', 'DESC')->get()->toArray();
        $this->tplFileName = __FUNCTION__;
        $this->output();
    }
    public function ordermanagement()
    {
        global $whmcs;
        require_once __DIR__ . DS . '/../../classes/OrderManage.php';
        $obj = new OrderManage();
        $helper = new Helper();
        $this->tplVar['allOrders'] = $obj->getAllOrders($allServersPackages);
        if (isset($_SESSION["adminid"])) {
            if ($whmcs->get_req_var("orderStatus")) {
                $customFields =  $helper->getCustomFieldValues($whmcs->get_req_var("serviceId"));
                $customFieldsValue = [];
                foreach ($customFields as $value) {
                    $name = explode("|", $value->fieldname)[0];
                    $customFieldsValue[$name] = $value->value;
                }
                $accountDetails = $helper->get_data("mod_soyoustart", ["account_number" => $customFieldsValue["ovh_account"], "location" => $customFieldsValue["ovh_server_location"]], "first");
                $orderStatus = $obj->getOrderStatus($accountDetails->location, $accountDetails->id, $customFieldsValue["ovh_order_id"]);
                if ($orderStatus["httpcode"] == 200) {
                    if ($orderStatus["result"] == "notPaid") {
                        $orderStatus["result"] = "<span class=\"badge badge-secondary\">Payment Pending</span>";
                    } else if ($orderStatus["result"] == "delivered") {
                        $orderStatus["result"] = "<span class=\"badge badge-success\">Server Delivered</span>";
                    }
                } else {
                    $orderStatus["result"]->message = "<span class=\"badge badge-info\"> " . $orderStatus["result"]->message . "</span>";
                }
                echo json_encode($orderStatus);
                exit;
            }
        }
        $this->tplFileName = __FUNCTION__;
        $this->output();
    }
    public function serversstatus()
    {
        global $whmcs;
        $apiCall = new ApiCall();
        require_once __DIR__ . DS . '/../../classes/ServerStatus.php';
        $obj = new ServerStatus();
        $helper = new Helper();
        if (isset($_SESSION["adminid"])) {
            if ($whmcs->get_req_var("ajaxAction") == "terminateServer") {
                $accountInfo = $apiCall->get_data("mod_soyoustart", ["id" => $whmcs->get_req_var("id")], "first");
                if (!isset($accountInfo->id)) {
                    echo json_encode(["httpcode" => 404, "result" => ["message" => "Account id $whmcs->get_req_var(\"id\") not found. please check in key generate tab."]]);
                    exit;
                }
                $response = $apiCall->terminateServer($accountInfo->location, $whmcs->get_req_var("serverType"),  $whmcs->get_req_var("serverName"), $accountInfo->id);
                echo json_encode($response);
                exit;
            } elseif ($whmcs->get_req_var("orderStatus")) {
                // if($whmcs->get_req_var("serverName") == ''){
                //     echo '<span class="label label-warning">SERVER HAS NOT BEEN ASSIGNED YET!</span>';
                //     exit;
                // }
                // $customFields =  $helper->getCustomFieldValues($whmcs->get_req_var("serviceId"));
                // $customFieldsValue = [];
                // foreach ($customFields as $value) {
                //     $name = explode("|", $value->fieldname)[0];
                //     $customFieldsValue[$name] = $value->value;
                // }
                // $accountDetails = $helper->get_data("mod_soyoustart", ["account_number" => $customFieldsValue["ovh_account"]], "first");
                // $serverInfo = $apiCall->getServerInfo($accountDetails->location, $whmcs->get_req_var("serverType"), $whmcs->get_req_var("serverName"), $accountDetails->id);
                // if ($serverInfo["httpcode"] != 200) {
                //     echo $serverInfo["result"]->message;
                //     exit;
                // }
                // if ($serverInfo["result"]->state == "running" || $serverInfo["result"]->state == "ok") {
                //     echo '<span class="label label-success">Active</span>';
                //     exit;
                // }else{
                //     echo '<span class="label label-warning">'.$serverInfo["result"]->state.'</span>';
                // }
                // exit;
                // // $allServerPackages[$key]->serverInfo = $serverInfo["result"];
                // echo "<pre>";
                // print_r($accountDetails);
                // print_r($serverInfo);
                // print_r($_POST);
                // exit;
            }
        }
        // $allServersPackages = $obj->getAllServerPackages();
        /* getting server info */
        $this->tplVar['allPackages'] =  $obj->allPackages($allServersPackages);
        // $this->tplVar['allPackages'] =  $obj->getAllServerPackages();
        $this->tplFileName = __FUNCTION__;
        $this->output();
    }
    public function output($data = null)
    {
        $this->tplVar['data'] = $data;
        $this->smarty = new Smarty();
        $this->smarty->assign('tplVar', $this->tplVar);
        if (!empty($this->tplFileName)) {
            $this->smarty->display($this->tplVar['tplDIR'] . $this->tplFileName . '.tpl');
        } else {
            $this->tplVar['errorMsg'] = 'not found';
            $this->smarty->display($this->tplDIR . 'error.tpl');
        }
    }
}
