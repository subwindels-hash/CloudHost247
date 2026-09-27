    <?php
    $whmcspath = "";
    if (file_exists(dirname(__FILE__) . "/config.php"))
        require_once dirname(__FILE__) . "/config.php";
    if (!empty($whmcspath)) {
        require_once $whmcspath . "/init.php";
        if (file_exists($whmcspath . '/modules/addons/soyoustart/classes/ApiCall.php')) {
            require_once($whmcspath . '/modules/addons/soyoustart/classes/ApiCall.php');
        } else {
            logActivity('OVH Cron error, File (/modules/addons/soyoustart/classes/ApiCall.php) not found');
        }
    } else {
        require(__DIR__ . "/../init.php");
        if (file_exists(__DIR__ . '/../modules/addons/soyoustart/classes/ApiCall.php'))
            require_once(__DIR__ . '/../modules/addons/soyoustart/classes/ApiCall.php');
        else
            logActivity('OVH Cron error, File (/modules/addons/soyoustart/classes/ApiCall.php) not found');
    }

    use \WHMCS\Module\Addon\Soyoustart\Helper;
    use \WGSModule\Soyoustart\classes\ApiCall;
    use WHMCS\Database\Capsule;

    $helper = new Helper();
    $apiCall = new ApiCall();
    try {
        $aclSettings = $helper->get_data("mod_acl_settings", ["key" => "generalaclSettings"])->first();
        $aclSettings = !empty($aclSettings->value) ? json_decode($aclSettings->value, true) : [];
        /* deleting the log after x days */
        $NewDate = Date('Y-m-d', strtotime("+$aclSettings[deleteLogafter] days"));
        Capsule::table("mod_soyoustart_email_log")->where("datetime", "<", $NewDate)->delete();
        Capsule::table("mod_soyoustart_log")->where("datetime", "<", $NewDate)->delete();
        $helper->insert_update("tblconfiguration", ['setting' => 'getServercronstatus'], ['value' => 'Configured', 'setting' => 'getServercronstatus', "updated_at" => date('Y-m-d H:i:s')]);
        /* getting all services related to soyoustart and soyoustart_vps server */
        $allServices = $helper->getAllServerPackages();
        if (!isset($allServices[0])) {
            logActivity("No active services found with soyoustart server module!");
            return;
        }

        foreach ($allServices as $service) {
            $accountId = $service->accountInfo->id;
            $location = $service->accountInfo->location;
            $ovhCustomHostname = $service->ovh_custom_hostname;
            $ovh_server_name = $service->ovh_server_name;
            $ovhOrderId = $service->ovh_order_id;
            // if (in_array($service, ["*001", "*/001", "*"]) && !empty($ovh_server_name)) {
            //    if (in_array($ovh_server_name, ["*001", "*/001", "*"]) && !empty($ovh_server_name)) {

            if (empty($ovh_server_name)) {
                $orderstatus = $apiCall->get('/me/order/' . $ovhOrderId . '/status', $accountId, $location, "Getting order status", true);
                if ($orderstatus["httpcode"] != 200) {
                    logActivity('Cron Error: getting server datails after create command for serviceId(' . $service->id . ') error message(' . $orderstatus["result"]->message . ') ');
                    continue;
                }


                if ($orderstatus["result"] == "delivered") {
                    /* getting billing details of specific order id */
                    $billDetail = $apiCall->get("/me/bill?orderId={$ovhOrderId}", $accountId, $location, "Getting billing details", true);
                    if ($billDetail["httpcode"] != 200) {
                        logActivity('Cron Error: getting bill details after create command for serviceId(' . $service->id . ') error message(' . $billDetail["result"]->message . ') ');
                        continue;
                    }
                    /* getting order details */
                    $orderDetail = $apiCall->get("/me/bill/{$billDetail['result'][0]}", $accountId, $location, "Getting order details", true);
                    if ($orderDetail["httpcode"] != 200) {
                        logActivity('Cron Error: getting order details after create command for serviceId(' . $service->id . ') error message(' . $orderDetail["result"]->message . ') ');
                        continue;
                    }
                    if ($orderDetail["result"]->orderId == $ovhOrderId) {
                        /* Getting bill details ids */
                        $billDetailIds = $apiCall->get("/me/bill/{$billDetail['result'][0]}/details", $accountId, $location, "Getting bill details ids", true);
                        if ($billDetailIds["httpcode"] != 200) {
                            logActivity('Cron Error: getting bill details ids after create command for serviceId(' . $service->id . ') error message(' . $billDetailIds["result"]->message . ') ');
                            continue;
                        }
                        $billDetailIds = end($billDetailIds["result"]);
                        $billDetails = $apiCall->get("/me/bill/{$billDetail['result'][0]}/details/{$billDetailIds}", $accountId, $location, "Getting bill details ids", true);
                        if ($billDetails["httpcode"] != 200) {
                            logActivity('Cron Error: getting bill details after create command for serviceId(' . $service->id . ') error message(' . $billDetails["result"]->message . ') ');
                            continue;
                        }
                        $domainName = $billDetails["result"]->domain;
                        if (str_contains($domainName, 'ns') || str_contains($domainName, 'vps')) {
                            $ressponse =  $helper->insert_custom_fields_value($service->id, $service->packageid, $fields = ["ovh_server_name" => $domainName]);
                        }
                        logActivity("Cron: get server name run successfully for the service id #$service->id");
                    }
                }
            }
            /* checking  */
            if ($service->servertype == "soyoustart_vps" && $service->ovh_server_name != "*/001" && !empty($service->ovh_server_name)) {
                /* getting service details */
                $serviceDetails = localAPI("GetClientsProducts", ['serviceid' => $service->id]);
                if ($serviceDetails["result"] != "success" || $serviceDetails["totalresults"] == 0) {
                    logActivity('Cron Error: serviceId(' . $service->id . ') does not found!');
                    continue;
                }
                $params = [];
                foreach ($serviceDetails['products']['product'][0]['customfields']['customfield'] as $customfield) {
                    $params['customfields'][$customfield['name']] = $customfield['value'];
                }
                foreach ($serviceDetails['products']['product'][0]['configoptions']['configoption'] as $configoption) {
                    $params['configoptions'][strtolower($configoption['option'])] = $configoption['value'];
                }
                $billingCycle = $serviceDetails['products']['product'][0]["billingcycle"];
                $noOfIps = explode(' ', $params['configoptions']['additional ips'])[0];
                $chkexistIp = Capsule::table('mod_soyoustart_ips_orders')->where(['service_id' => $service->id, "invoiceid" => 0])->count();
                $ovhPaymentMethod = $helper->get_data("mod_soyoustart_pricesetting", ["server" => "OVH", "servertype" => "VPS"], "first");
                $paymentmethod = $ovhPaymentMethod->paymentmethod;
                $productDetails = $helper->get_data("tblproducts", ["id" => $service->packageid], "first");
                $ovhSubsidiary = explode("=", $productDetails->configoption4)[1];
                $ovhAccountData = explode('-', $params['configoption3']);
                $configoption2 = explode('@', $productDetails->configoption2);
                $planGroup = $configoption2["0"];
                $planCode = $configoption2["1"];
                if (is_numeric($noOfIps) && !$chkexistIp) {
                    $billingData = formateBillingCycle($billingCycle);
                    /* creating cart */
                    $cartDetails = $apiCall->createCart($location, $planCode . "add Additional IPs", $ovhSubsidiary);
                    if ($cartDetails["httpcode"] != 200) {
                        logActivity('Cron Error: creating additional ip for(' . $service->id . ') error message(' . $cartDetails["result"]->message . ') ');
                        continue;
                    }
                    $cartId = $cartDetails["result"]->cartId;
                    $quantity = (int) $noOfIps;
                    $postData = array(
                        'duration' => $billingData["durationVal"],
                        'planCode' => 'ip-failover-arin',
                        'pricingMode' => $billingData["pricingModeVal"],
                        'quantity' => (int) $noOfIps
                    );
                    /* assigning ip into cart */
                    $assignIpData = $apiCall->post("/order/cart/{$cartId}/ip", $accountId, $location, $postData, "Assigning ip into cart", true);
                    if ($assignIpData["httpcode"] != 200) {
                        logActivity('Cron Error: Assigning ip into cart for(' . $service->id . ') error message(' . $assignIpData["result"]->message . ') ');
                        continue;
                    }
                    /* assigning ip options */
                    $itemId = $assignIpData["result"]->itemId;
                    $ipconfig = $apiCall->post("/order/cart/{$cartId}/item/{$itemId}/configuration", $accountId, $location, ["label" => "country", "value" => "CA"], "assigning country to ip");
                    $cartassign = $apiCall->assignCart('/order/cart/' . $cartId . '/assign', $accountId, $location);
                    if ($cartassign["httpcode"] != 200) {
                        logActivity('Cron Error: Assigning cart for(' . $service->id . ') error message(' . $cartassign["result"]->message . ') ');
                        continue;
                    }
                    $ipcheckout = $apiCall->post("/order/cart/{$cartId}/checkout", $accountId, $location, ['autoPayWithPreferredPaymentMethod' => true, 'waiveRetractationPeriod' => false], "creating order for additional IPs", true);
                    if ($ipcheckout["httpcode"] != 200) {
                        logActivity('Cron Error: ordering additional IPS for(' . $service->id . ') error message(' . $ipcheckout["result"]->message . ') ');
                        continue;
                    }
                    $orderId = $response["result"]->orderId;
                    Capsule::table('mod_soyoustart_ips_orders')->insert(array('service_id' => $service->id, 'iporderid' => $orderId, 'status' => '0'));
                    $paymentresponse = $apiCall->getpaymentdetail(["configoption3" => $productDetails->configoption3], $orderId, $paymentmethod, $service->packageid, $service->id, $ovhAccountData, $location);
                    if (!isset($paymentresponse["result"]->message)) {
                        logActivity('Additional IP order #' . $orderId . ' mark paid with this service ID:' . $service->id);
                        Capsule::table('mod_soyoustart_ips_orders')->where('service_id', $service->id)->where('status', '0')->update(['status' => '1']);
                    } else {
                        logActivity('Additional IP payment(service id: ' . $service->id . ') not recieved,' . $paymentresponse["result"]->message);
                    }
                }
            }
            // }
        }
    } catch (\Exception $e) {
        logActivity('Cron Error: getting server datails after create command(' . $e->getMessage() . ')');
    }
    logActivity('Get Serve cron completed!');
    function formateBillingCycle($billingCycle)
    {
        $data = [];
        if ($billingCycle == "Monthly") {
            $data['durationVal'] = "P1M";
            $data['pricingModeVal'] = "default";
        } elseif ($billingCycle == "Quarterly") {
            $data['durationVal'] = "P3M";
            $data['pricingModeVal'] = "default";
        } elseif ($billingCycle == "Semi-Annually") {
            $data['durationVal'] = "P6M";
            $data['pricingModeVal'] = "default";
        } elseif ($billingCycle == "Annually") {
            $data['durationVal'] = "P1Y";
            $data['pricingModeVal'] = "degressivity12";
        } elseif ($billingCycle == "Biennially") {
            $data['durationVal'] = "P2Y";
            $data['pricingModeVal'] = "degressivity24";
        } else {
            $data['durationVal'] = "P1M";
            $data['pricingModeVal'] = "default";
        }
        return $data;
    }
