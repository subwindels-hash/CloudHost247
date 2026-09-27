<?php

namespace WGSModule\Soyoustart\classes;

require_once __DIR__ . DS . '/ApiCall.php';

use WGSModule\Soyoustart\classes\ApiCall;
use WHMCS\Database\Capsule;

class ServerStatus extends ApiCall
{
    public function getAllServerPackages()
    {

        $result = Capsule::table("tblhosting")
            ->join("tblproducts", "tblhosting.packageid", "=", "tblproducts.id")
            ->join("tblclients", "tblclients.id", "=", "tblhosting.userid")
            ->select("tblhosting.id", "tblhosting.regdate", "tblhosting.nextinvoicedate", "tblhosting.packageid", "tblhosting.domainstatus", "tblproducts.servertype", "tblclients.firstname", "tblclients.id as clientid", "tblclients.lastname", "tblclients.email")
            ->whereIn("tblproducts.servertype", ['soyoustart_vps', 'soyoustart'])
            // ->where("tblhosting.domainstatus", "Active")
            ->get();

        foreach ($result as $key => $value) {

            $customVieldsValues = Capsule::table('tblcustomfields')
                ->leftJoin('tblcustomfieldsvalues', 'tblcustomfields.id', '=', 'tblcustomfieldsvalues.fieldid')
                ->select('tblcustomfields.fieldname', 'tblcustomfieldsvalues.value')->where('tblcustomfields.type', 'product')
                ->where('tblcustomfields.type', 'product')->where('tblcustomfieldsvalues.relid', $value->id)
                // ->where("tblcustomfields.fieldname", "like", "%ovh_server_name|%")
                ->get();

            foreach ($customVieldsValues as $customVieldsValue) {
                $name = explode("|", $customVieldsValue->fieldname)[0];
                $result[$key]->$name = $customVieldsValue->value;
            } 

            $accountInfo =  $this->get_data("mod_soyoustart", ["account_number" => $value->ovh_account, "location" => $value->ovh_server_location], "first");
            $result[$key]->accountInfo = $accountInfo;
        }

        return $result;
    }

    public function allPackages()
    {
        $allServerPackages = $this->getAllServerPackages();
      
        foreach ($allServerPackages as $key => $serverPackage) {
            $location = $serverPackage->ovh_server_location;
            $serverType = $serverPackage->servertype;
            $ovhServerName = $serverPackage->ovh_server_name;
            $accountId = $serverPackage->accountInfo->id;
        
            if(empty($ovhServerName)){
                $allServerPackages[$key]->error ="SERVER HAS NOT BEEN ASSIGNED YET!";
                continue;
            }
            $serverInfo = $this->getServerInfo($location, $serverType, $ovhServerName, $accountId);

            if ($serverInfo["httpcode"] != 200) {
                $allServerPackages[$key]->error = $serverInfo["result"]->message;
                continue;
            }
            $allServerPackages[$key]->serverInfo = $serverInfo["result"];
        }
        return $allServerPackages;
    }
}
