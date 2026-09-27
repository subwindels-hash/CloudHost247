<?php

namespace WGSModule\Soyoustart\classes;

use WHMCS\Database\Capsule;
use WHMCS\Module\Addon\Soyoustart\Helper;

class ApiCall extends Helper
{
    public $baseUrl = "https://api.us.ovhcloud.com/1.0";

    public $url = '';

    // public function __curlCall($method, $data = null, $apiUrl =null, $header =[], $action ='')
    // {
    //     $curl = curl_init();
    //     switch ($method) {
    //         case 'POST':
    //             curl_setopt($curl, CURLOPT_POST, 1);
    //             if (is_string($data)) {
    //                 curl_setopt($curl, CURLOPT_POSTFIELDS, (strlen($data) ? $data : ""));
    //             } else {
    //                 curl_setopt($curl, CURLOPT_POSTFIELDS, (count($data) ? json_encode($data) : ""));
    //             }
    //             break;
    //         case 'PUT':

    //             curl_setopt($curl, CURLOPT_CUSTOMREQUEST, 'PUT');
    //             if (is_string($data)) {
    //                 curl_setopt($curl, CURLOPT_POSTFIELDS, (strlen($data) ? $data : ""));
    //             } else {
    //                 curl_setopt($curl, CURLOPT_POSTFIELDS, (count($data) ? json_encode($data) : ""));
    //             }
    //             break;

    //         case 'DELETE':

    //             curl_setopt($curl, CURLOPT_CUSTOMREQUEST, 'DELETE');
    //             if (is_string($data)) {
    //                 curl_setopt($curl, CURLOPT_POSTFIELDS, (strlen($data) ? $data : ""));
    //             } else {
    //                 curl_setopt($curl, CURLOPT_POSTFIELDS, (count($data) ? json_encode($data) : ""));
    //             }
    //             break;

    //         default:
    //             curl_setopt($curl, CURLOPT_CUSTOMREQUEST, 'GET');
    //     }

    //     curl_setopt($curl, CURLOPT_URL, $apiUrl);
    //     curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
    //     curl_setopt($curl, CURLOPT_CONNECTTIMEOUT, 0);
    //     curl_setopt($curl, CURLOPT_MAXREDIRS, 10);
    //     curl_setopt($curl, CURLOPT_FOLLOWLOCATION, 1);
    //     curl_setopt($curl, CURLOPT_HTTP_VERSION, CURL_HTTP_VERSION_1_1);

    //     curl_setopt($curl, CURLOPT_SSL_VERIFYPEER, false);
    //     curl_setopt($curl, CURLOPT_SSL_VERIFYHOST, false);

    //     curl_setopt($curl, CURLOPT_HTTPHEADER, $header);
    //     $response = curl_exec($curl);
    //     $httpCode = curl_getinfo($curl, CURLINFO_HTTP_CODE);
    //     if (curl_errno($curl)) {
    //         throw new \Exception(curl_error($curl));
    //     }
    //     curl_close($curl);

    //     $isLogEnable = Capsule::table("mod_acl_settings")->where(["key" => "generalaclSettings"])->first();
    //     $isLogEnable = (isset($isLogEnable->id) ? json_decode($isLogEnable->value, true) : []);

    //     if (isset($isLogEnable["moduleLogstatus"]) && $isLogEnable["moduleLogstatus"] == "on" && !in_array($action, ["Get Info for vps server", "Get Info for eco server", "Get info for baremetal server"])) {
    //         $postData = ["datetime" => date("Y/m/d h:i"), "action" => $action, "type" => $method, "request" => (empty($data) || is_null($data) ? $apiUrl : json_encode($data)), "response" => json_encode(['httpcode' => $httpCode, 'result' => json_decode($response)])];
    //         Capsule::table("mod_soyoustart_log")->insertGetId($postData);
    //     }
    //     return ['httpcode' => $httpCode, 'result' => json_decode($response)];
    // }

    public function __curlCall($method, $data = null, $apiUrl = null, $header = [], $action = '')
    {
        $curl = curl_init();
        $method = strtoupper($method);
        $body = "";
        if ($method !== 'GET' && !empty($data)) {
            $body = is_string($data) ? $data : json_encode($data);
            curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
        }

        // HTTP Method
        switch ($method) {
            case 'POST':
                curl_setopt($curl, CURLOPT_POST, true);
                break;
            case 'PUT':
            case 'DELETE':
            case 'PATCH':
                curl_setopt($curl, CURLOPT_CUSTOMREQUEST, $method);
                break;
            case 'GET':
            default:
                curl_setopt($curl, CURLOPT_HTTPGET, true);
                break;
        }

        curl_setopt($curl, CURLOPT_URL, $apiUrl);
        curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($curl, CURLOPT_TIMEOUT, 60);
        curl_setopt($curl, CURLOPT_CONNECTTIMEOUT, 20);

        curl_setopt($curl, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($curl, CURLOPT_SSL_VERIFYHOST, false);

        curl_setopt($curl, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($curl, CURLOPT_MAXREDIRS, 10);

        $finalHeader = array_merge($header, [
            'Expect:',
            'Connection: keep-alive'
        ]);
        curl_setopt($curl, CURLOPT_HTTPHEADER, $finalHeader);

        curl_setopt($curl, CURLOPT_TCP_KEEPALIVE, 1);

        $response = curl_exec($curl);
        $httpCode = curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $curlError = curl_error($curl);

     

        // if($action == "Assigning Cart"){
        //     $curlInfo = curl_getinfo($curl);
        //     echo "<pre>";
        //     echo "Method: " . $method . PHP_EOL;
        //     echo "URL: " . $apiUrl . PHP_EOL;
        //     echo "Body:" . PHP_EOL;
        //     var_dump($body);
        //     echo "Headers:" . PHP_EOL;
        //     print_r($header);
        //     echo "</pre>";
        //     echo"<pre>";
        //     print_r($curlInfo);
        //     // var_dump($url, $ovhAccountId, $location);
        //      echo "cURL Error: " . curl_error($curl) . PHP_EOL;
        //     print_r($response);
        //     die;
        // }
           curl_close($curl);
        if ($curlError) {
            throw new \Exception("cURL Error: " . $curlError);
        }

        $decoded = json_decode($response);   // <-- returns stdClass
        $finalResponse = $decoded !== null ? $decoded : $response;

        $isLogEnable = Capsule::table("mod_acl_settings")
            ->where(["key" => "generalaclSettings"])
            ->first();

        $isLogEnable = isset($isLogEnable->id)
            ? json_decode($isLogEnable->value, true)
            : [];

        if (
            isset($isLogEnable["moduleLogstatus"]) && $isLogEnable["moduleLogstatus"] == "on" && !in_array($action, [
                "Get Info for vps server",
                "Get Info for eco server",
                "Get info for baremetal server",
                "Get Products From API"
            ])
        ) {
            Capsule::table("mod_soyoustart_log")->insert([
                "datetime" => date("Y-m-d H:i"),
                "action"   => $action,
                "type"     => $method,
                "request"  => empty($body) ? $apiUrl : $body,
                "response" => json_encode([
                    "httpcode" => $httpCode,
                    "result"   => $finalResponse
                ])
            ]);
        }

        return [
            'httpcode' => $httpCode,
            'result'   => $finalResponse
        ];
    }



    public function get($url, $ovhAccountId, $location, $action, $createHeader = false, $fullUrl = false)
    {
        try {
            if (!$fullUrl) {
                $this->baseUrl = $this->getBaseUrl($location);
                $url = $this->baseUrl . $url;
            } else {
                $url = $url;
            }


            if ($createHeader) {
                $header = self::createHeader($ovhAccountId, "GET", $url);
            } else {
                $header = ['Accept: application/json', 'X-Ovh-Application: t7r8jC5iiznmTNNm', 'Content-Type: application/json'];
            }
            $response = $this->__curlCall("GET", [], $url, $header, $action);
            return $response;
        } catch (\Exception $e) {
            throw new \Exception('Error while getting data for ' . $action . ' : ' . $e->getMessage());
        }
    }

    public function post($endPoint, $ovhAccountId, $location, $data = null, $action = '', $createHeader = false)
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);
            $url = $this->baseUrl . $endPoint;
            if ($createHeader) {
                if (empty($data)) {
                    $header = self::createHeader($ovhAccountId, "POST", $url);
                } else {
                    $header = self::createHeader($ovhAccountId, "POST", $url, $data);
                }
            } else {
                $header = ['Accept: application/json', 'X-Ovh-Application: t7r8jC5iiznmTNNm', 'Content-Type: application/json'];
            }
            $response = $this->__curlCall("POST", $data, $url, $header, $action);
            return $response;
        } catch (\Exception $e) {
            throw new \Exception('Error while creating ' . $action . ' : ' . $e->getMessage());
        }
    }


    public function put($endPoint, $ovhAccountId, $location, $data = null, $action = '', $createHeader = false)
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);
            $url = $this->baseUrl . $endPoint;
            if ($createHeader) {
                if (empty($data)) {
                    $header = self::createHeader($ovhAccountId, "PUT", $url);
                } else {
                    $header = self::createHeader($ovhAccountId, "PUT", $url, $data);
                }
            } else {
                $header = ['Accept: application/json', 'X-Ovh-Application: t7r8jC5iiznmTNNm', 'Content-Type: application/json'];
            }
            $response = $this->__curlCall("PUT", $data, $url, $header, $action);
            return $response;
        } catch (\Throwable $th) {
            //throw $th;
        }
    }


    public function __delete($endPoint, $ovhAccountId, $location, $data = null, $action = '', $createHeader = false)
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);
            $url = $this->baseUrl . $endPoint;
            if ($createHeader) {
                if (empty($data)) {
                    $header = self::createHeader($ovhAccountId, "DELETE", $url);
                } else {
                    $header = self::createHeader($ovhAccountId, "DELETE", $url, $data);
                }
            } else {
                $header = ['Accept: application/json', 'X-Ovh-Application: t7r8jC5iiznmTNNm', 'Content-Type: application/json'];
            }
            $response = $this->__curlCall("DELETE", $data, $url, $header, $action);
            return $response;
        } catch (\Throwable $th) {
            //throw $th;
        }
    }




    public function assignCart($url, $ovhAccountId, $location)
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);
            $url = $this->baseUrl . $url;
            $header = self::createHeader($ovhAccountId, "POST", $url);
            $response = $this->__curlCall("POST", [], $url, $header, "Assigning Cart");
            return $response;
        } catch (\Exception $e) {
            throw new \Exception('Error while getting data for Assigning Cart : ' . $e->getMessage());
        }
    }

    public function addConfigOptInCart($url, $ovhAccountId, $data, $location)
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);
            $url = $this->baseUrl . $url;
            $header = ['Accept: application/json', 'X-Ovh-Application: t7r8jC5iiznmTNNm', 'Content-Type: application/json'];
            $response = $this->__curlCall("POST", $data, $url, $header, "assigning config option to cart");
            return $response;
        } catch (\Exception $e) {
            throw new \Exception('Error while getting data for assigning config option to cart : ' . $e->getMessage());
        }
    }
    public function addItemInCart($url, $ovhAccountId, $data, $location)
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);
            $test = $data;
            $url = $this->baseUrl . $url;
            // $header = self::createHeader($ovhAccountId, "POST", $url, $data);
            $header = ['Accept: application/json', 'X-Ovh-Application: t7r8jC5iiznmTNNm', 'Content-Type: application/json'];

            $response = $this->__curlCall("POST", $test, $url, $header, "add item in cart");
            return $response;
        } catch (\Exception $e) {
            throw new \Exception('Error while getting data for add item in cart : ' . $e->getMessage());
        }
    }


    public function getOs($endPoint = null)
    {
        try {
            $applicationKey = "iE3vL3mgAtLZg00l";
            $url = "https://ca.api.ovh.com/1.0/dedicated/installationTemplate/{$endPoint}";
            $header = ['Content-Type:application/json', 'X-Ovh-Application:' . $applicationKey];

            $data = $this->__curlCall("GET", null, $url, $header, "Get OS");
            return $data;
        } catch (\Exception $e) {
            throw new \Exception('Error while getting all OS : ' . $e->getMessage());
        }
    }

    /*  */
    public function getOsDetails($templateNames)
    {
        try {
            $templateDetail = [];
            foreach ($templateNames as $key => $templateName) {
                $tempDetail = $this->getOs($templateName);
                if ($tempDetail["httpcode"] != 200) {
                    logActivity($templateDetail["result"]->message . "in $templateName");
                }
                /*  // getting specific data  */
                $templateDetail[$key]["family"] = $tempDetail["result"]->family;
                $templateDetail[$key]["subfamily"] = $tempDetail["result"]->subfamily;
                $templateDetail[$key]["templateName"] = $tempDetail["result"]->templateName;
                $templateDetail[$key]["distribution"] = $tempDetail["result"]->distribution;
                $templateDetail[$key]["description"] = $tempDetail["result"]->description;
            }

            return $templateDetail;
        } catch (\Exception $e) {
            throw new \Exception('Error while getting Details of  OS : ' . $e->getMessage());
        }
    }
    public function getTemplatesData($availableTemplates, $ovhServerName, $accountId, $location)
    {
        $templatedata = [];
        $templateErrors = [];
        foreach ($availableTemplates as $value) {
            $temInfo = $this->get("/vps/{$ovhServerName}/images/available/$value", $accountId, $location, "Getting Templates", true);
            if ($temInfo["httpcode"] != 200) {
                $templateErrors['error'] = $temInfo["result"]->message;
            }
            $templatedata[$value] = $temInfo["result"]->name;
        }
        $result = (!empty($templateErrors)) ? $templateErrors : $templatedata;

        return $result;
    }

    public function getApiProducts($url)
    {
        // $produts = $this->__curlCall("GET", null, $url, [], "Get Products From API");
        $produts = $this->__curlCall("GET", null, $url, [], "Get Products From API");

        return $produts;
    }


    public function createCart($location, $cartDesc = "description", $subsidiaryLocation = null)
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);
            $url = $this->baseUrl . "/order/cart";
            $header = ['Accept: application/json', 'X-Ovh-Application: t7r8jC5iiznmTNNm', 'Content-Type: application/json'];
            $data = ["description" => $cartDesc, "ovhSubsidiary" => $subsidiaryLocation];
            $cartDetails = $this->__curlCall("POST", $data, $url, $header, "Creating Cart");
            return $cartDetails;
        } catch (\Exception $e) {
            throw new \Exception('Error while creating cart : ' . $e->getMessage());
        }
    }

    public function getCartdetails($url, $ovhAccountId, $location)
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);
            $url = $this->baseUrl . $url;
            $header = self::createHeader($ovhAccountId, "GET", $url);
            $cartDetails = $this->__curlCall("GET", [], $url, $header, "get cart details");
            return $cartDetails;
        } catch (\Exception $e) {
            throw new \Exception('Error while getting cart details: ' . $e->getMessage());
        }
    }
    public function createOrder($url, $ovhAccountId, $location)
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);
            $url = $this->baseUrl . $url;
            $header = self::createHeader($ovhAccountId, "POST", $url, ["Empty" => true]);
            $orderDetails = $this->__curlCall("POST", ["Empty" => true], $url, $header, "create order");
            return $orderDetails;
        } catch (\Exception $e) {
            throw new \Exception('Error while getting cart details: ' . $e->getMessage());
        }
    }

    /* 
        * @param string $applicationKey 
        * @param string $consumerKey 
        * @param string $signature 

        @return array header.

    */
    private function createHeader($ovhAccountId, $method, $url, $data = null)
    {
        try {
            $authData = Capsule::table("mod_soyoustart")->where(["id" => $ovhAccountId])->first();
            $signature = self::generateSignature(trim($authData->secret_key), trim($authData->consumer_key), $method, $url, $data);

            $time = time() + 0;
            return [
                'content-type:application/json',
                'accept:application/json',
                'X-Ovh-Application:' . trim($authData->application_key),
                'X-Ovh-Consumer:' . trim($authData->consumer_key),
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
            if (!is_null($data)) {
                $data = json_encode($data);
            }
            $time = time() + 0;
            $toSign = $secretKey . '+' . $consumerKey . '+' . $method . '+' . $url . '+' . $data . '+' . $time;
            $signature = '$1$' . sha1($toSign);
            return $signature;
        } catch (\Exception $e) {
            throw new \Exception('Error while generating signature: ' . $e->getMessage());
        }
    }

    public function getServerInfo($location, $servertype, $ovhServerName, $accountId)
    {

        try {
            $this->baseUrl = $this->getBaseUrl($location);

            if ($servertype == "soyoustart") {
                $url = $this->baseUrl . "/dedicated/server/{$ovhServerName}";
            } else {
                $url = $this->baseUrl . "/vps/{$ovhServerName}";
            }
            $header = self::createHeader($accountId, "GET", $url);

            $serverInfo = $this->__curlCall("GET", [], $url, $header, "Getting Server Info");

            if ($serverInfo["httpcode"] != 200) {
                return $serverInfo;
            }
            if ($servertype == "soyoustart") {
                $url = $this->baseUrl . "/dedicated/server/{$ovhServerName}/serviceInfos";
            } else {
                $url = $this->baseUrl . "/vps/{$ovhServerName}/serviceInfos";
            }

            if (isset($serverInfo["result"]->state)) {
                $header = self::createHeader($accountId, "GET", $url);
                $response = $this->__curlCall("GET", [], $url, $header, "Getting Server Info");
                $serverInfo["result"]->expiration = $response["result"]->expiration;
                // $serverInfo["result"]->serviceInfos = $response["result"];
            }
            return $serverInfo;
        } catch (\Exception $e) {
            //throw $th;
        }
    }
    public function getHardwareInfo($location, $servertype, $ovhServerName, $accountId)
    {

        try {
            $this->baseUrl = $this->getBaseUrl($location);
            $url = $this->baseUrl . "/dedicated/server/{$ovhServerName}/specifications/hardware";

            $header = self::createHeader($accountId, "GET", $url);

            $hardwareInfo = $this->__curlCall("GET", [], $url, $header, "Getting Hardware Info");
            return $hardwareInfo;
        } catch (\Exception $e) {
            //throw $th;
        }
    }

    public function getInterventionInfo($location, $interventions, $ovhServerName, $accountId)
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);
            $data = [];
            foreach ($interventions as $key => $value) {
                $url = $this->baseUrl . "/dedicated/server/{$ovhServerName}/intervention/{$value}";
                $header = self::createHeader($accountId, "GET", $url);
                $interventionInfo = $this->__curlCall("GET", [], $url, $header, "Getting Intervention Info");
                $data[] = $interventionInfo["result"];
            }
            return $data;
        } catch (\Exception $e) {
            //throw $th;
        }
    }

    public function getIpDetails($location, $ovhServerName, $accountId, $ip)
    {
        try {
            $ip = urlencode($ip);
            $this->baseUrl = $this->getBaseUrl($location);
            $url = $this->baseUrl . "/ip/{$ip}";
            $header = self::createHeader($accountId, "GET", $url);
            $ipDetails = $this->__curlCall("GET", [], $url, $header, "Getting IP details");

            if ($ipDetails["httpcode"] != 200) {
                return $ipDetails;
            }

            $ipv4 = explode("/", urldecode($ip));
            $ipblock = urlencode(urldecode($ip));
            /* checking mitigration enable or not */
            if (!str_contains("::", $ip)) {
                $endPoint = "/ip/{$ipblock}/mitigation/{$ipv4[0]}";
                $response = $this->get($endPoint, $accountId, $location, "Getting mitigation IP", true);
                $ipDetails["result"]->mitigationIp = '';
                if ($response["httpcode"] == 200) {
                    $ipDetails["result"]->mitigationIp = $response["result"]->ipOnMitigation;
                }
            }


            /* getting mac address */

            // $macAddress = $this->getVertualMacAddress($location, $accountId, $ovhServerName);
            $macAddress = $this->get("/dedicated/server/{$ovhServerName}/virtualMac", $accountId, $location, "Getting mac address", true);
            if ($macAddress["httpcode"] != 200) {
                $ipDetails["result"]->macaddress = $macAddress["result"]->message;
            } else {
                $ipDetails["result"]->macaddress = $macAddress["result"];
            }
            $firewallDetails = $this->getFirewallDetails($location, $accountId, urldecode($ip));
            $ipDetails["result"]->firewallDetails = $firewallDetails["result"];

            /* reverse DNS */
            $reverseIp = $this->get("/ip/{$ipblock}/reverse/{$ipv4[0]}", $accountId, $location, "getting reverse DNS", true);

            $ipDetails["result"]->reverseIp = $reverseIp["result"];

            return $ipDetails;
        } catch (\Exception $e) {
            //throw $th;
        }
    }

    // public function getVertualMacAddress($location, $accountId, $ovhServerName)
    // {
    //     try {
    //         $this->baseUrl = $this->getBaseUrl($location);
    //         $url = $this->baseUrl . "/dedicated/server/{$ovhServerName}/virtualMac";
    //         $header = self::createHeader($accountId, "GET", $url);
    //         $macAddress = $this->__curlCall("GET", [], $url, $header, "Getting mac address");

    //         return $macAddress;
    //     } catch (\Exception $e) {
    //         //throw $th;
    //     }
    // }
    public function getFirewallDetails($location, $accountId, $ipblock)
    {
        try {
            $ipV4 = explode("/", $ipblock);
            $ipblock = urlencode($ipblock);
            $this->baseUrl = $this->getBaseUrl($location);
            // $url = $this->baseUrl . "/dedicated/server/{$ovhServerName}/features/firewall";
            $url = $this->baseUrl . "/ip/{$ipblock}/firewall/{$ipV4['0']}";

            $header = self::createHeader($accountId, "GET", $url);
            $firewallDetails = $this->__curlCall("GET", [], $url, $header, "Getting Firewall Details");

            return $firewallDetails;
        } catch (\Exception $e) {
            //throw $th;
        }
    }

    public function createFirewall($location, $accountId, $ipblock)
    {
        try {
            $ipV4 = explode("/", $ipblock);
            $data = ["ipOnFirewall" => $ipV4[0]];
            $ipblock = urlencode($ipblock);
            $this->baseUrl = $this->getBaseUrl($location);
            $url = $this->baseUrl . "/ip/{$ipblock}/firewall";

            $header = self::createHeader($accountId, "POST", $url, $data);
            $response = $this->__curlCall("POST", $data, $url, $header, "Creating Firewall");

            return $response;
        } catch (\Exception $e) {
            //throw $th;
        }
    }
    public function deleteFirewall($location, $accountId, $ipblock)
    {
        try {
            $ipV4 = explode("/", $ipblock);
            $ipblock = urlencode($ipblock);
            $this->baseUrl = $this->getBaseUrl($location);
            $url = $this->baseUrl . "/ip/{$ipblock}/firewall/{$ipV4[0]}";

            $header = self::createHeader($accountId, "DELETE", $url);
            $response = $this->__curlCall("DELETE", [], $url, $header, "Deleting Firewall");

            return $response;
        } catch (\Exception $e) {
            //throw $th;
        }
    }
    public function enableDisableFirewall($location, $accountId, $ipblock, $data)
    {
        try {
            $ipV4 = explode("/", $ipblock);
            $ipblock = urlencode($ipblock);
            $this->baseUrl = $this->getBaseUrl($location);
            $url = $this->baseUrl . "/ip/{$ipblock}/firewall/{$ipV4[0]}";
            $header = self::createHeader($accountId, "PUT", $url, $data);
            $response = $this->__curlCall("PUT", $data, $url, $header, "Enabling/Disabling Firewall");

            return $response;
        } catch (\Exception $e) {
            //throw $th;
        }
    }

    public function getChart($location, $servertype, $ovhServerName, $accountId, $data)
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);
            if ($servertype == "soyoustart") {
                if (!empty($data)) {
                    $url = $this->baseUrl . "/dedicated/server/{$ovhServerName}/mrtg?period={$data['period']}&type={$data['type']}";
                } else {
                    $url = $this->baseUrl . "/dedicated/server/{$ovhServerName}/mrtg?period=hourly&type=traffic:download";
                }
            } else {
                if (!empty($data)) {
                    $url = $this->baseUrl . "/vps/{$ovhServerName}/monitoring?period={$data['period']}&type={$data['type']}";
                } else {
                    $url = $this->baseUrl . "/vps/{$ovhServerName}/monitoring?period=today&type=cpu:used";
                }
            }
            $header = self::createHeader($accountId, "GET", $url);
            $chartData = $this->__curlCall("GET", [], $url, $header, "Getting chart Info");

            $data = [];
            if ($servertype == "soyoustart") {
                foreach ($chartData["result"] as $key => $value) {
                    $datavalue = $value->value->value != "" ? ($value->value->value / 1000) : 0;
                    $data[] = [($value->timestamp * 1000), (float) number_format($datavalue, 2)];
                }
            } else {

                if ($chartData["result"]->unit == "b/s") {
                    foreach ($chartData["result"]->values as $key => $value) {
                        $data["type"] = "BPS";
                        // $data["data"][] = [($value->timestamp * 1000), ($value->value != null ? (float) number_format($value->value, 2): null)];
                        $data["data"][] = [($value->timestamp * 1000), ($value->value != null ? round($value->value, 2) : null)];
                    }
                } else {
                    foreach ($chartData["result"]->values as $key => $value) {
                        if ($chartData["result"]->unit == "MiB") {
                            $valuee = ($value->value / 1024) * 100;
                        } else {
                            $valuee = $value->value;
                        }
                        $data[] = [($value->timestamp * 1000), (float) number_format($valuee, 2)];
                    }
                }
            }
            return $data;
        } catch (\Exception $e) {
            //throw $th;
        }
    }

    public function terminateServer($location, $servertype, $ovhServerName, $accountId)
    {
        $this->baseUrl = $this->getBaseUrl($location);
        if ($servertype == "soyoustart") {
            $url = $this->baseUrl . "/dedicated/server/{$ovhServerName}/terminate";
        } else {
            $url = $this->baseUrl . "/vps/{$ovhServerName}/terminate";
        }
        $header = self::createHeader($accountId, "POST", $url);
        $response = $this->__curlCall("POST", [], $url, $header, "Terminating Server");
        return $response;
    }


    public function getpaymentdetail($params, $orderid, $payType, $pid, $serviceId, $ovhAccountData, $location)
    {
        $ovhOrderId = $orderid;
        $accountId = explode("-", $params["configoption3"])[0];

        $paymentMethods = $this->getPaymentMethods($location, $accountId, $ovhOrderId);
        if ($paymentMethods["httpcode"] != 200) {
            return $paymentMethods["result"]->message;
        }
        $gatewayID = false;
        foreach ($paymentMethods["result"]->registered as $registeredPaymentMethodId) {
            $paymentMethodDetails = $this->get("/me/payment/method/{$registeredPaymentMethodId}", $accountId, $location, "Getting Payment Methods Details(#$registeredPaymentMethodId)", $createHeader = true, $fullUrl = false);
            if ($paymentMethodDetails["httpcode"] != 200) {
                return $paymentMethodDetails["result"]->message;
            }
            if ($paymentMethodDetails["result"]->paymentType == $payType) {
                $gatewayID = $paymentMethodDetails["result"]->paymentMethodId;
                break;
            }
        }
        if (!$gatewayID) {
            return $payType . " is not activated in OVH.";
        }

        $paymentResult = $this->PayAmount($location, $accountId, $ovhOrderId, ["paymentMethod" => ["id" => $gatewayID]]);

        if ($paymentResult["httpcode"] != 200) {
            logActivity('Order #' . $ovhOrderId . ' has been placed successfully. But payment has not recieved yet.');
            return $paymentResult["result"]->message;
        }


        $orderDetail = $this->get('/me/order/' . $ovhOrderId . '/details', $ovhAccountData[0], $location, "getting order details", true);
        if ($orderDetail["httpcode"] != 200) {
            return $orderDetail["result"]->message;
        }

        if (!isset($orderDetail["result"][0])) {
            logActivity('Order #' . $ovhOrderId . ' has been placed successfully and payment has recieved. But we are not able to get the server.');
            // return $orderDetail["result"]->message;
            return "success";
        }
        $serverData = $this->get('/me/order/' . $ovhOrderId . '/details/' . $orderDetail["result"][0], $ovhAccountData[0], $location, "getting server details", true);
        if ($serverData["httpcode"] != 200) {
            return $serverData["result"]->message;
        }

        if (empty($serverData["result"]->domain)) {
            logActivity('Order #' . $ovhOrderId . ' has been placed successfully and payment has recieved. But we are not able to get the server.');
            return "success";
        }

        return $serverData;
    }


    public function PayAmount($location, $accountId, $orderId, $data)
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);
            $url = $this->baseUrl . "/me/order/{$orderId}/pay";
            $header = self::createHeader($accountId, "POST", $url, $data);
            $paymentMethods = $this->__curlCall("POST", $data, $url, $header, "Adding Payments");

            return $paymentMethods;
        } catch (\Exception $e) {
            //throw $th;
        }
    }
    public function getPaymentMethods($location, $accountId, $orderId)
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);
            $url = $this->baseUrl . "/me/order/{$orderId}/paymentMethods";
            $header = self::createHeader($accountId, "GET", $url);
            $paymentMethods = $this->__curlCall("GET", [], $url, $header, "Getting OVH payment methods");

            return $paymentMethods;
        } catch (\Exception $e) {
            //throw $th;
        }
    }
    public function getOrderStatus($location, $accountId, $orderId)
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);
            $url = $this->baseUrl . "/me/order/{$orderId}/status";
            $header = self::createHeader($accountId, "GET", $url);
            $paymentMethods = $this->__curlCall("GET", [], $url, $header, "Getting Order Status");

            return $paymentMethods;
        } catch (\Exception $e) {
            //throw $th;
        }
    }

    public function getTaskStatus($location, $accountId, $ovhServerName, $taskID)
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);
            $url = $this->baseUrl . "/dedicated/server/{$ovhServerName}/task/{$taskID}";
            $header = self::createHeader($accountId, "GET", $url);
            $response = $this->__curlCall("GET", [], $url, $header, "Getting task status");

            return $response;
        } catch (\Exception $e) {
            //throw $th;
        }
    }
    public function openImpi($location, $accountId, $ovhServerName, $data, $type = null)
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);
            if ($type == null) {
                $url = $this->baseUrl . "/dedicated/server/{$ovhServerName}/features/ipmi/access";
                $header = self::createHeader($accountId, "POST", $url, $data);
                $response = $this->__curlCall("POST", $data, $url, $header, "Opening IMPI");
            } else {
                $url = $this->baseUrl . "/dedicated/server/{$ovhServerName}/features/ipmi/access?type={$type}";
                $header = self::createHeader($accountId, "GET", $url);
                $response = $this->__curlCall("GET", [], $url, $header, "Opening IMPI");
            }

            return $response;
        } catch (\Exception $e) {
            //throw $th;
        }
    }

    public function enableDisableMonitoring($location, $accountId, $ovhServerName, $data, $type = "soyoustart")
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);
            if ($type == "soyoustart") {
                $url = $this->baseUrl . "/dedicated/server/{$ovhServerName}";
            } else {
                $url = $this->baseUrl . "/vps/{$ovhServerName}";
            }
            $header = self::createHeader($accountId, "PUT", $url, $data);
            $response = $this->__curlCall("PUT", $data, $url, $header, "Enable/Disable Monitoring");

            return $response;
        } catch (\Exception $e) {
            //throw $th;
        }
    }

    private function getBaseUrl($location)
    {
        try {
            switch (strtolower($location)) {
                case "europe":
                    $url = "https://eu.api.ovh.com/1.0";
                    break;
                case "canada":
                    // $url = "https://ca.api.ovh.com/1.0";
                    // $url = "https://ca.api.ovh.com/v1";
                    $url = "https://api.ca.ovhcloud.com/v1";
                    break;
                case "us":
                    $url = "https://api.us.ovhcloud.com/1.0";
                    break;
                case "uk":
                    $url = "https://api.ovh.com/1.0";
                    break;
                case "singapore":
                    $url = "https://api.ovh.com/1.0";
                    break;
                case "world":
                    $url = "https://api.ovh.com/1.0";
                    break;
            }

            return $url;
        } catch (\Exception $e) {
            throw new \Exception('Error while getting base url: ' . $e->getMessage());
        }
    }

    public function recuseService($location, $accountId, $ovhServerName, $data)
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);
            $url = $this->baseUrl . "/vps/{$ovhServerName}";

            $header = self::createHeader($accountId, "PUT", $url, $data);
            $response = $this->__curlCall("PUT", $data, $url, $header, "recuse reboot");

            return $response;
        } catch (\Exception $e) {
            //throw $th;
        }
    }

    public function moveIpToService($location, $accountId, $ipBlock, $serviceName)
    {
        try {

            $this->baseUrl = "https://ca.api.ovh.com/1.0";

            $ipBlock = str_contains($ipBlock, '/')
                ? $ipBlock
                : $ipBlock . "/32";

            $encodedIp = urlencode($ipBlock);

            $url = $this->baseUrl . "/ip/{$encodedIp}/move";



            $data = [
                "to" => trim($serviceName)
            ];

            $header = self::createHeader(
                $accountId,
                "POST",
                $url,
                $data
            );

            $response = $this->__curlCall(
                "POST",
                json_encode($data),
                $url,
                $header,
                "Moving IP to service"
            );

            return $response;
        } catch (\Exception $e) {

            throw new \Exception(
                'Error while moving IP to service: ' . $e->getMessage()
            );
        }
    }

    public function getIpMoveDestinations($location, $accountId, $ipBlock)
    {
        try {
            $this->baseUrl = $this->getBaseUrl($location);

            $ipBlock = str_contains($ipBlock, '/')
                ? $ipBlock
                : $ipBlock . "/32";

            $encodedIp = urlencode($ipBlock);

            $url = $this->baseUrl . "/ip/{$encodedIp}/move";

            $header = self::createHeader($accountId, "GET", $url);

            $response = $this->__curlCall("GET", [], $url, $header, "Getting IP move destinations");

            return $response;
        } catch (\Exception $e) {
            throw new \Exception('Error while getting IP destinations: ' . $e->getMessage());
        }
    }
}
