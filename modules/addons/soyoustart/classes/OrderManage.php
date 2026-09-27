<?php

namespace WGSModule\Soyoustart\classes;

require_once __DIR__ . DS . '/ApiCall.php';

use WGSModule\Soyoustart\classes\ApiCall;
use WHMCS\Database\Capsule;

class OrderManage extends ApiCall
{
    public function getAllOrders()
    {
        $allServerPackages = $this->orders();

        return $allServerPackages;
        // foreach ($allServerPackages as $key => $serverPackage) {
        //     $location = $serverPackage->ovh_server_location;
        //     $serverType = $serverPackage->servertype;
        //     $ovhServerName = $serverPackage->ovh_server_name;
        //     $accountId = $serverPackage->accountInfo->id;

        //     $serverInfo = $this->getServerInfo($location, $serverType, $ovhServerName, $accountId);
        //     if ($serverInfo["httpcode"] != 200) {
        //         $allServerPackages[$key]->error = $serverInfo["result"]->message;
        //         continue;
        //     }
        //     $allServerPackages[$key]->serverInfo = $serverInfo["result"];
        // }
        // return $allServerPackages;
    }

    public function orders(){

        try {
            $result = Capsule::table("tblhosting")
            ->join("tblproducts", "tblhosting.packageid", "=", "tblproducts.id")
            ->join("tblclients", "tblclients.id", "=", "tblhosting.userid")
            ->select("tblhosting.id", "tblhosting.regdate","tblhosting.orderid", "tblhosting.nextinvoicedate", "tblhosting.packageid", "tblhosting.domainstatus", "tblproducts.servertype", "tblproducts.name as productName", "tblproducts.id as productId", "tblclients.firstname", "tblclients.id as clientid", "tblclients.lastname", "tblclients.email")
            ->whereIn("tblproducts.servertype", ['soyoustart_vps', 'soyoustart'])
            ->get();

            foreach ($result as $key => $value) {

                $customVieldsValues = Capsule::table('tblcustomfields')
                    ->join('tblcustomfieldsvalues', 'tblcustomfields.id', '=', 'tblcustomfieldsvalues.fieldid')
                    ->select('tblcustomfields.fieldname', 'tblcustomfieldsvalues.value')->where('tblcustomfields.type', 'product')
                    ->where('tblcustomfields.type', 'product')->where('tblcustomfieldsvalues.relid', $value->id)
                    // ->where("tblcustomfields.fieldname", "like", "%ovh_server_name|%")
                    ->get();
    
                foreach ($customVieldsValues as $customVieldsValue) {
                    $name = explode("|", $customVieldsValue->fieldname)[0];
                    $result[$key]->$name = $customVieldsValue->value;
                }
            }

            return $result;

        } catch (\Exception $e) {
            //throw $th;
        }

    }

    
}