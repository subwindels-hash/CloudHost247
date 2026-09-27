<?php

namespace WGSModule\Soyoustart\classes;

require_once __DIR__ . DS . '/Configuration.php';

use WGSModule\Soyoustart\classes\Configuration;
use WHMCS\Database\Capsule;
use WHMCS\Module\Addon\Soyoustart\Helper;

class ExistingServer extends Configuration
{
    /* get all the soyoustart and soyoustart_vps servers products */
    public function getAllProducts()
    {
        try {

            return Capsule::table('tblproducts')->where('servertype', 'soyoustart')->orwhere("servertype", "soyoustart_vps")->get();
        } catch (\Illuminate\Database\QueryException $e) {
            throw new \Exception('Error while getting all products : ' . $e->getMessage());
        } catch (Exception $e) {
            throw new \Exception('Error while getting all products : ' . $e->getMessage());
        }
    }
    public function getClientProduts($clientId)
    {
        try {
            $datas = Capsule::table('tblhosting')->join('tblproducts', 'tblhosting.packageid', '=', 'tblproducts.id')->select('tblhosting.id', 'tblproducts.name', "tblhosting.packageid")->where('tblhosting.userid', $clientId)->whereIN('tblproducts.servertype', ['soyoustart', "soyoustart_vps"])->get()->toArray();
            return $this->formateData($datas);
        } catch (\Illuminate\Database\QueryException $e) {
            throw new \Exception('Error while getting all client products : ' . $e->getMessage());
        } catch (Exception $e) {
            throw new \Exception('Error while getting all client products : ' . $e->getMessage());
        }
    }


    /* 
      @param string $location 
      @return string all OVH account related to location.

    */
    public function getOvhAccounts($location)
    {
        try {
            $accounts = $this->get_data("mod_soyoustart", ["location" => $location])->toArray();

            return $this->formateData($accounts);
        } catch (\Illuminate\Database\QueryException $e) {
            throw new \Exception('Error while getting OVH accounts : ' . $e->getMessage());
        } catch (Exception $e) {
            throw new \Exception('Error while getting OVH accounts : ' . $e->getMessage());
        }
    }
    private function formateData($data)
    {

        if (!empty($data)) {
            $html = '<option value="" disabled selected>Select Service</option>';
            foreach ($data as $row) {
                $name = isset($row->name) ? $row->name : $row->account_number;
                $value = isset($row->packageid) ? $row->id . '_' . $row->packageid : $row->id . '_' . $row->account_number;
                $html .= '<option value="' . $value . '">' . $name . '</option>';
            }
        } else {
            $html = '<option value="">Not Found</option>';
        }

        return $html;
    }


    public function createOrder($Params, $apiCall)
    {
        try {

            $configOptionstionsData = [];

            foreach ($Params as $key => $value) {

                if (!in_array($key, ["token", "ovhservernameexist", "newovhCustomHostName", "userexist", "product", "payment", "billing", "location", "account", "ovhservername", "ovhCustomHostName", "invoice", "email", "newServer", "existServer"])) {
                    $data = explode("_", $value);
                    $configOptionstionsData[$data["1"]] = $data["0"];
                }
            }


            /* validating product */


            $results = $this->validateProduct($Params, $configOptionstionsData, $apiCall);

            if(isset($results["error"])){
                return $results;
            }
            
            $postData = array(
                'clientid' => $Params["userexist"],
                'pid' => $Params["product"],
                'billingcycle' => $Params["billing"],
                'paymentmethod' => $Params["payment"],
                'configoptions' => (base64_encode(serialize($configOptionstionsData))),
            );

            if (!isset($Params["invoice"])) {
                $postData["noinvoice"] = true;
            }
            if (!isset($Params["email"])) {
                $postData["noemail"] = true;
            }
            $results = localAPI("AddOrder", $postData);
            logModuleCall("Soyoustart", "AddOrder", $postData, $results);
            /* inserting ovh_account and ovh_server_name values in product custom fields */
            if ($results["result"] == "success") {
                $data = ["ovh_account" =>  explode("_", $Params["account"])["1"], "ovh_server_name" => $Params["ovhservername"], "ovh_custom_hostname" => $Params["ovhCustomHostName"]];
                $this->insert_custom_fields_values($data, $results["serviceids"], $Params["product"]);
            }


            return $results;
        } catch (Exception $e) {
            throw new \Exception('Error while creating order : ' . $e->getMessage());
        }
    }

    private function validateProduct($Params, $configOptionstionsData, $apiCall)
    {
        $helper = new Helper();
        $aclSettings = $helper->get_data("mod_acl_settings", ["key" => "generalaclSettings"], "first")->value;
        $aclSettings = !empty($aclSettings) ? json_decode($aclSettings, true) : [];

        if (isset($aclSettings["showErrorOnCart"]) && $aclSettings["showErrorOnCart"] == "on") {
            $pid = $Params["product"];
            $productDetails = $helper->get_data("tblproducts", ["id" => $pid], "first");

            $subsidiaryHost = "https://" . parse_url($productDetails->configoption4, PHP_URL_HOST) . "/";


            $ovhAccountData = explode('-', $productDetails->configoption3);
            if (count($ovhAccountData) == 4)
                unset($ovhAccountData[1]);
            $ovhAccountData = array_values($ovhAccountData);
            $location = $ovhAccountData["1"];
            $subsidiaryLocation = trim(explode("=", $productDetails->configoption4)[1]);
            $configoption2 = explode('@', $productDetails->configoption2);
            $planCode = trim($configoption2[1]);
            $productGroup = trim($configoption2[0]);
            /* checking product */
            $response = $apiCall->get(trim($productDetails->configoption4), $ovhAccountData[0], $location, "Geting Info for eco server", true, true);

            if ($response["httpcode"] != 200) {
                logActivity("Error: shopping vard validation({$response["httpcode"]->message})");
                return ["error" => $response["httpcode"]->message];
            }
            $productFound = false;
            foreach ($response["result"]->plans as $plan) {
                if ($plan->planCode === $planCode) {
                    $productFound = true;
                    break;
                }
            }

            if (!$productFound) {
                return ["error" => $response["httpcode"]->message];
            }
            // /* checking datacenter */

            $formatedData = [];
            foreach ($configOptionstionsData as $configoption => $selectedConfigoption) {
                $configOptionsDelails = $helper->get_data("tblproductconfigoptions", ["id" => $configoption], "first");
                $selectedConfigoptionDelails = $helper->get_data("tblproductconfigoptionssub", ["id" => $selectedConfigoption], "first");
                $formatedData[$configOptionsDelails->optionname] = $selectedConfigoptionDelails;
            }

            $serverLocation = explode("|", $formatedData["server_location|Server Location"]->optionname)[0];
            $memory = $this->formatMemoryString($formatedData["memory|Memory"]->optionname);
            $storage = $this->removeAfterLastHyphen($formatedData["storage|Storage"]->optionname);
            if ($productGroup == "rise") {
                $storage = str_replace("512nvme", "500nvme", $storage);
            }

            $subOptionName = $serverLocation;
            if ($productDetails->servertype == "soyoustart_vps") {
                $response = $apiCall->get("{$subsidiaryHost}engine/apiv6/vps/order/rule/datacenter?ovhSubsidiary={$subsidiaryLocation}&planCode={$planCode}", $ovhAccountData[0], $location, "Geting datacenter Info for vps server", true, true);

                if ($response["httpcode"] != 200) {
                    logActivity("Error: shopping vard validation({$response["httpcode"]->message})");
                    return ["error" => $response["httpcode"]->message];
                }
                foreach ($response["result"]->datacenters as $status) {
                    $subOptionName = strtoupper($subOptionName);
                    if ($status->datacenter == $subOptionName) {
                        if ($status->status == "unavailable" || $status->status == "out-of-stock") {
                            return ["error" => "{$subOptionName} server location is temporarily out of stock, please select another datacenter!"];
                        }
                    }
                }
            } else {
                $response = $apiCall->get("/dedicated/server/datacenter/availabilities?datacenters={$subOptionName}&excludeDatacenters=false&storage={$storage}&memory={$memory}&planCode={$planCode}&server={$planCode}", $ovhAccountData[0], $location, "Geting datacenter Info for eco server", true);
                if ($response["httpcode"] != 200) {
                    logActivity("Error: shopping vard validation({$response["httpcode"]->message})");
                    return ["error" => $response["httpcode"]->message];
                }
                $subOptionName = strtoupper($subOptionName);
                if ($response["result"]["0"]->datacenters["0"]->availability == "unavailable") {
                    return ["error" => "The combination of datacenter, memory, and storage is not available, please try with another combination!"];
                }
            }
        }
        return ["success" => true];
    }


   private function formatMemoryString($input)
    {
        preg_match('/(\d+)GB/', $input, $matches);
        $ramSize = $matches[1] . 'g';
        $ecc = strpos($input, 'ECC') !== false ? 'ecc' : '';
        preg_match('/(\d+)MHz/', $input, $matches);
        $speed = $matches[1];
        $formattedString = 'ram-' . $ramSize . '-' . $ecc . '-' . $speed;
        return $formattedString;
    }

  private function removeAfterLastHyphen($input)
    {
        $lastHyphenPos = strrpos($input, '-');
        if ($lastHyphenPos !== false) {
            return substr($input, 0, $lastHyphenPos);
        }
        return $input;
    }



    public function getProductDetails($productId)
    {
        try {
            $results = localAPI("GetProducts", ["pid" => $productId]);
            return $results;
        } catch (Exception $e) {
            throw new \Exception('Error while getting product details: ' . $e->getMessage());
        }
    }

    public function createProductCongifHtml($productDetails, $billingCycle = "monthly")
    {
        try {
            $html = '';
            $defaultCurrency = $this->get_data("tblcurrencies", ['default' => '1'], "first");
            $noPrice = ["0.00", "-1.00", ''];
            foreach ($productDetails["products"]["product"] as $product) {
                foreach ($product["configoptions"]["configoption"] as $key => $productConfigOption) {
                    if ((($key + 1) % 2) != 0) {
                        $html .= '<div class="row">';
                    }
                    $html .= '<div class="col-md-6">
                            <div class="form-group">';
                    if ($productConfigOption["type"] == 2) {

                        $html .= '<label for="server">' . $productConfigOption["name"] . '</label>';

                        foreach ($productConfigOption["options"]["option"] as $optionDetailsKey => $optionDetails) {
                            $price = $optionDetails["pricing"][$defaultCurrency->code][$billingCycle];
                            $price = ((in_array($price, $noPrice)) ? null : $defaultCurrency->prefix . $price . $defaultCurrency->suffix);
                            $html .= '<input type="radio" ' . ($optionDetailsKey == 0 ? "checked" : "") . ' id="' . $optionDetails["required"] . $optionDetails["id"] . '" name="' . $productConfigOption["name"] . '" value="' . $optionDetails["id"] . '_' . $productConfigOption["id"] . '">
                           <label for="' . $optionDetails["required"] . $optionDetails["id"] . '" class="radio-inline">' . $optionDetails["name"] . ' ' . $price . '</label></br>';
                        }
                        $html .= '</div>
                        </div>';
                    } elseif ($productConfigOption["type"] == 1) {
                        $html .= '<label for="server">' . $productConfigOption["name"] . '</label>
                        <select name="' . $productConfigOption["name"] . '" class="form-control" id="' . str_replace(" ", "_", $productConfigOption["name"]) . '">';

                        foreach ($productConfigOption["options"]["option"] as $optionDetailsKey => $optionDetails) {
                            $price = $optionDetails["pricing"][$defaultCurrency->code][$billingCycle];
                            $price = ((in_array($price, $noPrice)) ? null : $defaultCurrency->prefix . $price . $defaultCurrency->suffix);
                            $html .= '<option value="' . $optionDetails["id"] . '_' . $productConfigOption["id"] . '">' . $optionDetails["name"] . $price . ' ' . '</option>';
                        }
                        $html .= '
                        </select>
                        </div>
                        </div>';
                    } elseif ($productConfigOption["type"] == 3) {
                        $html .= '<label for="server">' . $productConfigOption["name"] . '</label>';
                        foreach ($productConfigOption["options"]["option"] as $optionDetailsKey => $optionDetails) {
                            $price = $optionDetails["pricing"][$defaultCurrency->code][$billingCycle];
                            $price = ((in_array($price, $noPrice)) ? null : $defaultCurrency->prefix . $price . $defaultCurrency->suffix);
                            $html .= '<input type="checkbox" id="' . $optionDetails["id"] . '" name="' . $optionDetails["name"] . '" value="' . $optionDetails["id"] . '_' . $productConfigOption["id"] . '">
                           <label for="' . $optionDetails["id"] . '" class="radio-inline">' . $optionDetails["name"] . ' ' . $price . '</label></br>';
                        }
                        $html .= '</div>
                        </div>';
                    }
                    if ((($key + 1) % 2) == 0) {
                        $html .= '</div>';
                    }
                }
            }
            return $html;
        } catch (Exception $e) {
            throw new \Exception('Error while creating product configuration html: ' . $e->getMessage());
        }
    }


    public function insert_custom_fields_values($customFieldNames, $serviceid, $package_id)
    {
        try {
            // $custom_field_names = ["ovh_account" => $data["ovh_account"], "ovh_server_name" => $data["ovh_server_name"]];

            foreach ($customFieldNames as $key => $value) {
                $custom_field_data = Capsule::table('tblcustomfields')->where("type", "product")->where("fieldname", "like", "%$key%")->where("relid", $package_id)->first();

                if ($custom_field_data) {
                    $field_value = Capsule::table('tblcustomfieldsvalues')->where("fieldid", "=", $custom_field_data->id)->where("relid", "=", $serviceid)->first();
                    /* checking field value exist */
                    if ($field_value->id) {
                        /* updating */
                        $field_value = Capsule::table('tblcustomfieldsvalues')->where("fieldid", "=", $custom_field_data->id)->where("relid", "=", $serviceid)->update(["value" => $value]);
                    } else {
                        /* inserting */
                        $field_value = Capsule::table('tblcustomfieldsvalues')->insert(["fieldid" => $custom_field_data->id, "relid" => $serviceid, "value" => $value]);
                    }
                }
            }

            return "success";
        } catch (\Exception $e) {
            logActivity('funtion(insert_custom_fields_value) Error:', $e->getMessage());
        }
    }
}
