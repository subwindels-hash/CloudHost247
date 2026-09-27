<?php

namespace WGSModule\Soyoustart\classes;

require_once __DIR__ . '/ApiCall.php';
require_once __DIR__ . '/Configuration.php';

use WGSModule\Soyoustart\classes\ApiCall;
use WHMCS\Database\Capsule;
use WHMCS\Module\Addon\Soyoustart\Helper;

class ProductSetting extends ApiCall
{
    public $helper, $apiCall, $configuration;
    function __construct()
    {
        $this->helper = new Helper();
        $this->apiCall = new ApiCall();
        $this->configuration = new Configuration();
    }
    /* get all account lists */
    public function getAccountName()
    {
        try {
            $accuntNames = [];
            foreach ($this->helper->get_data("mod_soyoustart") as $key => $value) {
                $accuntNames[] = $value->id . "-" . ucfirst($value->location) . "-" . $value->account_number;
            }
            return $accuntNames;
        } catch (\Exception $e) {
            //throw $th;
            return $e->getMessage();
        }
    }
    public function getAllProducts()
    {
        try {
            $products = [];
            $productdetail = Capsule::table("tblproducts")
                ->join("mod_soyoustart_products", "tblproducts.id", "=", "mod_soyoustart_products.productid")
                ->where("tblproducts.hidden", "0")
                ->where("tblproducts.servertype", "soyoustart")
                ->orWhere("tblproducts.servertype", "soyoustart_vps")
                ->orWhere("tblproducts.servertype", "soyoustart_eco")
                ->select("tblproducts.*", "mod_soyoustart_products.pricesync as pricesync")
                ->get();
            foreach ($productdetail as $product) {
                $products[$product->gid][] = $product;
            }
            $productGroup = [];
            foreach ($products as $key => $detail) {
                $groupName = $this->helper->get_data("tblproductgroups", ["id" => $key, "hidden" => "0"], "first");
                $productGroup[$groupName->name] = $detail;
            }
            return $productGroup;
        } catch (\Exception $e) {
            //throw $th;
        }
    }
    public function getSubsidiaryType($data, $partneltype = "")
    {
        $locationname = $data['account'];
        $locationexplode = explode("-", $locationname);
        $string = "Ovh";
        $option = '';
        if ($string == 'Ovh' && $data['moduletype'] == "Dedicated") {
            if ($partneltype) {
                $option = '
                    <option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=CA">Canada(CA)(CAD)</option>
                    <option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=WE">Canada(WE)(USD)</option>
					<option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=ASIA">ASIA(USD)</option>
					<option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=AU">Austriala(AU)(AUD)</option>
					<option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=SG">Singapore(SG)(SGD)</option>
					<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=CZ">Czechia(CZ)</option>
					<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=DE">Germany(DE)</option>
					<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=ES">Spain(ES)</option>
					<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=EU">Europe(EU)</option>
					<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=FI">Finland(FI)</option>
					<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=FR">France(FR)</option>
					<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=GB">United Kingdom(GB)</option>
					<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=IE">Ireland(IE)</option>
					<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=IT">Italy(IT)</option>
					<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=LT">Lithuania(LT)</option>
					<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=MA">Morocco(MA)</option>
					<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=NL">Netherlands(NL)</option>
					<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=PL">Poland(PL)</option>
					<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=PT">Portugal(PT)</option>
					<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=SN">Senegal(SN)</option>
					<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=TN">Tunisia(TN)</option>';
            } elseif (trim($locationexplode[1]) == 'Canada' || trim($locationexplode[1]) == 'Singapore') {
                $option = '
                        <option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=CA">Canada(CA)(CAD)</option>
                        <option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=WE">Canada(WE)(USD)</option>
						<option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=ASIA">ASIA(USD)</option>
						<option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=AU">Austriala(AU)(AUD)</option>
						<option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=SG">Singapore(SG)(SGD)</option>';
            } elseif (trim($locationexplode[1]) == 'Us') {
                $option = '<option value="https://us.ovhcloud.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=US">United States(US)</option>';
            } else {
                $option = '<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=CZ">Czechia(CZ)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=DE">Germany(DE)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=ES">Spain(ES)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=EU">Europe(EU)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=FI">Finland(FI)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=FR">France(FR)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=GB">United Kingdom(GB)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=IE">Ireland(IE)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=IT">Italy(IT)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=LT">Lithuania(LT)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=MA">Morocco(MA)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=NL">Netherlands(NL)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=PL">Poland(PL)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=PT">Portugal(PT)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=SN">Senegal(SN)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/baremetalServers?ovhSubsidiary=TN">Tunisia(TN)</option>';
            }
        } else if ($string == 'Ovh' && $data['moduletype'] == "VPS") {
            if ($partneltype) {
                $option = '
                        <option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=CA">Canada(CA)(CAD)</option>
                        <option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=WE">Canada(WE)(USD)</option>
						<option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=ASIA">ASIA(USD)</option>
						<option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=AU">Austriala(AU)(AUD)</option>
						<option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=SG">Singapore(SG)(SGD)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=CZ">Czechia(CZ)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=DE">Germany(DE)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=ES">Spain(ES)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=EU">Europe(EU)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=FI">Finland(FI)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=FR">France(FR)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=GB">United Kingdom(GB)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=IE">Ireland(IE)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=IT">Italy(IT)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=LT">Lithuania(LT)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=MA">Morocco(MA)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=NL">Netherlands(NL)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=PL">Poland(PL)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=PT">Portugal(PT)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=SN">Senegal(SN)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=TN">Tunisia(TN)</option>';
            } elseif (trim($locationexplode[1]) == 'Canada') {
                $option = '
                        <option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=CA">Canada(CA)(CAD)</option>
                        <option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=WE">Canada(WE)(USD)</option>
						<option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=ASIA">ASIA(USD)</option>
						<option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=AU">Austriala(AU)(AUD)</option>
						<option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=SG">Singapore(SG)(SGD)</option>';
            } elseif (trim($locationexplode[1]) == 'Us') {
                $option = '<option value="https://us.ovhcloud.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=US">United States(US)</option>';
            } else {
                $option = '<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=CZ">Czechia(CZ)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=DE">Germany(DE)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=ES">Spain(ES)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=EU">Europe(EU)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=FI">Finland(FI)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=FR">France(FR)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=GB">United Kingdom(GB)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=IE">Ireland(IE)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=IT">Italy(IT)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=LT">Lithuania(LT)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=MA">Morocco(MA)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=NL">Netherlands(NL)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=PL">Poland(PL)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=PT">Portugal(PT)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=SN">Senegal(SN)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/vps?ovhSubsidiary=TN">Tunisia(TN)</option>';
            }
        } elseif ($string == 'Ovh' && $data['moduletype'] == "ECO") {
            if ($partneltype) {
                $option = '
                        <option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=CA">Canada(CA)(CAD)</option>
                        <option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=WE">Canada(WE)(USD)</option>
						<option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=ASIA">ASIA(USD)</option>
						<option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=AU">Austriala(AU)(AUD)</option>
						<option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=SG">Singapore(SG)(SGD)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=CZ">Czechia(CZ)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=DE">Germany(DE)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=ES">Spain(ES)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=EU">Europe(EU)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=FI">Finland(FI)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=FR">France(FR)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=GB">United Kingdom(GB)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=IE">Ireland(IE)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=IT">Italy(IT)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=LT">Lithuania(LT)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=MA">Morocco(MA)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=NL">Netherlands(NL)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=PL">Poland(PL)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=PT">Portugal(PT)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=SN">Senegal(SN)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=TN">Tunisia(TN)</option>';
            } elseif (trim($locationexplode[1]) == 'Us') {
                $option = '<option value="https://us.ovhcloud.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=US">United States(US)</option>';
            } elseif (trim($locationexplode[1]) == 'Canada') {
                $option = '
                        <option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=CA">Canada(CA)(CAD)</option>
                        <option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=WE">Canada(WE)(USD)</option>
						<option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=ASIA">ASIA(USD)</option>
						<option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=AU">Austriala(AU)(AUD)</option>
						<option value="https://ca.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=SG">Singapore(SG)(SGD)</option>';
            } else {
                $option = '<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=CZ">Czechia(CZ)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=DE">Germany(DE)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=ES">Spain(ES)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=EU">Europe(EU)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=FI">Finland(FI)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=FR">France(FR)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=GB">United Kingdom(GB)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=IE">Ireland(IE)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=IT">Italy(IT)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=LT">Lithuania(LT)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=MA">Morocco(MA)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=NL">Netherlands(NL)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=PL">Poland(PL)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=PT">Portugal(PT)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=SN">Senegal(SN)</option>
						<option value="https://www.ovh.com/engine/apiv6/order/catalog/public/eco?ovhSubsidiary=TN">Tunisia(TN)</option>';
            }
        } else {
            $option = '<option value="">Record Not Found</option>';
        }
        return $option;
    }
    public function createProductGroups($name, $slug)
    {
        $name = ucwords($name);
        $slug = ucwords($slug);
        try {
            $productGroupId = \WHMCS\Product\Group::where("name", $name)->value("id");
            if (empty($productGroupId)) {
                $productGroupId = \WHMCS\Product\Group::insertGetId(array("name" => $name, "slug" => $slug));
            }
            return $productGroupId;
        } catch (\Exception $e) {
            return $e->getMessage();
        }
    }
    public function formateProductData($url, $producttype, $productGroup, $configuration)
    {
        $products = $this->apiCall->getApiProducts($url);
        $currency = $products["result"]->locale->currencyCode;
        $groupName = $configuration->ovhProductGroup($productGroup);
        $productarray = [];
        foreach ($products["result"]->plans as $product) {
            if (strtolower($producttype) == "scale") {
                if ($this->getStringsContainingGroupName($product->planCode, "scale")) {
                    $productarray['products'][] = $product;
                }
            } elseif (strtolower($producttype) == "game") {
                if ($product->blobs->commercial->features[0]->value == "gaming") {
                    $productarray['products'][] = $product;
                }
            } elseif (strtolower($producttype) == "fs") {
                if ($product->blobs->commercial->features[0]->value == "archive-backup-recovery" || strtolower($product->blobs->commercial->range) == strtolower($producttype)) {
                    $productarray['products'][] = $product;
                }
            } elseif (strtolower($producttype) == "rise" || strtolower($producttype) == "advance" && $this->helper->getStringsContainingGroupName($product->planCode, $producttype)) {
                $productarray['products'][] = $product;
            } elseif (strtolower($producttype) == "kimsufi" && $this->helper->getStringsContainingGroupName($product->planCode, "sk")) {
                $productarray['products'][] = $product;
            } elseif (strtolower($producttype) == "soyoustart" && $this->helper->getStringsContainingGroupName($product->invoiceName, $producttype)) {
                $productarray['products'][] = $product;
            } elseif (strtolower($product->blobs->commercial->range) == strtolower($producttype)) {
                $productarray['products'][] = $product;
            } elseif ($producttype == "other" && !array_key_exists(strtolower($product->blobs->commercial->range), $groupName)  && !empty($product->blobs->commercial->range)) {
                $productarray['products'][] = $product;
            }
        }
        $productarray['currency'] = $currency;
        $productarray['addons'] = $products["result"]->addons;
        $productarray['productsProcessor'] = $products["result"]->products;
        return $productarray;
    }
    public function productDesc($productsFromApi, $prodetail, $productplancode)
    {
        $description = '';
        $contains = array();
        $containbandwidth = '';
        $vrackcontain = '';
        $memorycontain = '';
        /* product description .  */
        foreach ($prodetail->addonFamilies as $addonFamilies) {
            if ($addonFamilies->name == "storage") {
                foreach ($addonFamilies->addons as $addons) {
                    /* addons */
                    if (strpos($addons, "nvme")) {
                        if (@!in_array("NVMe", $contains)) {
                            $contains[] = "NVMe";
                        }
                    } elseif (strpos($addons, "sas")) {
                        if (@!in_array("SAS", $contains)) {
                            $contains[] = "SAS";
                        }
                    } elseif (strpos($addons, "sa")) {
                        if (@!in_array("SATA", $contains)) {
                            $contains[] = "SATA";
                        }
                    }
                }
            } elseif ($addonFamilies->name == "bandwidth") {
                $bandwidth = explode("-", $addonFamilies->default);
                $containbandwidth = $bandwidth[1];
            } elseif ($addonFamilies->name == "vrack") {
                $vrack = explode("-", $addonFamilies->default);
                $vrackcontain = $vrack[2];
            } elseif ($addonFamilies->name == "memory") {
                $memory = explode("-", $addonFamilies->default);
                $memorycontain = $memory[1];
            }
        }
        foreach ($productsFromApi["products"] as $productsdesc) {
            if ($productsdesc->planCode == $productplancode) {
                $desc = "Processor: " . $productsdesc->description;
                $desc1 = "Storage: " . implode(",", $contains);
                if ($containbandwidth == "1000") {
                    $desc2 = "Public bandwidth: Starting at 1 Gbps";
                } elseif ($containbandwidth == "2000") {
                    $desc2 = "Public bandwidth: Starting at 2 Gbps";
                } else {
                    $desc2 = "Public bandwidth: Starting at " . $containbandwidth . " Mbps";
                }
                if ($vrackcontain == "1000") {
                    $desc3 = "Private bandwidth: Starting at 1 Gbps";
                } elseif ($vrackcontain == "2000") {
                    $desc3 = "Private bandwidth: Starting at 2 Gbps";
                } elseif (empty($vrackcontain)) {
                    $desc3 = "Private bandwidth: --";
                } else {
                    $desc3 = "Private bandwidth: Starting at " . $vrackcontain . " Mbps";
                }
                $desc4 = "Memory: Starting at " . $memorycontain;
                $description = mysql_real_escape_string("<ul class='list'><li>" . $desc . "</li><li>" . $desc1 . " available</li><li>" . $desc2 . "</li><li>" . $desc3 . "</li><li>" . $desc4 . "</li><li>DDoS Protection</li><li>Unlimited Traffic</li></ul>");
            }
        }
        return $description;
    }
    // public function soyouStartPriceUpdation($prodetail, $addpercentage, $setupPercentage)
    // {
    //     $pricingArray = [];
    //     foreach ($prodetail as $price) {
    //         if ($price->commitment == 0 && $price->mode == "default" && $price->capacities[0] == "installation") {
    //             $setupfees = ((($price->price) / 100000000) + (($price->tax) / 100000000));
    //             $setupfees = $setupfees + (($setupfees * $setupPercentage) / 100);
    //         } elseif ($price->commitment == 0 && $price->mode == "default" && $price->capacities[0] == "renew") {
    //             $monthlyPr = ((($price->price) / 100000000) + (($price->tax) / 100000000));
    //             if ($monthlyPr == '' || $monthlyPr == '0.00') {
    //                 $monthlyPr = 0;
    //             }
    //             if ($monthlyPr > 0) {
    //                 $monthlyPr = $monthlyPr + (($monthlyPr * $addpercentage) / 100);
    //             }
    //         } elseif ($price->commitment == 12 && $price->interval == 1) {
    //             $annuallyPr = ((($price->price) / 100000000) + (($price->tax) / 100000000));
    //             if ($annuallyPr == '' || $annuallyPr == '0.00') {
    //                 $annuallyPr = 0;
    //             }
    //             if ($annuallyPr > 0) {
    //                 $annuallyPr = ($annuallyPr + (($annuallyPr * $addpercentage) / 100));
    //             }
    //         } elseif ($price->commitment == 24 && $price->interval == 1) {
    //             $bienniallyPr = ((($price->price) / 100000000) + (($price->tax) / 100000000));
    //             if ($bienniallyPr == '' || $bienniallyPr == '0.00') {
    //                 $bienniallyPr = 0;
    //             }
    //             if ($bienniallyPr > 0) {
    //                 $bienniallyPr = ($bienniallyPr + (($bienniallyPr * $addpercentage) / 100));
    //             }
    //         }
    //     }
    //     $pricingArray['setupfees'] = $setupfees;
    //     $pricingArray['monthly'] = $monthlyPr;
    //     $pricingArray['annually'] = $annuallyPr *12;
    //     $pricingArray['bianually'] = $bienniallyPr *24;
    //     // logModuleCall("soyoustart", "calculate prices", $prodetail, $pricingArray);
    //     return $pricingArray;
    // }


    public function soyouStartPriceUpdation($prodetail, $addpercentage, $setupPercentage)
    {
        $pricingArray = [];

        $setupfees = 0;
        $monthlyPr = 0;
        $annuallyPr = 0;
        $bienniallyPr = 0;

        foreach ($prodetail as $price) {
            $basePrice = (($price->price ?? 0) / 100000000) + (($price->tax ?? 0) / 100000000);
           /* Calculate promotional discount */
            $discount = 0;
            if (!empty($price->promotions)) {
                foreach ($price->promotions as $promotion) {
                    $discount += (($promotion->discount->value ?? 0) / 100000000);
                    $discount += (($promotion->discount->tax ?? 0) / 100000000);
                }
            }
           /* Final price after promotion */
            $finalPrice = max(0, $basePrice - $discount);
            if ($price->commitment == 0 && $price->mode == "default" && in_array("installation", $price->capacities)) {
                $setupfees = $finalPrice;
                $setupfees += ($setupfees * $setupPercentage) / 100;
            } elseif ($price->commitment == 0 && $price->mode == "default" && in_array("renew", $price->capacities)) {
                $monthlyPr = $finalPrice;
                if ($monthlyPr > 0) {
                    $monthlyPr += ($monthlyPr * $addpercentage) / 100;
                }
            } elseif ($price->commitment == 12 && $price->interval == 1) {
                $annuallyPr = $finalPrice;
                if ($annuallyPr > 0) {
                    $annuallyPr += ($annuallyPr * $addpercentage) / 100;
                }
            } elseif ($price->commitment == 24 && $price->interval == 1) {
                $bienniallyPr = $finalPrice;
                if ($bienniallyPr > 0) {
                    $bienniallyPr += ($bienniallyPr * $addpercentage) / 100;
                }
            }
        }

        $pricingArray['setupfees'] = round($setupfees, 2);
        $pricingArray['monthly'] = round($monthlyPr, 2);
        $pricingArray['annually'] = round($annuallyPr * 12, 2);
        $pricingArray['bianually'] = round($bienniallyPr * 24, 2);

        return $pricingArray;
    }
    public function updateprice($productCurrency, $relid, $type, $productPrices = [], $exchangeRates = [])
    {
        $currencies = $this->helper->get_data("tblcurrencies");
        // $defaultEuroExchangeRates = $this->helper->getWhmcsConversionRate();
        if (!isset($currencies[0])) {
            throw new \Exception('Error: Please enable atleat one currency!.');
        }
        foreach ($currencies as $key => $currency) {
            $rate = isset($exchangeRates[$currency->code]) ? $exchangeRates[$currency->code] : 1;
            $monthly = ($productPrices["monthly"] == 0 ? 0 : number_format($productPrices["monthly"] * $rate, 2, ".", ""));
            $annually =  ($productPrices["annually"] == 0 ? 0 : number_format($productPrices["annually"] * $rate, 2, ".", ""));
            $bianually =  ($productPrices["bianually"] == 0 ? 0 : number_format($productPrices["bianually"] * $rate, 2, ".", ""));
            $setupfees =  ($productPrices["setupfees"] == 0 ? 0 : number_format($productPrices["setupfees"] * $rate, 2, ".", ""));
            if ($type != "configoptions") {
                $monthly = ($monthly == 0 || $monthly == "0.00" ? "-1.00" : $monthly);
                $annually = ($annually == 0 || $annually == "0.00" ? "-1.00" : $annually);
                $bianually = ($bianually == 0 || $bianually == "0.00" ? "-1.00" : $bianually);
                $setupfees = ($setupfees == 0 ? "0.00" : $setupfees);
            }
            $select = $this->helper->get_data("tblpricing", ["type" => $type, "relid" => $relid, 'currency' => $currency->id], "first");
            if (empty($select) && !isset($select->id)) {
                Capsule::table('tblpricing')->insertGetId(array('type' => $type, 'relid' => $relid, 'msetupfee' => $setupfees, 'monthly' => $monthly, 'quarterly' => '-1.00', 'semiannually' => '-1.00', 'annually' => $annually, 'biennially' => $bianually, 'currency' => $currency->id, "triennially" => "-1.00"));
            } else {
                Capsule::table('tblpricing')->where("type", $type)->where("relid", $relid)->where('currency', $currency->id)->update(['msetupfee' => $setupfees, 'monthly' => $monthly, 'quarterly' => '-1.00', 'semiannually' => '-1.00', 'annually' => $annually, 'biennially' => $bianually, "triennially" => "-1.00"]);
            }
        }
        return "success";
    }
    public function assignOsLicenseConfigGroup($getdedicatedgroupid, $createnewproductid)
    {
        try {
            $getexistlink = $this->helper->get_data("tblproductconfiglinks", ["gid" => $getdedicatedgroupid->id, "pid" => $createnewproductid], "first");
            if (is_null($getexistlink)) {
                Capsule::table('tblproductconfiglinks')->insertGetId(array('gid' => $getdedicatedgroupid->id, 'pid' => $createnewproductid));
            }
        } catch (\Exception $e) {
            //throw $e;
        }
    }
    public function createServerLocConfig($productsDatacenters, $optionId, $productCurrency, $defaultEuroExchangeRates)
    {
        try {
            $sortedDatacenters = $this->shortDatacenters($productsDatacenters);
            foreach ($sortedDatacenters as $key => $configDatacenterVal) {
                $configDatacenterName = $key . '|' . $configDatacenterVal;
                $chkSubOption = Capsule::table("tblproductconfigoptionssub")->where("configid", $optionId)->where("optionname", 'LIKE', "%" . "$configDatacenterVal" . "%")->first();
                $subOptionId = $chkSubOption->id;
                if (empty($chkSubOption)) {
                    $subOptionId = Capsule::table('tblproductconfigoptionssub')->insertGetId(array('configid' => $optionId, 'optionname' => $configDatacenterName));
                    $priceUpdationVarProducts = ['monthly' => 0, 'annually' => 0, 'bianually' => 0, 'setupfees' => 0];
                    $updateproductprice = $this->updateprice($productCurrency, $subOptionId, 'configoptions', $priceUpdationVarProducts, $defaultEuroExchangeRates);
                } else {
                    $priceUpdationVarProducts = ['monthly' => 0, 'annually' => 0, 'bianually' => 0, 'setupfees' => 0];
                    $updateproductprice = $this->updateprice($productCurrency, $subOptionId, 'configoptions', $priceUpdationVarProducts, $defaultEuroExchangeRates);
                }
            }
        } catch (\Exception $th) {
            //throw $th;
        }
    }
    public function createAddonConfigOptions($productDetails, $productAddons, $productMargin, $groupID, $productCurrency, $defaultEuroExchangeRates)
    {
        try {
            foreach ($productDetails->addonFamilies as $key => $product) {
                $order = (3 + ($key + 1));
                $optionname = $product->name;
                // if($optionname =="system-storage")
                //     continue;
                if ($optionname == "bandwidth") {
                    $optionname = "Public Network";
                }
                if ($optionname == "vrack") {
                    $optionname = "Private Network";
                }
                $addonArray = $product->addons;
                $sortAddon = $this->helper->ProductAddonSort($addonArray);
                // Handle application-license and distribution-license separately
                if ($optionname == "application-license") {
                    $optionname = "application_license|Application License";
                    $optionId = $this->helper->config_group_option($groupID, $optionname, "1", "0", 0, $order);
                } elseif ($optionname == "distribution-license") {
                    $optionname = "distribution_license|Distribution License";
                    $optionId = $this->helper->config_group_option($groupID, $optionname, "1", "0", 0, $order);
                } elseif (!in_array($optionname, ["application-license", "distribution-license"])) {
                    if ($optionname == "system-storage")
                        $optionname = strtolower(str_replace("-", "_", $optionname)) . "|" . ucwords($optionname);
                    else
                        $optionname = strtolower(str_replace(" ", "_", $optionname)) . "|" . ucwords($optionname);
                    $optionId = $this->helper->config_group_option($groupID, $optionname, "1", "0", 0, $order);
                }
                $none = false;
                // if ($optionname == 'storage' || $optionname == 'memory') {
                $zeroPriceOptions = [];
                $nonZeroPriceOptions = [];
                foreach ($sortAddon as $value) {
                    // Add "None" option for application-license and distribution-license
                    if (in_array($product->name, ["application-license", "distribution-license"])) {
                        if (!$none) {
                            $optionName = "none|None";
                            $subOptionId = $this->helper->config_group_sub_option($optionId, $optionName, [], 0, 0, $productCurrency, $defaultEuroExchangeRates, $addonArray);
                            $none = true;
                        }
                    }
                    $optionName = $value;
                    $priceDetails = $this->getAddonConfigPriceWithMargin($productAddons, $optionName, $productMargin, $product->name);
                    $modifiedOptionName = $optionName . "|" . ucfirst($priceDetails["addondetail"]->invoiceName);
                    if ($priceDetails["formatedPrices"]["monthly"] == "0" && $priceDetails["formatedPrices"]["annually"] == "0") {
                        $modifiedOptionName .= " (Included)";
                        $zeroPriceOptions[$optionName] = $modifiedOptionName;
                    } else {
                        $nonZeroPriceOptions[$optionName] = $modifiedOptionName;
                    }
                    $options = array_merge($zeroPriceOptions, $nonZeroPriceOptions);
                }
                foreach ($options as $optionName => $optionNam) {
                    $priceDetails = $this->getAddonConfigPriceWithMargin($productAddons, $optionName, $productMargin, $product->name);
                    $subOptionId = $this->helper->config_group_sub_option($optionId, $optionNam, $priceDetails["formatedPrices"], 0, 0, $productCurrency, $defaultEuroExchangeRates, $addonArray);
                }
            }
        } catch (\Exception $e) {
            throw new \Exception('Error while creating/updating Configuration Options for Dedicated product: ' . $e->getMessage());
        }
    }
    public function getAddonConfigPriceWithMargin($productAddons, $addonName, $productMargin, $opntionName = null)
    {
        try {
            $price = [];
            foreach ($productAddons as $addondetail) {
                if ($addondetail->planCode == $addonName) {
                    $price = $addondetail;
                }
            }
            /* needs to add margin here ----------------------------------------------------*/
            $setupFess = !isset($productMargin->setupprice) ? 0 : $productMargin->setupprice;
            $configPercentage = 0;
            if ($opntionName == "snapshot") {
                $configPercentage = $productMargin->snapshotprice;
            } elseif ($opntionName == "additionalDisk") {
                $configPercentage = $productMargin->additionaldiskprice;
            } elseif ($opntionName == "ftpbackup") {
                $configPercentage = $productMargin->backupspaceprice;
            } elseif ($opntionName == "cpanel") {
                $configPercentage = $productMargin->cpanelsoftprice;
            } elseif ($opntionName == "application-license") {
                $configPercentage = $productMargin->cpanelsoftprice;
            } elseif ($opntionName == "distribution-license") {
                $configPercentage = $productMargin->cpanelsoftprice;
            } elseif ($opntionName == "automatedBackup") {
                $configPercentage = $productMargin->autobackupprice;
            } elseif ($opntionName == "plesk") {
                $configPercentage = $productMargin->pleskprice;
            } elseif ($opntionName == "vrack") {
                $configPercentage = $productMargin->privateetworkprice;
            } elseif ($opntionName == "bandwidth") {
                $configPercentage = $productMargin->publicnetworkprice;
            } elseif ($opntionName == "os") {
                $configPercentage = $productMargin->imageprice;
            }
            $formatedPrices = $this->soyouStartPriceUpdation($price->pricings, $configPercentage, $setupFess);
            return ["addondetail" => $price, "formatedPrices" => $formatedPrices];
        } catch (\Exception $e) {
            //throw $th;
        }
    }
    public function createAditinalIpConfigOptions($configOptionsData, $productMargin, $groupID, $productCurrency, $exchangeRates)
    {
        try {
            $optionName = $configOptionsData["friendlyName"];
            $optionId = $this->helper->config_group_option($groupID, $optionName, "1", 0, 0, 10);
            foreach ($configOptionsData["optionvalue"] as $key => $value) {
                $optionName = $value;
                $priceDetails = $this->getAditionalIpConfigPriceWithMargin($productMargin, $configOptionsData["price"], $value);
                $optionName = $key . "|" . ucfirst($optionName);
                $subOptionId = $this->helper->config_group_sub_option($optionId, $optionName, $priceDetails, 0, 0, $productCurrency, $exchangeRates);
            }
        } catch (\Exception $e) {
            throw new \Exception('Error while creating/updating prices additional ip Configuration Options for VPS product: ' . $e->getMessage());
            die("dddd");
        }
    }
    public function getAditionalIpConfigPriceWithMargin($productMargin, $price, $quentity)
    {
        try {
            $pricingArray = [];
            $pricingArray['monthly'] = (float) ($price["monthly"] + (($price["monthly"] * $productMargin->storageprice) / 100)) * (float) $quentity;
            $pricingArray['annually'] = (float) ($price["annually"] + (($price["annually"] * $productMargin->storageprice) / 100)) * (float) $quentity;
            $pricingArray['bianually'] = (float) ($price["biennially"] + (($price["biennially"] * $productMargin->storageprice) / 100)) * (float) $quentity;
            return $pricingArray;
        } catch (\Exception $e) {
            //throw $e;
        }
    }
    /* creating product addonFamilies configurable options for vps products */
    public function createAddonFamiliesConfigOptions($productDetails, $productAddons, $productMargin, $groupID, $productCurrency, $defaultEuroExchangeRates)
    {
        try {
            foreach ($productDetails->addonFamilies as $product) {
                $optionname = $product->name;
                $sortAddon = $product->addons;
                if ($optionname == "additionalDisk") {
                    $order = 5;
                    $sortAddon = $product->addons;
                    usort($sortAddon, function ($a, $b) {
                        preg_match('/(\d+)g$/', $a, $matchesA);
                        preg_match('/(\d+)g$/', $b, $matchesB);
                        return $matchesA[1] - $matchesB[1];
                    });
                    $optionname = "additional_disk|Additional Disk";
                }
                if ($optionname == "automatedBackup") {
                    $optionname =  $product->name . "|" ."Automated Backup";
                    $order = 7;
                }
                if ($optionname == "snapshot") {
                    $optionname = "Snapshot";
                    $order = 6;
                }
                if ($product->name == "ftpbackup") {
                    $optionname = "FTP Backup";
                    $order = 8;
                    continue;
                }
                if ($product->name == "os") {
                    $order = 2;
                    $optionname = "os_family|OS Family";
                }
                if ($product->name == "cpanel" || $product->name == "plesk") {
                    $addonArray = $product->addons;
                    $sortAddon = $this->helper->ProductAddonSort($addonArray);
                    $order = 4;
                    $optionname = "control_panel|Control Panel";
                }
                if ($product->name == "snapshot" || $product->name == "ftpbackup") {
                    $optionname = $product->name . "|" . $optionname;
                    $optionId = $this->helper->config_group_option($groupID, $optionname, "3", 0, 0, $order);
                } else {
           
                    $optionId = $this->helper->config_group_option($groupID, $optionname, "1", 0, 0, $order);
                }
                foreach ($sortAddon as $value) {
                    $optionName = $value;
                    $priceDetails = $this->getAddonConfigPriceWithMargin($productAddons, $optionName, $productMargin, $product->name);

                    $additionalDisk = 0;
                    $os = 0;
                    $plesk = 0;
                    $cpanel = 0;
                    if ($product->name == "additionalDisk") {
                        $additionalDisk = $additionalDisk + 1;
                        $optionName = preg_replace('/g$/', '', end(explode("-", $value))) . " GB";
                    } elseif ($product->name == "automatedBackup") {
                        $optionName = preg_replace('/g$/', '', $priceDetails["addondetail"]->invoiceName);
                        $optionName = preg_replace('/Option/', '', $optionName);
                        $optionName = preg_replace('/-/', ' ', $optionName);
                    } elseif ($product->name == "snapshot") {
                        $optionName = preg_replace('/g$/', '', $priceDetails["addondetail"]->invoiceName);
                        $optionName = preg_replace('/Option/', '', $optionName);
                        $optionName = preg_replace('/-/', ' ', $optionName);
                    } elseif ($product->name == "cpanel" || $product->name == "plesk") {
                        $cpanel = $cpanel + 1;
                        $optionName = preg_replace('/Option/', '', ucfirst($priceDetails["addondetail"]->invoiceName));
                    } elseif ($product->name == "os") {
                        $os = $os + 1;
                        if (str_contains($value, "windows")) {
                            $_SESSION["window_os_price"] = $priceDetails["formatedPrices"];
                        }
                        $priceDetails["formatedPrices"] = ["setupfees" => 0, "monthly" => 0, "annually" => 0, "bianually" => 0];
                        $optionName = preg_replace('/Option/', '', ucfirst($priceDetails["addondetail"]->invoiceName));
                    }
                    if ($additionalDisk == 1 || $os == 1 || $cpanel == 1) {
                        $subOptionId = $this->helper->config_group_sub_option($optionId, "none|None", [], 0, 0, $productCurrency, $defaultEuroExchangeRates);
                    }
                    $optionName = preg_replace('/-/', '_', $value) . "|" . ucfirst($optionName);
                    $subOptionId = $this->helper->config_group_sub_option($optionId, $optionName, $priceDetails["formatedPrices"], 0, 0, $productCurrency, $defaultEuroExchangeRates);
                }
            }
        } catch (\Exception $e) {
            throw new \Exception('Error while creating Addon Families Config Options for VPS product: ' . $e->getMessage());
        }
    }
    // /* creating product configuration configurable options for vps products */
    public function createVpsConfigOptions($productDetails, $productAddons, $productMargin, $groupID, $productCurrency, $defaultEuroExchangeRates)
    {
        try {
            $none = 0;
            foreach ($productDetails->configurations as $configuration) {
                if ($configuration->name != "vps_os") {
                    continue;
                }
                $optionId = $this->helper->config_group_option($groupID, "os_version|OS Version", "1", 0, 0, 3);
                $none = $none + 1;
                if ($none == 1)
                    $subOptionId = $this->helper->config_group_sub_option($optionId, "none|None", [], 0, 0, $productCurrency, $defaultEuroExchangeRates);
                foreach ($configuration->values as $value) {
                    /*  
                        if (count(explode("-", $value)) > 1)
                            continue;
                    */
                    if (str_contains($value, "Windows")) {
                        $subOptionId = $this->helper->config_group_sub_option($optionId, $value, $_SESSION["window_os_price"], 0, 0, $productCurrency, $defaultEuroExchangeRates);
                    } else {
                        $subOptionId = $this->helper->config_group_sub_option($optionId, $value, [], 0, 0, $productCurrency, $defaultEuroExchangeRates);
                    }
                }
            }
            unset($_SESSION["window_os_price"]);
        } catch (\Exception $e) {
            throw new \Exception('Error while creating product config Options for VPS product: ' . $e->getMessage());
        }
    }

    public function productDescription($productDetails = null, $productType = '', $productsProcessor = [], $addons = [], $Configuration = null)
    {
        try {
            $productDesc = '';
            $defaultAddons = [];
            $defaultAddonsMapping = [
                "bandwidth" => "Public Network Bandwidth",
                "vrack" => "Private Network Bandwidth",
                "system-storage" => "system-storage",
                "storage" => "Storage",
                "memory" => "RAM"
            ];
            /* Build defaultAddons array */
            $defaultAddons = [];
            foreach ($productDetails->addonFamilies as $productAddon) {
                if (array_key_exists($productAddon->name, $defaultAddonsMapping)) {
                    $defaultAddons[$productAddon->default] = $defaultAddonsMapping[$productAddon->name];
                }
            }
            /* Processor description */
            foreach ($productsProcessor as $details) {
                if (trim($productDetails->product) == trim($details->name)) {
                    $description = str_replace("2x", "Dual", $details->description);
                    $cpuDetails = $details->blobs->technical->server->cpu;
                    $productDesc .= '<li><b>CPU</b> ' . $description . '-' . $cpuDetails->cores . 'c/' . $cpuDetails->threads . 't-' . $cpuDetails->frequency . 'GHz/' . $cpuDetails->boost . 'GHz</li>';
                    break;
                }
            }
            /* Check for Private Network */
            if (!in_array("Private Network Bandwidth", $defaultAddons)) {
                $productDesc .= '<li><b>Private Network Bandwidth</b>--</li>';
            }
            /* Addons description */
            $systemStorage = false;
            foreach ($addons as $value) {
                if (array_key_exists($value->planCode, $defaultAddons)) {
                    $addonType = $defaultAddons[$value->planCode];
                    $invoiceName = trim($value->invoiceName);
                    if ($addonType === "Public Network Bandwidth") {
                        $details = explode("-", $invoiceName)[0] . " unmetered and guaranteed";
                        $productDesc .= '<li><b>' . $addonType . ' </b>' . $details . '</li>';
                    } elseif ($addonType === "Storage" || $addonType === "system-storage") {
                        if ($invoiceName !== "No storage drive" && $addonType === "Storage") {
                            $systemStorage = true;
                            $formattedName = $this->interchangeValuesInString($invoiceName);
                            $productDesc .= '<li><b>' . $addonType . ' </b>' . $formattedName . '</li>';
                        } elseif (!$systemStorage && $addonType === "system-storage") {
                            $formattedName = $this->interchangeValuesInString($invoiceName);
                            $productDesc .= '<li><b>Storage </b>' . $formattedName . '</li>';
                        }
                    } else {
                        $productDesc .= '<li><b>' . $addonType . ' </b>' . $invoiceName . '</li>';
                    }
                }
            }
            /* Datacenter desc */
            $dataCenterCode = end(explode("-", $productDetails->planCode));
            $dataCenters = $Configuration->dataCenter();
            if (array_key_exists($dataCenterCode, $dataCenters)) {
                $productDesc .=  '<li><b>Datacenter </b>Only ' . $dataCenters[$dataCenterCode] . '</li>';
            }
            return $productDesc;
        } catch (\Exception $e) {
            throw new \Exception('Error while creating product description for Dedicated product: ' . $e->getMessage());
        }
    }
    private function interchangeValuesInString($input)
    {
        $pattern = '/(\d+x)?\s*([A-Za-z0-9\s]+?)\s(\d+(GB|TB))/i';
        $output = preg_replace_callback($pattern, function ($matches) {
            $quantity = trim($matches[1]);
            $description = trim($matches[2]);
            $size = trim($matches[3]);
            return ($quantity ? $quantity . ' ' : '') . $size . ' ' . $description;
        }, $input);
        return $output;
    }
    public function convertUnit($bandwidth)
    {
        try {
            if (!isset($bandwidth)) {
                throw new \Exception("Bandwidth value is not set.");
            }
            $value = (float)$bandwidth;
            /* Convert if greater than or equal to 1000 Mbps */
            if ($value >= 1000) {
                $convertedValue = $value / 1000;
                return $convertedValue . ' Gbps';
            }
            return $value . ' Mbps';
        } catch (\Exception $e) {
            throw new \Exception('Error while converting bandwidth unit: ' . $e->getMessage());
        }
    }
    public function getBandwidth($productType, $productsFromApi)
    {
        try {
            $bandwidth = '';
            foreach ($productsFromApi["productsProcessor"] as $product) {
                if ($product->name == $productType) {
                    if (isset($product->blobs->technical->bandwidth)) {
                        if ($product->blobs->technical->bandwidth->unlimited) {
                            $bandwidth = $this->convertUnit($product->blobs->technical->bandwidth->level) . " - unlimited traffic*";
                        } else {
                            $bandwidth = $this->convertUnit($product->blobs->technical->bandwidth->level) . " - Only ";
                        }
                    }
                }
            }
            return $bandwidth;
        } catch (\Exception $e) {
            throw new \Exception('Error while getting bandwidth for VPS product: ' . $e->getMessage());
        }
    }
    /* creating product description for vps products */
    public function planVPSDescription($productType, $productsFromApi)
    {
        try {
            if (empty($productsFromApi['productsProcessor'])) {
                throw new \Exception('No products found from API.');
            }
            $productDescItems = [];
            foreach ($productsFromApi['productsProcessor'] as $productDetails) {
                if ($productType !== $productDetails->name) {
                    continue;
                }
                if (empty($productDetails->blobs->technical)) {
                    throw new \Exception("Missing technical details for product {$productType}");
                }
                foreach ($productDetails->blobs->technical as $detailKey => $detail) {
                    if (!in_array($detailKey, ['cpu', 'memory', 'storage', 'bandwidth'], true)) {
                        continue;
                    }
                    switch ($detailKey) {
                        case 'cpu':
                            $productDescItems[] = "<li><b>Processor</b> {$detail->cores} {$detail->type}</li>";
                            break;
                        case 'memory':
                            $productDescItems[] = "<li><b>Memory</b> {$detail->size} GB</li>";
                            break;
                        case 'storage':
                            $disk = $detail->disks[0] ?? null;
                            if ($disk) {
                                $productDescItems[] = "<li><b>Storage</b> {$disk->capacity} {$disk->interface}</li>";
                            }
                            break;
                        case 'bandwidth':
                            $bandwidth = $this->convertUnit($detail->level);
                            $traffic = $detail->unlimited ? 'unlimited traffic*' : 'Only';
                            $productDescItems[] = "<li><b>Bandwidth</b> {$bandwidth} - {$traffic}</li>";
                            break;
                    }
                }
                break;
            }
            // logModuleCall("soyoustart", "product description", $productDescItems, [implode('', $productDescItems)]);
            return implode('', $productDescItems);
        } catch (\Exception $e) {
            throw new \Exception('Error while creating VPS product description: ' . $e->getMessage());
        }
    }
    
    /* creating custom fields */
    public function createCustomFields($pid)
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
                ]
            ];
            foreach ($customfieldarray as $key => $customfieldval) {
                $fieldname = explode('|', $customfieldval['fieldname']);
                $exist_custom_fields = Capsule::table('tblcustomfields')->where('type', $customfieldval['type'])->where('relid', $customfieldval['relid'])->where('fieldname', 'like', $fieldname[0] . '|%')->get();
                if (!isset($exist_custom_fields[0]->id)) {
                    Capsule::table('tblcustomfields')->insert($customfieldval);
                } else {
                    Capsule::table('tblcustomfields')->where("relid", $pid)->where("type", "product")->where('fieldname', 'like', $fieldname[0] . '|%')->update(["fieldname" => $customfieldval["fieldname"], "description" => $customfieldval['description']]);
                }
            }
        } catch (\Exception $e) {
            logActivity("Creating Custom Fields Error: {$e->getMessage()}");
            throw new \Exception('Creating Custom Fields Error: ' . $e->getMessage());
        }
    }
    public function deleteWhmcsProduct($pid)
    {
        try {
            $this->helper->delete("tblproducts", ["id" => $pid]);
            $this->helper->delete("tblproductconfiglinks", ["pid" => $pid]);
            $this->helper->delete("tblproducts_slugs", ["product_id" => $pid]);
            // $helper->deleteConfigOptions($chkGroup02, $createnewproductid);
            return "success";
        } catch (\Illuminate\Database\QueryException $e) {
            throw new \Exception('Error while deleting products:' . $e->getMessage());
        } catch (Exception $e) {
            throw new \Exception('Error while deleting products:' . $e->getMessage());
        }
    }
    // function wgsSoyouStartDeleteGroupConfig($chkGroup02,$product,$createnewproductid){
    //     $groupID = $chkGroup02->id;
    //     Capsule::table('tblproductconfiglinks')->where('gid',$groupID)->where('pid',$createnewproductid)->delete();
    //     $configoptions = Capsule::table('tblproductconfigoptions')->select('id')->where('gid',$groupID)->get();
    //     foreach($configoptions as $configoptionRow){
    //         $subconfigoptions = Capsule::table('tblproductconfigoptionssub')->select('id')->where('configid',$configoptionRow->id)->get();
    //         foreach($subconfigoptions as $subconfigoptionRow) {
    //             Capsule::table('tblpricing')->where('type','configoptions')->where('relid',$subconfigoptionRow->id)->delete();
    //         }
    //         Capsule::table('tblproductconfigoptionssub')->where('configid',$configoptionRow->id)->delete();
    //     }
    //     Capsule::table('tblproductconfigoptions')->where('gid',$groupID)->delete();
    //     Capsule::table('tblproductconfiggroups')->where('description',$product)->delete();
    // }
    public function shortDatacenters($productsDatacenters = [])
    {
        $data = [];
        $dataCenters = $this->configuration->dataCenter();
        foreach ($productsDatacenters as $key => $value) {
            $data[$value] = array_key_exists($value, $dataCenters) ? $dataCenters[$value] : $value;
        }
        asort($data);
        return $data;
    }
}
