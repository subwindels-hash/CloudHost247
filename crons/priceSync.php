<?php

$whmcspath = "";

if (file_exists(dirname(__FILE__) . "/config.php"))
    require_once dirname(__FILE__) . "/config.php";

if (!empty($whmcspath)) {
    require_once $whmcspath . "/init.php";
    if (file_exists($whmcspath . '/modules/addons/soyoustart/classes/ProductSetting.php')) {
        require_once($whmcspath . '/modules/addons/soyoustart/classes/ProductSetting.php');
    } else {
        logActivity('OVH Cron error, File (/modules/addons/soyoustart/classes/ProductSetting.php) not found');
    }

    if (file_exists($whmcspath . '/modules/addons/soyoustart/classes/Configuration.php')) {
        require_once($whmcspath . '/modules/addons/soyoustart/classes/Configuration.php');
    } else {
        logActivity('OVH Cron error, File (/modules/addons/soyoustart/classes/Configuration.php) not found');
    }
} else {
    require(__DIR__ . "/../init.php");
    if (file_exists(__DIR__ . '/../modules/addons/soyoustart/classes/Configuration.php'))
        require_once(__DIR__ . '/../modules/addons/soyoustart/classes/Configuration.php');
    else
        logActivity('OVH Cron error, File (/modules/addons/soyoustart/classes/Configuration.php) not found');
    if (file_exists(__DIR__ . '/../modules/addons/soyoustart/classes/ProductSetting.php'))
        require_once(__DIR__ . '/../modules/addons/soyoustart/classes/ProductSetting.php');
    else
        logActivity('OVH Cron error, File (/modules/addons/soyoustart/classes/ProductSetting.php) not found');
}

use \WGSModule\Soyoustart\classes\ProductSetting;
use \WGSModule\Soyoustart\classes\Configuration;
use \WHMCS\Module\Addon\Soyoustart\Helper;
use \WGSModule\Soyoustart\classes\ApiCall;
use WHMCS\Database\Capsule;

session_start();
logActivity('Price SYNC start');
try {

    ini_set('memory_limit', '-1');
    $helper = new Helper();
    $apiCall = new ApiCall();
    $Configuration = new Configuration();
    $productSetting = new ProductSetting();

    $helper->insert_update("tblconfiguration", ['setting' => 'priceSynccronstatus'], ['value' => 'Configured', 'setting' => 'priceSynccronstatus', "updated_at" => date('Y-m-d H:i:s')]);

    /* create email template */

    if (!Capsule::table('tblemailtemplates')->WHERE('name', "Product Hidden(Depricated on OVH)")->WHERE('type', "admin")->count()) {
        Capsule::table('tblemailtemplates')->insertGetId([
            "type" => "admin",
            "name" => "Product Hidden(Depricated on OVH)",
            "subject" => "Product Hidden(Depricated on OVH)",
            "message" => 'Dear Admin,<br /><br />These products has been marked as hidden in your WHMCS because they are no longer available at OVH.<br /><br />{$productDetails}',
            "custom" => 1,
            "plaintext" => 0
        ]);
    }

    /* getting data */

    $ovhAllProducts = Capsule::table("tblproducts")
        ->join("mod_soyoustart_products", "tblproducts.id", "=", "mod_soyoustart_products.productid")
        ->whereIn("tblproducts.servertype", ["soyoustart", "soyoustart_vps"])
        // ->where("tblproducts.hidden","=", 0)
        ->select("tblproducts.*", "mod_soyoustart_products.pricesync as pricesync")
        ->get()->toArray();

    $totalProductCount = !empty($ovhAllProducts) ? count($ovhAllProducts) : 0;
    $cronHit = $helper->get_data("mod_acl_settings", ["key" => "cronHit"], "first");
    $cronHit = ($cronHit == null ? 0 : (int)$cronHit->value);
    if ($totalProductCount == (int)$cronHit) {
        $helper->insert_update("mod_acl_settings", ['key' => 'cronHit'], ['key' => 'cronHit', 'value' => 0]);
        $cronHit = 0;
    }
    $count = 0;

    $allAvailableProducts = $helper->getAvailableProduts();


    // echo"<pre>";
    // print_r($allAvailableProducts);
    // die("sdfkskh");
    if ($allAvailableProducts["status"] != "success") {
        logActivity('OVH Cron error, Error fetching available products: ' . $allAvailableProducts["message"]);

        exit;
    }

    $hidedProducts = [];

    foreach ($ovhAllProducts as $key => $product) {

        if ($key < $cronHit || $key > $cronHit + 9 || $product->pricesync) {
            continue;
        }
        $count++;
        $url = $product->configoption4;
        $configoption2 = explode("@", $product->configoption2);
        $planCode = $configoption2[1];
        $ovhproducttype = $configoption2[0];
        $productGroup = $product->configoption1 == "OVH" ? "DEDICATED" : ($product->configoption1 == "PublicCloud" ? "ECO_DIDICATED" : "VPS");

        $productGroupForJson = $product->configoption1 == "OVH" ? "Dedicated" : ($product->configoption1 == "PublicCloud" ? "ECO_Dedicated" : "VPS");

        $subsidiary = explode("=", $product->configoption4)[1] ?? '';

        $getPlansFromJson = $allAvailableProducts["data"][$productGroupForJson][$subsidiary] ?? [];

        if (!in_array($planCode, $getPlansFromJson) && $product->hidden == 0) {
            $hidedProducts[] = $product->name;
            $helper->insert_update("tblproducts", ['id' => $product->id], ['hidden' => 1]);
            continue;
        }
        if (in_array($planCode, $getPlansFromJson) && $product->hidden == 1) {
            $helper->insert_update("tblproducts", ['id' => $product->id], ['hidden' => 0]);
        }
        /* getting products from api */

        $productsFromApi = $productSetting->formateProductData($url, $ovhproducttype, $productGroup, $Configuration);
        $exchangeRates = $helper->getWhmcsConversionRate($productsFromApi["currency"]);
        $productExist = false;


        foreach ($productsFromApi["products"] as $productFromApi) {
            if (trim($planCode) == trim($productFromApi->planCode)) {
                $productExist = true;
                if ($product->hidden)
                    $helper->insert_update("tblproducts", ['id' => $product->id], ['hidden' => 0]);
                /* ----------update price of products -------------  */
                $serverType = ($product->configoption1 == "OVH" ? "Dedicated" : $product->configoption1);
                $getproductMargin = $helper->get_data("mod_soyoustart_pricesetting", ["server" => "OVH", "servertype" => $serverType], "first");
                /* updating product price start  */
                $priceUpdationVarProducts = $productSetting->soyouStartPriceUpdation($productFromApi->pricings, $getproductMargin->productprice, $getproductMargin->setupprice);
                $productSetting->updateprice($productsFromApi["currency"], $product->id, 'product', $priceUpdationVarProducts, $exchangeRates);
                /* updating product price end  */
                $chkGroup02 = Capsule::table('tblproductconfiggroups')->where('description', $planCode)->value('id');
                if (empty($chkGroup02))
                    continue;

                /* updating Aditinal IP configurable options prices*/
                $configOptionsData =  $Configuration->aditinalIpConfigOptionsData();
                $productSetting->createAditinalIpConfigOptions($configOptionsData, $getproductMargin, $chkGroup02, $productsFromApi["currency"], $exchangeRates);

                if ($product->configoption1 == "VPS") {
                    /* updating vps configoptions for the vps os */
                    foreach ($productFromApi->addonFamilies as $addonFamilie) {
                        foreach ($addonFamilie->addons as $value) {
                            $priceDetails = $productSetting->getAddonConfigPriceWithMargin($productsFromApi["addons"], $value, $getproductMargin, $addonFamilie->name);
                            if (str_contains($value, "windows"))
                                $_SESSION["window_os_price"] = $priceDetails["formatedPrices"];

                            $helper->config_group_sub_option($chkGroup02, $value, $priceDetails["formatedPrices"], 0, 0, $productsFromApi["currency"], $exchangeRates);
                        }
                    }

                    $productSetting->createVpsConfigOptions($productFromApi, $productsFromApi["addons"], $getproductMargin, $chkGroup02, $productsFromApi["currency"], $exchangeRates);
                } else {
                    /* creating/updating API product addon configurable options */
                    $productSetting->createAddonConfigOptions($productFromApi, $productsFromApi["addons"], $getproductMargin, $chkGroup02, $productsFromApi["currency"], $exchangeRates);
                }
            }
        }
        if (!$productExist && !$product->hidden) {
            $helper->insert_update("tblproducts", ['id' => $product->id], ['hidden' => 1]);
            logActivity("Product ID {$product->id} hidden as it was not found in the API.");
        }
    }

    /* sending email notification */

    if (!empty($hidedProducts)) {
        $productDetails = implode("<br>", $hidedProducts);
        $emailTemplate = $helper->get_data("tblemailtemplates", ["type" => "admin", "name" => "Product Hidden(Depricated on OVH)"], "first");
        if ($emailTemplate) {

            $postData = array(
                'messagename' => 'Product Hidden(Depricated on OVH)',
                'mergefields' => array(
                    'productDetails' => $productDetails
                ),
            );

            $results = localAPI("SendAdminEmail", $postData);
        }
    }

    $helper->insert_update("mod_acl_settings", ['id' => 'cronHit'], ['key' => 'cronHit', 'value' => (int)$count + (int)$cronHit]);
} catch (\Exception $e) {
    logActivity('Cron Error: Price SYNC(' . $e->getMessage() . ')');
}

logActivity('Price SYNC end');
die("end");
