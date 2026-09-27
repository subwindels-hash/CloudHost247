<?php
namespace WGSModule\Soyoustart\classes;
use WHMCS\Database\Capsule;
use WHMCS\Module\Addon\Soyoustart\Helper;
use WGSModule\Soyoustart\classes\ProductSetting;
require_once __DIR__ . '/ProductSetting.php';
class Upgrade extends ProductSetting
{
    public $helper;
    public $productSetting;
    // $helper = new Helper();
    function __construct()
    {
        $this->helper = new Helper();
        $this->productSetting = new ProductSetting();
    }
    public function updateCustomFields()
    {
        $allProducts = Capsule::table("tblproducts")
            ->where("servertype", "soyoustart")
            ->orWhere("servertype", "soyoustart_vps")
            ->orWhere("servertype", "soyoustart_eco")
            ->get();
        foreach ($allProducts as $key => $value) {
            // if ($value->id != 9)
            //     continue;
            $customeFields = Capsule::table("tblcustomfields")->where(["relid" => $value->id, "type" => "product"])->get();
            foreach ($customeFields as $customeField) {
                if ($customeField->fieldname == "Server Location") {
                    $this->helper->insert_update("tblcustomfields", ["id" => $customeField->id], ["fieldtype" => "text", "fieldname" => "ovh_server_location|OVH Server Location", "description" => "OVH Server Location", "fieldoptions" => '']);
                } elseif ($customeField->fieldname == "servername") {
                    $this->helper->insert_update("tblcustomfields", ["id" => $customeField->id], ["fieldname" => "ovh_server_name|OVH Server Name", "description" => "OVH Server Name"]);
                } elseif ($customeField->fieldname == "Order Id") {
                    $this->helper->insert_update("tblcustomfields", ["id" => $customeField->id], ["fieldname" => "ovh_order_id|OVH Order Id", "description" => "OVH Order Id"]);
                } elseif ($customeField->fieldname == "Custom Hostname") {
                    $this->helper->insert_update("tblcustomfields", ["id" => $customeField->id], ["fieldname" => "ovh_custom_hostname|OVH Custom Hostname", "description" => "OVH Custom Hostname"]);
                } elseif ($customeField->fieldname == "Custom FTPBackup-name") {
                    $this->helper->insert_update("tblcustomfields", ["id" => $customeField->id], ["fieldname" => "ovh_ftp_custom_hostname|OVH FTP Custom Hostname", "description" => "OVH FTP Custom Hostname"]);
                } elseif ($customeField->fieldname == "Account-Number") {
                    $this->helper->insert_update("tblcustomfields", ["id" => $customeField->id], ["fieldtype" => "text", "fieldname" => "ovh_account|OVH Account Name", "description" => "OVH Account Name", "fieldoptions" => '']);
                }
            }
            /* creating remainiig custom fields */
            $this->productSetting->createCustomFields($value->id);
            /* updating configurable options */
            $productConfigOptions = Capsule::table("tblproductconfiglinks")
                ->join("tblproductconfiggroups", "tblproductconfiglinks.gid", "=", "tblproductconfiggroups.id")
                ->join("tblproductconfigoptions", "tblproductconfiggroups.id", "=", "tblproductconfigoptions.gid")
                ->where(["pid" => $value->id])
                ->select("tblproductconfigoptions.*")
                ->get();
            foreach ($productConfigOptions as $key => $productConfigOption) {
                if (!str_contains($productConfigOption->optionname, "|")) {
                    $optionname = strtolower(str_replace(" ", "_", $productConfigOption->optionname)) . "|" . $productConfigOption->optionname;
                    if ($productConfigOption->optionname == "Snapshot") {
                        $this->helper->insert_update("tblproductconfigoptions", ["id" => $productConfigOption->id], ["optionname" => $optionname, "optiontype" => 3]);
                    } else {
                        $this->helper->insert_update("tblproductconfigoptions", ["id" => $productConfigOption->id], ["optionname" => $optionname, "optiontype" => 1]);
                    }
                }
            }
            /* updating module config options for the vps server only  */
            if ($value->servertype == "soyoustart_vps" && $value->configoption1 != "VPS") {
                $productGroup = explode("-", $value->configoption2)[1];
                $ovhAccountData = explode('-', $value->configoption1);
                if (count($ovhAccountData) == 4)
                    unset($ovhAccountData[1]);
                $ovhAccountData = array_values($ovhAccountData);
                $ovhAccountData = str_replace(" ", "-", implode(" ", $ovhAccountData));
                $updatedata = ["slug" => $value->configoption2, "configoption1" => "VPS", "configoption2" => $productGroup . "@" . $value->configoption2, "configoption3" => $ovhAccountData, "configoption4" => $value->configoption5, "configoption5" => $value->configoption3, "configoption6" => "old_module"];
                Capsule::table('tblproducts')->where('id', $value->id)->update($updatedata);
            }
        }
    }
}
