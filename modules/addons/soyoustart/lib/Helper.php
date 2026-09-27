<?php
namespace WHMCS\Module\Addon\Soyoustart;

use BadFunctionCallException;
use WHMCS\Database\Capsule;
if (!defined("WHMCS")) {
    exit("This file cannot be accessed directly");
}
class Helper
{
    public $secretKey = "encryptionKey1234567891234567";
    public $iv = "1234567891011121";
    public $url, $apiKey, $endPoint, $action, $curl;
    public $method = "GET";
    public $postdata = [];
    public $header = [];
    public $last_request = [];
    public $data_type = "http_build_query";
    public function getData($tableName, $condition = false)
    {
        if ($condition && $condition != null) {
            $results = Capsule::table($tableName)->where("id", "=", $condition)->first();
        } else {
            $results = Capsule::table($tableName)->get();
        }
        return $results;
    }
    public function insertData($tableName, $data)
    {
        try {
            /* checking same combination of server and servertype exist. */
            $results = self::get_data($tableName, ["server" => "OVH", "servertype" => $data["servertype"]], "first");
            if (!empty($results)) {
                $message = "you can't add same combination of server and server type!";
                return $message;
            } else {
                return Capsule::table($tableName)->insert($data);
            }
        } catch (\Illuminate\Database\QueryException $ex) {
            return $ex->getMessage();
        } catch (Exception $e) {
            return $e->getMessage();
        }
    }
    public function deleteData($tableName, $id)
    {
        try {
            return Capsule::table($tableName)->where('id', '=', $id)->delete();
        } catch (Exception $e) {
            echo $e->getMessage();
        }
    }
    public function updatePricesSetting($tableName, $id, $data)
    {
        try {
            /* checking same combination of server and servertype exist. */
            $results = Capsule::table($tableName)->where(["server" => "OVH", "servertype" => $data["servertype"]])->where("id", "!=", $id)->first();
            if (!empty($results)) {
                $message = "you can't update with same combination of server and server type!";
                return ["exist" => true, "message" => $message];
            } else {
                Capsule::table($tableName)->where("id", $id)->update($data);
                return ["exist" => false, "message" => "Price setting Updated successfully!"];
            }
        } catch (Exception $e) {
            return $e->getMessage();
        }
    }
    /* 
        @param $table_name = table name.
        @param $where = where condition in associative array if any.
        @param $data = data to insert/update in associative array.
    */
    public function insert_update($table_name = '', $where = [], $data = null, $acc = null)
    {
        try {
            $row = Capsule::table($table_name)->where($where)->first();
            if (is_null($row)) {
                Capsule::table($table_name)->insert($data);
                return "Data has been inserted successfully!";
            } else {
                unset($data["name"]);
                // $data = ;
                Capsule::table($table_name)->where($where)->update($data);
                return "Data has been updated successfully!";
            }
        } catch (\Illuminate\Database\QueryException $e) {
            throw new \Exception('Error in inserting/updating data: ' . $e->getMessage());
        } catch (Exception $e) {
            throw new \Exception('Error in inserting/updating data: ' . $e->getMessage());
        }
    }

    public function updateOrCreateGetId($table_name = '', $where = [], $data = null)
    {
        try {
            $row = Capsule::table($table_name)->where($where)->first();
            if (is_null($row)) {
                return Capsule::table($table_name)->insertGetId($data);
            }

            if (isset($row->configoption3) && isset($data['configoption3']) && $row->configoption3 !== $data['configoption3']) {
                $already = Capsule::table("tblproducts")->where("slug", "LIKE", $data['slug'] . '%')->where("configoption3", $data['configoption3'])->first();
                if($already) {
                    Capsule::table($table_name)->where($where)->update($data);
                    return $already->id;
                } else {
                    $acId = explode('-', $data['configoption3'], 2)[0];
                    $data['slug'] = $data['slug'] . '-' . $acId;
                    return Capsule::table($table_name)->insertGetId($data);
                }
            }
            Capsule::table($table_name)->where($where)->update($data);
            return $row->id;
        } catch (\Illuminate\Database\QueryException $e) {
            throw new \Exception('Error in inserting/updating data: ' . $e->getMessage());
        } catch (\Exception $e) {
            throw new \Exception('Error in inserting/updating data: ' . $e->getMessage());
        }
    }

    public function getProductSlug($id) {
        try {
            return Capsule::table("tblproducts")->where("id", $id)->value("slug");
        } catch (\Illuminate\Database\QueryException $e) {
            throw new \Exception('Error to get the product slug. Error: ' . $e->getMessage());
        } catch (\Exception $e) {
            throw new \Exception('Error to get the product slug. Error: ' . $e->getMessage());
        }
    }

    public function get_data($table_name = '', $where = [], $limit = null)
    {
        try {
            $query = Capsule::table($table_name);
            if (!empty($where)) {
                $query->where($where);
            }
            if ($limit == "first") {
                return $query->first();
            }
            return $query->get();
        } catch (\Exception $e) {
            throw new \Exception('Error retrieving data: ' . $e->getMessage());
        }
    }
    public function checkWebMailConn($data = [])
    {
        try {
            if (!function_exists('imap_open')) {
                return ("Error: IMAP extension is not enabled. Please enable it in your PHP configuration.");
            }
            if (!empty($data['portnumber'])) {
                $port = $data['portnumber'];
            } else {
                $port = 143;
            }
            if ($data['ssltype'] == 'tls' || $data['ssltype'] == 'default') {
                $layer = 'tls';
            } else {
                $layer = 'ssl';
            }
            $certvalidate = 'novalidate-cert';
            $url = '{' . $data['hostname'] . ':' . $port . '/imap/' . $layer . '/' . $certvalidate . '}INBOX';
            $inbox = \imap_open($url, $data['username'], $data['password']);
            if ($inbox) {
                imap_close($inbox);
                return "Connection success!";
            } else {
                return imap_last_error();
            }
        } catch (\Exception $e) {
            return $e->getMessage();
        }
    }
    public function cronConfigStatus($crondirpath)
    {
        $cronFileName = [
            "emailSendcronstatus" => "emailSend",
            "getServercronstatus" => "getServer",
            "priceSynccronstatus" => "priceSync",
            "getIpCronstatus" => "getIp"
        ];
        $configStatus = [];
        foreach ($cronFileName as $key => $value) {
            $response = $this->get_data("tblconfiguration", ['setting' => $key], "first");
            //  Capsule::table('tblconfiguration')->where('setting', $key)->count();
            if (!file_exists($crondirpath . $value . '.php')) {
                $configStatus[$key] = ["response" => $response, "status" => "Not Configured"];;
            } elseif (!isset($response->id)) {
                $configStatus[$key] = ["response" => $response, "status" => "Not Configured"];
            } else {
                $configStatus[$key] =  ["response" => $response, "status" => "Configured", "dateTime" => $this->getTimeDiff($response->updated_at)];
            }
        }
        return $configStatus;
    }
    public function getTimeDiff($date)
    {
        $date1 = new \DateTime($date);
        $date2 = new \DateTime();
        // Calculate the difference
        $interval = $date1->diff($date2);
        // Build the output string based on non-zero intervals
        $output = '';
        if ($interval->y) {
            $output .= $interval->y . ' year' . ($interval->y > 1 ? 's' : '') . ', ';
        }
        if ($interval->m) {
            $output .= $interval->m . ' month' . ($interval->m > 1 ? 's' : '') . ', ';
        }
        if ($interval->d) {
            $output .= $interval->d . ' day' . ($interval->d > 1 ? 's' : '') . ', ';
        }
        if ($interval->h) {
            $output .= $interval->h . ' hour' . ($interval->h > 1 ? 's' : '') . ', ';
        }
        if ($interval->i) {
            $output .= $interval->i . ' minute' . ($interval->i > 1 ? 's' : '') . ', ';
        }
        if ($interval->s) {
            $output .= $interval->s . ' second' . ($interval->s > 1 ? 's' : '') . ', ';
        }
        $output = rtrim($output, ', ');
        return ($output ?: '0 seconds');
    }
    public function getConfigOptions($productId)
    {
        $currency = Capsule::table("tblcurrencies")->get();
        $getconfiggroupslink = Capsule::table("tblproductconfiglinks")->where("pid", $productId)->get();
        $productconfigDetails = [];
        foreach ($getconfiggroupslink as $configgroupslinkkey => $configgroupslinkvalue) {
            $getlinkoption = Capsule::table("tblproductconfigoptions")->where("gid", $configgroupslinkvalue->gid)->get();
            $getlinkoption = $getlinkoption->toArray();
            // 
            foreach ($getlinkoption as $getlinkoptionkey => $getlinkoptionvalue) {
                $productconfigDetails[$getlinkoptionvalue->optionname] = $getlinkoptionvalue;
                $getlinkoptionsub = capsule::table("tblproductconfigoptionssub")->where("configid", $getlinkoptionvalue->id)->get();
                $getlinkoptionsub = $getlinkoptionsub->toArray();
                $productconfigDetails[$getlinkoptionvalue->optionname]->productconfigoptionssub = $getlinkoptionsub;
                // config pricing
                foreach ($productconfigDetails[$getlinkoptionvalue->optionname]->productconfigoptionssub as $configoptionssub_key => $configoptionssub_value) {
                    foreach ($currency as $key => $value) {
                        $productconfigDetails[$getlinkoptionvalue->optionname]->productconfigoptionssub[$configoptionssub_key]->prices[$value->code] = Capsule::table("tblpricing")->where("type", "configoptions")->where("relid", $configoptionssub_value->id)->where("currency", $value->id)->first();
                    }
                }
            }
        }
        return $productconfigDetails;
    }
    public function updateProductPrices($data = [], $productId = false)
    {
        try {
            // update product name
            $productname = Capsule::table("tblproducts")->where("id", $productId)->update(["name" => $data['productname']]);
            //update product price 
            foreach ($data['price'] as $key => $price) {
                $updateprice = Capsule::table("tblpricing")->where("type", "product")->where("relid", $productId)->where("currency", $key)->update(["monthly" => $price[0], "annually" => $price[1], "biennially" => $price[2]]);
            }
            // update config option  name
            foreach ($data['optionname'] as $key => $value) {
                $updateoptionname = Capsule::table('tblproductconfigoptionssub')->where("id", $key)->update(["optionname" => $value]);
            }
            // update config price name 
            foreach ($data['configprice'] as $currency => $configprice) {
                foreach ($configprice as $id => $value) {
                    $updateprice = Capsule::table("tblpricing")->where("type", "configoptions")->where("relid", $id)->where("currency", $currency)->update(["monthly" => $value[0], "annually" => $value[1], "biennially" => $value[2]]);
                }
            }
            return true;
        } catch (\Exception $e) {
            //throw $th;
            return $e->getMessage();
        }
    }
    public function getAccountName()
    {
        try {
            $accuntNames = [];
            foreach (Capsule::table('tbl_soyoustart')->get() as $key => $value) {
                $accuntNames[] = $value->id . "-" . ucfirst($value->api_service_provider) . "-" . ucfirst($value->service_location) . "-" . $value->account_number;
            }
            return $accuntNames;
        } catch (\Exception $e) {
            //throw $th;
            return $e->getMessage();
        }
    }
    public function getproductgroup($data, $configuration)
    {
        $locationname = $data['account'];
        $locationexplode = explode("-", $locationname);
        $string = trim(preg_replace('/\s+/', '', $locationexplode[2]));
        $groupItems = '';
        if ($data['modulename'] == "soyoustart" && $data['locationtype'] == "Ovh") {
            $groupName = $configuration->ovhProductGroup("DEDICATED");
            foreach ($groupName as $key => $value) {
                $groupItems .= '<option value="' . $key . '" id="' . $key . '">' . $value . '</option>';
            }
        } elseif ($data['modulename'] == "soyoustart_vps" && $data['locationtype'] == "Ovh") {
            $groupName = $configuration->ovhProductGroup("VPS");
            if ($string == '') {
                $groupItems .= '<option value="">product is not available</option>';
            } else {
                foreach ($groupName as $key => $value) {
                    $groupItems .= '<option value="' . $key . '" id="' . $key . '">' . $value . '</option>';
                }
            }
        } elseif ($data['modulename'] == "soyoustart_eco" && $data['locationtype'] == "Ovh") {
            $groupName = $configuration->ovhProductGroup("ECO_DIDICATED");
            foreach ($groupName as $key => $value) {
                $groupItems .= '<option value="' . $key . '" id="' . $key . '">' . $value . '</option>';
            }
        }
        return $groupItems;
    }
    public function getProducts($data, $configuration)
    {
        try {
            $ovhgroupname = $data['ovhgroupname'];
            $subsidiary = explode("=", $data['ovhsubsidiarytype'])[1] ?? '';
            if ($data['modulename'] == "soyoustart" && $data['locationtype'] == "Ovh") {
                $availableProducts = $configuration->getAvailableProducts("Dedicated", $subsidiary);
                // echo"<pre>";
                // print_r($availableProducts);
                // die;
                $url = $data['locationurl'];
                // getting products from api
                $arrData = self::getProductApiRequest($url);
                $count = 0;
                $productoption = '';
                $productoption .= '<td><table width="100%"><tr>';
                $productsFamily = array();
                foreach ($arrData->plans as $products) {
                    $checked = 'checked';
                    $toltip = '';
                    $disabled = '';
                    if (Capsule::table('tblproducts')->where("configoption2", "LIKE", "%@" . $products->planCode)->value('name') != "") {
                        $toltip = '<small class="productCretaedNote" data-hideproducts="' . $products->planCode . '">Product is already created</small>';
                        // $toltip = '<span class="form-icon"><i class="fa fa-question-circle" title="Product is already created"></i></span>';
                        $checked = '';
                    }
                    if (!in_array($products->planCode, $availableProducts)) {
                        $toltip .= '<small style="color: red; margin-left: 13px;font-size: 13px;">This plan has been deprecated at OVH.</small>';
                        $disabled = 'disabled';
                        $checked = '';
                    }
                    if ($ovhgroupname == "scale") {
                        if (!in_array($products->planCode, (array) $productsFamily["scale"])) {
                            if ($this->getStringsContainingGroupName($products->planCode, "scale")) {
                                $productsFamily["scale"][] = $products->planCode;
                                $count++;
                                $planlocation = explode("-", $products->planCode);
                                $productoption .= '<td class="fieldlabel" width="15%">
                                                <input type="checkbox" name="productcheck[]" style="margin-right: 10px;"  value="' . $products->planCode . '" ' . $checked . ' id="' . $products->planCode . '"' . $disabled . ' >
                                                <label for="' . $products->planCode . '">Product ' . $count . '</label>
                                                </td>
                                    <td class="fieldarea" >
                                        <input type="text" ' . $disabled . ' name="' . $products->planCode . '" value="' . $products->invoiceName . " " . strtoupper($planlocation[1]) . '" class="form-control input-250" >' . $toltip . '
                                    </td>';
                                if (($count % 2) == 0) {
                                    $productoption .= '</tr><tr>';
                                }
                            }
                        }
                    } else if ($ovhgroupname == "game") {
                        if (!in_array($products->planCode, (array) $productsFamily["game"])) {
                            if ($products->blobs->commercial->features[0]->value == "gaming") {
                                $productsFamily["game"][] = $products->planCode;
                                $count++;
                                $planlocation = explode("-", $products->planCode);
                                $productoption .= '<td class="fieldlabel" width="15%">
                                                <input ' . $disabled . ' type="checkbox" name="productcheck[]" style="margin-right: 10px;" value="' . $products->planCode . '" ' . $checked . ' id="' . $products->planCode . '"> <label for="' . $products->planCode . '">Product ' . $count . '</label></td>
                                    <td class="fieldarea" >
                                        <input type="text" ' . $disabled . ' name="' . $products->planCode . '" value="' . $products->invoiceName . " " . strtoupper($planlocation[1]) . '" class="form-control input-250" >' . $toltip . '
                                    </td>';
                                if (($count % 2) == 0) {
                                    $productoption .= '</tr><tr>';
                                }
                            }
                        }
                    } elseif ($ovhgroupname == "fs") {
                        if (!in_array($products->planCode, (array) $productsFamily["fs"])) {
                            if ($this->getStringsContainingGroupName($products->planCode, "store")) {
                                $productsFamily["fs"][] = $products->planCode;
                                $count++;
                                $planlocation = explode("-", $products->planCode);
                                $productoption .= '<td class="fieldlabel" width="15%">
                                                <input type="checkbox" ' . $disabled . ' name="productcheck[]" style="margin-right: 10px;" value="' . $products->planCode . '" ' . $checked . ' id="' . $products->planCode . '"> <label for="' . $products->planCode . '">Product ' . $count . '</label></td>
                                    <td class="fieldarea" >
                                        <input type="text" ' . $disabled . ' name="' . $products->planCode . '" value="' . $products->invoiceName . " " . strtoupper($planlocation[1]) . '" class="form-control input-250" >' . $toltip . '
                                    </td>';
                                if (($count % 2) == 0) {
                                    $productoption .= '</tr><tr>';
                                }
                            }
                        }
                    } elseif ($ovhgroupname == "rise" || $ovhgroupname == "advance") {
                        $groupname = ($ovhgroupname == "advance" ? "adv" : $ovhgroupname);
                        if (!in_array($products->planCode, (array) $productsFamily[$groupname])) {
                            if ($this->getStringsContainingGroupName($products->planCode, $groupname)) {
                                $productsFamily[$groupname][] = $products->planCode;
                                $count++;
                                $planlocation = explode("-", $products->planCode);
                                $productoption .= '<td class="fieldlabel" width="15%">
                                                <input  type="checkbox" ' . $disabled . ' name="productcheck[]" style="margin-right: 10px;" value="' . $products->planCode . '" ' . $checked . ' id="' . $products->planCode . '"> <label for="' . $products->planCode . '">Product ' . $count . '</label></td>
                                    <td class="fieldarea" >
                                        <input type="text" ' . $disabled . ' name="' . $products->planCode . '" value="' . $products->invoiceName . " " . strtoupper($planlocation[1]) . '" class="form-control input-250" >' . $toltip . '
                                    </td>';
                                if (($count % 2) == 0) {
                                    $productoption .= '</tr><tr>';
                                }
                            }
                        }
                    } elseif ($ovhgroupname == "hgr") {
                        if (!in_array($products->planCode, (array) $productsFamily[$products->blobs->commercial->range])) {
                            $productsFamily[$products->blobs->commercial->range][] = $products->planCode;
                            if ($products->blobs->commercial->range == $ovhgroupname) {
                                $count++;
                                $planlocation = explode("-", $products->planCode);
                                $productoption .= '<td class="fieldlabel" width="15%">
                                                <input type="checkbox" ' . $disabled . '  name="productcheck[]" style="margin-right: 10px;" value="' . $products->planCode . '" ' . $checked . ' id="' . $products->planCode . '"> <label for="' . $products->planCode . '">Product ' . $count . '</label></td>
                                    <td class="fieldarea" >
                                        <input type="text" ' . $disabled . ' name="' . $products->planCode . '" value="' . $products->invoiceName . " " . strtoupper($planlocation[1]) . '" class="form-control input-250" >' . $toltip . '
                                    </td>';
                                if (($count % 2) == 0) {
                                    $productoption .= '</tr><tr>';
                                }
                            }
                        }
                    } else {
                        if (in_array($ovhgroupname, ["other", "others"])) {
                            $groupName = $configuration->ovhProductGroup("DEDICATED");
                            if (!array_key_exists(strtolower($products->blobs->commercial->range), $groupName) && !empty($products->blobs->commercial->range)) {
                                $count++;
                                $productoption .= '<td class="fieldlabel" width="15%">
                                    <input type="checkbox" ' . $disabled . ' name="productcheck[]" style="margin-right: 10px;" value="' . $products->planCode . '" ' . $checked . ' id="' . $products->planCode . '"> <label for="' . $products->planCode . '">Product ' . $count . '</label></td>
                                        <td class="fieldarea" >
                                            <input type="text" ' . $disabled . ' name="' . $products->planCode . '" value="' . $products->invoiceName . '" class="form-control input-250" >' . $toltip . '
                                        </td>';
                                if (($count % 2) == 0) {
                                    $productoption .= '</tr><tr>';
                                }
                            }
                        } elseif (!in_array($products->planCode, (array) $productsFamily[$products->blobs->commercial->range])) {
                            $productsFamily[$products->blobs->commercial->range][] = $products->planCode;
                            if ($products->blobs->commercial->range == $ovhgroupname) {
                                $count++;
                                $planlocation = explode("-", $products->planCode);
                                $productoption .= '<td class="fieldlabel" width="15%">
                                                <input type="checkbox" ' . $disabled . ' name="productcheck[]" style="margin-right: 10px;" value="' . $products->planCode . '" ' . $checked . ' id="' . $products->planCode . '"> <label for="' . $products->planCode . '">Product ' . $count . '</label></td>
                                    <td class="fieldarea" >
                                        <input type="text" ' . $disabled . ' name="' . $products->planCode . '" value="' . $products->invoiceName . " " . strtoupper($planlocation[1]) . '" class="form-control input-250" >' . $toltip . '
                                    </td>';
                                if (($count % 2) == 0) {
                                    $productoption .= '</tr><tr>';
                                }
                            }
                        }
                    }
                }
                if (!$count) {
                    $productoption .= '<td class="productNotFound">Product is not available!</td>';
                }
                $productoption .= '</tr></table></td>';
            } elseif ($data['modulename'] == "soyoustart_vps" && $data['locationtype'] == "Ovh") {
                $availableProducts = $configuration->getAvailableProducts("VPS", $subsidiary);
                $url = $data['locationurl'];
                $locationexplode = explode("=", $url);
                $string = trim($locationexplode[1]);
                // getting products from api
                $arrData = self::getProductApiRequest($url);
                $count = 0;
                $productoption = '';
                $productoption .= '<td><table width="100%"><tr>';
                $productsFamily = array();
                //if($string == 'US'){
                if ($string == '') {
                    $productoption .= '<td class="fieldarea" style="color:red;text-align: center;">Product is not available</td></tr>';
                } elseif ($string == 'CZ' || $string == 'EU' || $string == 'FI' || $string == 'LT') {
                    $productoption .= '<td class="fieldarea" style="color:red;text-align: center;">Product is not available</td></tr>';
                } else {
                    foreach ($arrData->plans as $products) {
                        $checked = 'checked';
                        $toltip = '';
                        $disabled = '';
                        if (Capsule::table('tblproducts')->where("configoption2", "LIKE", "%@" . $products->planCode)->value('name') != "") {
                            $toltip .= '<small class="productCretaedNote" data-hideproducts="' . $products->planCode . '">Product is already created</small >';
                            $checked = '';
                        }
                        if (!empty($availableProducts) && !in_array($products->planCode, $availableProducts)) {
                            $toltip .= '<small style="color: red; margin-left: 13px;font-size: 13px;">This plan has been deprecated at OVH.</small>';
                            $disabled = 'disabled';
                            $checked = '';
                        }
                        if (@!in_array($products->invoiceName, (array) $productsFamily[$products->blobs->commercial->range]) && !str_contains($products->planCode, ".")) {
                            
                            if (in_array($ovhgroupname, ["other", "others"]) ) {
                                $groupName = $configuration->ovhProductGroup("VPS");
                                if (!array_key_exists(strtolower($products->blobs->commercial->range), $groupName) && !empty($products->blobs->commercial->range) && $products->planCode == $products->product) {
                                    $productsFamily[$products->blobs->commercial->range][] = $products->invoiceName;
                                    $count++;
                                    $productoption .= '<td class="fieldlabel" width="15%">
                                        <input type="checkbox" name="productcheck[]" style="margin-right: 10px;" value="' . $products->planCode . '" ' . $checked . ' id="' . $products->planCode . '" ' . $disabled . '> <label for="' . $products->planCode . '">Product ' . $count . '</label></td>
                                            <td class="fieldarea" >
                                                <input type="text" name="' . $products->planCode . '" value="' . $products->invoiceName . '" ' . $disabled . ' class="form-control input-250" >' . $toltip . '
                                            </td>';
                                    if (($count % 2) == 0) {
                                        $productoption .= '</tr><tr>';
                                    }
                                }
                            } elseif ($products->blobs->commercial->range == ucfirst($ovhgroupname)) {
                                 $productsFamily[$products->blobs->commercial->range][] = $products->invoiceName;
                                $count++;
                                $productoption .= '<td class="fieldlabel" width="15%">
                                    <input type="checkbox" name="productcheck[]" style="margin-right: 10px;" value="' . $products->planCode . '" ' . $checked . ' id="' . $products->planCode . '" ' . $disabled . '> <label for="' . $products->planCode . '">Product ' . $count . '</label></td>
                                        <td class="fieldarea" >
                                            <input type="text" name="' . $products->planCode . '" value="' . $products->invoiceName . '" ' . $disabled . ' class="form-control input-250" >' . $toltip . '
                                        </td>';
                                if (($count % 2) == 0) {
                                    $productoption .= '</tr><tr>';
                                }
                            }
                        }
                    }
                }
                if (!$count) {
                    $productoption .= '<td class="productNotFound">Product is not available!</td>';
                }
                $productoption .= '</tr></table></td>';
            } elseif ($data['modulename'] == "soyoustart_eco" && $data['locationtype'] == "Ovh") {
                $url = $data['locationurl'];
                // getting products from api
                $arrData = self::getProductApiRequest($url);
                $count = 0;
                $productoption = '';
                $productoption .= '<td><table width="100%" ><tr>';
                $productsFamily = array();
                foreach ($arrData->plans as $products) {
                    $checked = 'checked';
                    $toltip = '';
                    if (Capsule::table('tblproducts')->where("configoption2", "LIKE", "%@" . $products->planCode)->value('name') != "") {
                        $toltip = '<small class="productCretaedNote">Product is already created</small>';
                        $checked = '';
                    }
                    if (in_array($ovhgroupname, ["other", "others"])) {
                        $groupName = $configuration->ovhProductGroup("ECO_DIDICATED");
                        if (!array_key_exists(strtolower($products->blobs->commercial->range), $groupName) && !empty($products->blobs->commercial->range)) {
                            $count++;
                            $productoption .= '<td class="fieldlabel" width="15%">
                                <input type="checkbox" name="productcheck[]" style="margin-right: 10px;" value="' . $products->planCode . '" ' . $checked . ' id="' . $products->planCode . '"> <label for="' . $products->planCode . '">Product ' . $count . '</label></td>
                                    <td class="fieldarea" >
                                        <input type="text" name="' . $products->planCode . '" value="' . $products->invoiceName . '" class="form-control input-250" >' . $toltip . '
                                    </td>';
                            if (($count % 2) == 0) {
                                $productoption .= '</tr><tr>';
                            }
                        }
                    } elseif ($ovhgroupname == "rise") {
                        if (!in_array($products->planCode, (array) $productsFamily[$ovhgroupname])) {
                            if ($this->getStringsContainingGroupName($products->planCode, $ovhgroupname)) {
                                $productsFamily[$ovhgroupname][] = $products->planCode;
                                $count++;
                                $planlocation = explode("-", $products->planCode);
                                $productoption .= '<td class="fieldlabel" width="15%">
                                                <input type="checkbox" name="productcheck[]" style="margin-right: 10px;" value="' . $products->planCode . '" ' . $checked . ' id="' . $products->planCode . '"> <label for="' . $products->planCode . '">Product ' . $count . '</label></td>
                                    <td class="fieldarea" >
                                        <input type="text" name="' . $products->planCode . '" value="' . $products->invoiceName . " " . strtoupper($planlocation[1]) . '" class="form-control input-250" >' . $toltip . '
                                    </td>';
                                if (($count % 2) == 0) {
                                    $productoption .= '</tr><tr>';
                                }
                            }
                        }
                    } elseif ($ovhgroupname == "kimsufi") {
                        if (!in_array($products->planCode, (array) $productsFamily[$ovhgroupname])) {
                            if ($this->getStringsContainingGroupName($products->planCode, "sk")) {
                                $productsFamily[$ovhgroupname][] = $products->planCode;
                                $count++;
                                $planlocation = explode("-", $products->planCode);
                                $productoption .= '<td class="fieldlabel" width="15%">
                                                <input type="checkbox" name="productcheck[]" style="margin-right: 10px;" value="' . $products->planCode . '" ' . $checked . ' id="' . $products->planCode . '"> <label for="' . $products->planCode . '">Product ' . $count . '</label></td>
                                    <td class="fieldarea" >
                                        <input type="text" name="' . $products->planCode . '" value="' . $products->invoiceName . " " . strtoupper($planlocation[1]) . '" class="form-control input-250" >' . $toltip . '
                                    </td>';
                                if (($count % 2) == 0) {
                                    $productoption .= '</tr><tr>';
                                }
                            }
                        }
                    } elseif (!in_array($products->planCode, (array) $productsFamily[$ovhgroupname])) {
                        // echo $products->planCode . "<br>";
                        // exit
                        if ($this->getStringsContainingGroupName($products->invoiceName, $ovhgroupname)) {
                            $productsFamily[$ovhgroupname][] = $products->planCode;
                            $count++;
                            $planlocation = explode("-", $products->planCode);
                            $productoption .= '<td class="fieldlabel" width="15%">
                                            <input type="checkbox" name="productcheck[]" style="margin-right: 10px;" value="' . $products->planCode . '" ' . $checked . ' id="' . $products->planCode . '"> <label for="' . $products->planCode . '">Product ' . $count . '</label></td>
                                <td class="fieldarea" >
                                    <input type="text" name="' . $products->planCode . '" value="' . $products->invoiceName . " " . strtoupper($planlocation[1]) . '" class="form-control input-250" >' . $toltip . '
                                </td>';
                            if (($count % 2) == 0) {
                                $productoption .= '</tr><tr>';
                            }
                        }
                    }
                }
                if (!$count) {
                    $productoption .= '<td class="productNotFound">Product is not available!</td>';
                }
                $productoption .= '</tr></table></td>';
            }
            return $productoption;
        } catch (\Exception $e) {
            throw new \Exception('Error while getting all products : ' . $e->getMessage());
        }
    }
    public function getStringsContainingGroupName($string, $groupName)
    {
        $groupName = ($groupName == "advance" ? "adv" : $groupName);
        if ($groupName == "store" && str_contains($string, "stor")) {
            return true;
        } elseif ($groupName == "sk" && str_contains($string, "sk")) {
            return true;
        } elseif ($groupName == "soyoustart" && str_contains($string, "SYS-")) {
            return true;
        } elseif (preg_match('/^\d+' . $groupName . '[a-z]+\d+(-[a-z0-9-]+)?$/i', $string)) {
            return true;
        }
        return false;
    }
    public function getProductApiRequest($url)
    {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
        curl_setopt($ch, CURLOPT_HEADER, 0);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, 0);
        $jsonData = curl_exec($ch);
        curl_close($ch);
        return json_decode($jsonData);
    }
    public function deleteConfigOptions($chkGroup02, $createnewproductid)
    {
        try {
            $groupID = $chkGroup02->id;
            // Capsule::table('tblproductconfiglinks')->where('gid', $groupID)->where('pid', $createnewproductid)->delete();
            /* deleting productconfiglinks */
            $this->delete("tblproductconfiglinks", ['gid' => $groupID, 'pid', $createnewproductid]);
            $configoptions = Capsule::table('tblproductconfigoptions')->select('id')->where('gid', $groupID)->get();
            foreach ($configoptions as $configoptionRow) {
                $subconfigoptions = Capsule::table('tblproductconfigoptionssub')->select('id')->where('configid', $configoptionRow->id)->get();
                foreach ($subconfigoptions as $subconfigoptionRow) {
                    $this->delete("tblpricing", ['type' => "configoptions", 'relid', $subconfigoptionRow->id]);
                }
                $this->delete("tblproductconfigoptionssub", ['configid' => $configoptionRow->id]);
            }
            $this->delete("tblproductconfigoptions", ['gid' => $groupID]);
        } catch (\Exception $e) {
            return $e->getMessage();
        }
    }
    public function setproductconfig($products, $request, $configrequest)
    {
        $productsvalue = array();
        foreach ($products->$request as $product) {
            if ($product->name == $configrequest) {
                if ($request == 'addonFamilies') {
                    foreach ($product->addons as $values) {
                        if (!in_array($values, $productsvalue)) {
                            $productsvalue[] = $values;
                        }
                    }
                } else {
                    foreach ($product->values as $values) {
                        if (!in_array($values, $productsvalue)) {
                            $productsvalue[] = strtolower($values);
                        }
                    }
                }
            }
        }
        return $productsvalue;
    }
    public function selectData($tableName = '', $where = [])
    {
        try {
            if (!empty($where)) {
                $result = Capsule::table($tableName)->where($where)->get();
                $result = $result->toArray();
            } else {
                $result = Capsule::table($tableName)->get();
                $result = $result->toArray();
            }
            return $result;
        } catch (\Exception $e) {
            return $e->getMessage();
        }
    }
    public function delete($tableName = '', $where = [])
    {
        try {
            if (!empty($where)) {
                $result = Capsule::table($tableName)->where($where)->delete();
            } else {
                $result = Capsule::table($tableName)->delete();
            }
            return $result;
        } catch (\Exception $e) {
            throw new \Exception('Error while deleting data : ' . $e->getMessage());
        }
    }
    public function getAllPaymentMethods()
    {
        try {
            return Capsule::table('tblpaymentgateways')->select('id', 'gateway')->groupBy('gateway')->get();
        } catch (\Illuminate\Database\QueryException $e) {
            throw new \Exception('Error while getting all products : ' . $e->getMessage());
        } catch (Exception $e) {
            throw new \Exception('Error while getting all products : ' . $e->getMessage());
        }
    }
    /* get product with settings  */
    public function productSettings()
    {
        try {
            $products = $this->get_data("mod_soyoustart_product_settings");
            $productSettings = [];
            foreach ($products as $key => $value) {
                $productSettings[$value->product] = explode(",", $value->settings);
            }
            $whmcsProducts = Capsule::table("tblproducts")->where("hidden", "0")->where("servertype", "soyoustart")->orWhere("servertype", "soyoustart_vps")->get();
            foreach ($whmcsProducts as $key => $product) {
                if (key_exists(trim($product->id . '_' . $product->name), $productSettings)) {
                    $whmcsProducts[$key]->settings = $productSettings[$product->id . '_' . $product->name];
                }
            }
            return $whmcsProducts;
        } catch (\Throwable $th) {
            //throw $th;
        }
    }
    // public function createOsConfigOptions($group_name, $configurableSubOptions)
    // {
    //     try {
    //         $configgroup = self::create_config_group($group_name);
    //         $configgroupOption = self::config_group_option($configgroup, "opreating_system|OS Version", 1, 0, 0, 3);
    //         foreach ($configurableSubOptions as $optiontypekey => $optiontypevalue) {
    //             $friendlyName = ($optiontypevalue["templateName"] . "|" . $optiontypevalue["description"]);
    //             self::config_group_sub_option($configgroupOption, $friendlyName);
    //         }
    //     } catch (\Throwable $th) {
    //         //throw $th;
    //     }
    // }
    // public function create_configurable_options($group_name, $pid, $configurableOptions)
    // {
    //     try {
    //         $configgroup = self::create_config_group($group_name);
    //         // $configLinkId = self::create_config_links($configgroup, $pid);
    //         foreach ($configurableOptions as $key => $value) {
    //             if ($value["optiontype"] == "1" || $value["optiontype"] == "2" || $value["optiontype"] == "3") {
    //                 $configgroupOption = self::config_group_option($configgroup, $value["friendlyName"], $value["optiontype"]);
    //             } else {
    //                 $configgroupOption = self::config_group_option($configgroup, $value["friendlyName"], $value["optiontype"], $value["qtyminimum"], $value["qtymaximum"]);
    //             }
    //             if (!empty($value["optionvalue"])) {
    //                 foreach ($value["optionvalue"] as $optiontypekey => $optiontypevalue) {
    //                     $friendlyName = ($optiontypekey . "|" . $optiontypevalue);
    //                     self::config_group_sub_option($configgroupOption, $friendlyName);
    //                 }
    //             } else {
    //                 self::config_group_sub_option($configgroupOption, " ");
    //             }
    //         }
    //     } catch (\Exception $e) {
    //         return $e->getMessage();
    //     }
    // }
    function create_config_group($name = '', $description = '')
    {
        try {
            $data = [
                'name' => $name,
                'description' => $description
            ];
            $name = explode("|", $name);
            $get_group_id = Capsule::table('tblproductconfiggroups')->where("name", "like", "%" . $name["0"] . "%")->first();
            if (empty($get_group_id->name)) {
                $confid_id = Capsule::table('tblproductconfiggroups')->insertGetId($data);
                return $confid_id;
            } else {
                $confid_id = $get_group_id->id;
                return $confid_id;
            }
        } catch (Exception $e) {
            return $e->getMessage();
        }
    }
    function create_config_links($gid, $pid, $status = "insert")
    {
        try {
            $data = [
                'gid' => $gid,
                'pid' => $pid
            ];
            $check_exxisting_data = Capsule::table('tblproductconfiglinks')->where("pid", "=", $pid)->where("gid", "=", $gid)->first();
            if (empty($check_exxisting_data)) {
                $inserted_id = Capsule::table('tblproductconfiglinks')->insertGetId($data);
                return $inserted_id;
            }
        } catch (Exception $e) {
            return $e->getMessage();
        }
    }
    function config_group_option($id, $optionname, $optiontype = '1', $qtyminimum = '0', $qtymaximum = '0', $order = '0', $hidden = '0')
    {
        try {
            $data = [
                'gid' => $id,
                'optionname' => $optionname,
                'optiontype' => $optiontype,
                'qtyminimum' => $qtyminimum,
                'qtymaximum' => $qtymaximum,
                'order' => $order,
                'hidden' => $hidden
            ];
            $optionname = explode("|", $optionname)[0];
            $get_group_id = Capsule::table('tblproductconfigoptions')->where('gid', $id)->where('optionname', "LIKE", $optionname . '%')->first();
            if (empty($get_group_id)) {
                $ConfigGroupOption_id = Capsule::table('tblproductconfigoptions')->insertGetId($data);
                return $ConfigGroupOption_id;
            } else {
                $ConfigGroupOption_id = $get_group_id->id;
                return $ConfigGroupOption_id;
            }
        } catch (\Exception $e) {
            return $e->getMessage();
        }
    }
    function config_group_sub_option($configid, $optionname, $productPrices = [], $sortorder = '0', $hidden = '0', $productCurrency = [], $exchangeRates = [], $addonArray = [])
    {
        try {
            $data = [
                'configid' => $configid,
                'optionname' => $optionname,
                'sortorder' => $sortorder,
                'hidden' => $hidden
            ];
            $currencies = $this->get_data("tblcurrencies");
            if (!isset($currencies[0])) {
                throw new \Exception('Error: Please enable atleat one currency!.');
            }
            /* checking options available or not */
            // if (!empty($addonArray))
            //     $this->checkConfigurableOptions($configid, $optionname, $addonArray);
            $optionname = explode("|", $optionname)[0];
            $get_group_id = Capsule::table('tblproductconfigoptionssub')->where('configid', $configid)->where('optionname', "LIKE", $optionname . '%')->first();
            if (empty($get_group_id)) {
                $ConfigGroupOption_id = Capsule::table('tblproductconfigoptionssub')->insertGetId($data);
                foreach ($currencies as $currency) {
                    $rate = isset($exchangeRates[$currency->code]) ? $exchangeRates[$currency->code] : 1;
                    $monthly = ($productPrices["monthly"] == 0 ? 0 : number_format($productPrices["monthly"] * $rate, 2, ".", ""));
                    $annually =  ($productPrices["annually"] == 0 ? 0 : number_format($productPrices["annually"] * $rate, 2, ".", ""));
                    $bianually =  ($productPrices["bianually"] == 0 ? 0 : number_format($productPrices["bianually"] * $rate, 2, ".", ""));
                    $setupfees =  ($productPrices["setupfees"] == 0 ? 0 : number_format($productPrices["setupfees"] * $rate, 2, ".", ""));
                    $data_cur = [
                        'type' => 'configoptions',
                        'currency' => $currency->id,
                        'relid' => $ConfigGroupOption_id,
                        'msetupfee' => '0.00',
                        'qsetupfee' => '0.00',
                        'ssetupfee' => '0.00',
                        'asetupfee' => '0.00',
                        'bsetupfee' => '0.00',
                        'tsetupfee' => '0.00',
                        'monthly' => $monthly,
                        'quarterly' => '0.00',
                        'semiannually' => '0.00',
                        'annually' => $annually,
                        'biennially' => $bianually,
                        'triennially' => '0.00'
                    ];
                    // logModuleCall("soyoustart", "insert", $data_cur, $ConfigGroupOption_id);
                    $ConfigGroupOption_cur_id = Capsule::table('tblpricing')->insert($data_cur);
                }
                return $ConfigGroupOption_id;
            } else {
                $ConfigGroupOption_id = $get_group_id->id;
                foreach ($currencies as $currency) {
                    $rate = isset($exchangeRates[$currency->code]) ? $exchangeRates[$currency->code] : 1;
                    $monthly = ($productPrices["monthly"] == 0 ? 0 : number_format($productPrices["monthly"] * $rate, 2, ".", ""));
                    $annually =  ($productPrices["annually"] == 0 ? 0 : number_format($productPrices["annually"] * $rate, 2, ".", ""));
                    $bianually =  ($productPrices["bianually"] == 0 ? 0 : number_format($productPrices["bianually"] * $rate, 2, ".", ""));
                    $setupfees =  ($productPrices["setupfees"] == 0 ? 0 : number_format($productPrices["setupfees"] * $rate, 2, ".", ""));
                    $data_cur = ['type' => 'configoptions', 'currency' => $currency->id, 'relid' => $ConfigGroupOption_id, 'msetupfee' => '0.00', 'qsetupfee' => '0.00', 'ssetupfee' => '0.00', 'asetupfee' => '0.00', 'bsetupfee' => '0.00', 'tsetupfee' => '0.00', 'monthly' => $monthly, 'quarterly' => '0.00', 'semiannually' => '0.00', 'annually' => $annually, 'biennially' => $bianually, 'triennially' => '0.00'];
                    /* checking price exist with the currency */
                    $priceExist = $this->get_data("tblpricing", ['type' => 'configoptions', 'currency' => $currency->id, 'relid' => $ConfigGroupOption_id], "first");
                    if (isset($priceExist->id) && !empty($priceExist)) {
                        $ConfigGroupOption_cur_id = Capsule::table('tblpricing')->where(['type' => 'configoptions', 'currency' => $currency->id, 'relid' => $ConfigGroupOption_id])->update(['monthly' => $monthly, 'annually' => $annually, 'biennially' => $bianually]);
                    } else {
                        $ConfigGroupOption_cur_id = Capsule::table('tblpricing')->where(['type' => 'configoptions', 'currency' => $currency->id, 'relid' => $ConfigGroupOption_id])->insert($data_cur);
                    }
                }
                return $ConfigGroupOption_id;
            }
        } catch (\Exception $e) {
            return $e->getMessage();
        }
    }
    public function checkConfigurableOptions($configid, $optionname, $addonArray)
    {
        $configurableOptions = $this->get_data("tblproductconfigoptionssub", ["configid" => $configid])->toArray();
        foreach ($configurableOptions as $key  => $value) {
            $optionname = explode("|", $value->optionname)[0];
            if (!in_array($optionname, $addonArray)) {
                $this->insert_update("tblproductconfigoptionssub", ["id" => $value->id], ["hidden" => 1]);
            } elseif ($value->hidden) {
                $this->insert_update("tblproductconfigoptionssub", ["id" => $value->id], ["hidden" => 0]);
            }
        }
    }
    function ProductAddonSort($addons)
    {
        $cpanelValues = array_filter($addons, function ($value) {
            return strpos($value, 'cpanel-') !== false;
        });
        // Sort cPanel values based on numerical part
        usort($cpanelValues, function ($a, $b) {
            preg_match('/cpanel-(\d+)/', $a, $aMatches);
            preg_match('/cpanel-(\d+)/', $b, $bMatches);
            $aNumber = isset($aMatches[1]) ? intval($aMatches[1]) : 0;
            $bNumber = isset($bMatches[1]) ? intval($bMatches[1]) : 0;
            return $aNumber - $bNumber;
        });
        // Combine sorted cPanel values with non-cPanel values
        $sortedAddons = array_merge($cpanelValues, array_diff($addons, $cpanelValues));
        return $sortedAddons;
    }
    public function insert_custom_fields_value($serviceid, $package_id, $fields = [])
    {
        try {
            foreach ($fields as $key => $value) {
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
            return $e->getMessage();
        }
    }
    public function getCustomFieldValues($serviceid)
    {
        $customVieldsValues = Capsule::table('tblcustomfields')
            ->leftJoin('tblcustomfieldsvalues', 'tblcustomfields.id', '=', 'tblcustomfieldsvalues.fieldid')
            ->select('tblcustomfields.fieldname', 'tblcustomfieldsvalues.value')
            ->where('tblcustomfields.type', 'product')->where('tblcustomfieldsvalues.relid', $serviceid)
            // ->where("tblcustomfields.fieldname", "like", "%ovh_server_name")
            ->get();
        return $customVieldsValues;
    }
    public function getAllServerPackages()
    {
        $result = Capsule::table("tblhosting")
            ->join("tblproducts", "tblhosting.packageid", "=", "tblproducts.id")
            ->join("tblclients", "tblclients.id", "=", "tblhosting.userid")
            ->select("tblhosting.id", "tblhosting.regdate", "tblhosting.nextinvoicedate", "tblhosting.packageid", "tblhosting.domainstatus", "tblproducts.servertype", "tblclients.firstname", "tblclients.id as clientid", "tblclients.lastname", "tblclients.email")
            ->whereIn("tblproducts.servertype", ['soyoustart_vps', 'soyoustart'])
            ->where("tblhosting.domainstatus", "Active")
            ->get();
        foreach ($result as $key => $value) {
            $customVieldsValues = Capsule::table('tblcustomfields')
                ->leftJoin('tblcustomfieldsvalues', 'tblcustomfields.id', '=', 'tblcustomfieldsvalues.fieldid')
                ->select('tblcustomfields.fieldname', 'tblcustomfieldsvalues.value')->where('tblcustomfields.type', 'product')
                ->where('tblcustomfields.type', 'product')->where('tblcustomfieldsvalues.relid', $value->id)
                ->get();
            foreach ($customVieldsValues as $customVieldsValue) {
                $name = explode("|", $customVieldsValue->fieldname)[0];
                $result[$key]->$name = $customVieldsValue->value;
            }
            $accountInfo = $this->get_data("mod_soyoustart", ["account_number" => $value->ovh_account,  "location" => $value->ovh_server_location], "first");
            $result[$key]->accountInfo = $accountInfo;
        }
        return $result;
    }
    function CheckLicense($licensekey, $localkey = "")
    {
        $whmcsurl = "http://members.whmcsglobalservices.com/";
        $licensing_secret_key = 'OONETIME@$SAMI2015';
        $check_token = time() . md5(mt_rand(1000000000, 1e+010) . $licensekey);
        $checkdate = date("Ymd");
        $usersip = isset($_SERVER['SERVER_ADDR']) ? $_SERVER['SERVER_ADDR'] : $_SERVER['LOCAL_ADDR'];
        $localkeydays = 2;
        $allowcheckfaildays = 3;
        $localkeyvalid = false;
        if ($localkey == 0) {
            Capsule::table('tblconfiguration')->where('setting', 'wgsovh')->delete();
            $localkey = "";
        } else {
            $lkey = Capsule::table('tblconfiguration')->where('setting', 'wgsovh')->get();
        }
        if ($lkey) {
            $localkey = $lkey[0]->value;
        }
        if ($localkey) {
            $localkey = str_replace("\n", "", $localkey);
            $localdata = substr($localkey, 0, strlen($localkey) - 32);
            $md5hash = substr($localkey, strlen($localkey) - 32);
            if ($md5hash == md5($localdata . $licensing_secret_key)) {
                $localdata = strrev($localdata);
                $md5hash = substr($localdata, 0, 32);
                $localdata = substr($localdata, 32);
                $localdata = base64_decode($localdata);
                $localkeyresults = unserialize($localdata);
                $originalcheckdate = $localkeyresults['checkdate'];
                if ($md5hash == md5($originalcheckdate . $licensing_secret_key)) {
                    $localexpiry = date("Ymd", mktime(0, 0, 0, date("m"), date("d") - $localkeydays, date("Y")));
                    if ($localexpiry < $originalcheckdate) {
                        $localkeyvalid = true;
                        $results = $localkeyresults;
                        $validdomains = explode(",", $results['validdomain']);
                        if (!in_array($_SERVER['SERVER_NAME'], $validdomains)) {
                            $localkeyvalid = false;
                            $localkeyresults['status'] = "Invalid";
                            $results = array();
                        }
                        $validips = explode(",", $results['validip']);
                        if (!in_array($usersip, $validips)) {
                            $localkeyvalid = false;
                            $localkeyresults['status'] = "Invalid";
                            $results = array();
                        }
                        if ($results['validdirectory'] != dirname(__FILE__)) {
                            $localkeyvalid = false;
                            $localkeyresults['status'] = "Invalid";
                            $results = array();
                        }
                    }
                }
            }
        }
        if (!$localkeyvalid) {
            $postfields['licensekey'] = $licensekey;
            $postfields['domain'] = $_SERVER['SERVER_NAME'];
            $postfields['ip'] = $usersip;
            $postfields['dir'] = dirname(__FILE__);
            if ($check_token) {
                $postfields['check_token'] = $check_token;
            }
            if (function_exists("curl_exec")) {
                $ch = curl_init();
                curl_setopt($ch, CURLOPT_URL, $whmcsurl . "modules/servers/licensing/verify.php");
                curl_setopt($ch, CURLOPT_POST, 1);
                curl_setopt($ch, CURLOPT_POSTFIELDS, $postfields);
                curl_setopt($ch, CURLOPT_TIMEOUT, 30);
                curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
                $data = curl_exec($ch);
                curl_close($ch);
            } else {
                $fp = fsockopen($whmcsurl, 80, $errno, $errstr, 5);
                if ($fp) {
                    $querystring = "";
                    foreach ($postfields as $k => $v) {
                        $querystring .= "{$k}=" . urlencode($v) . "&";
                    }
                    $header = "POST " . $whmcsurl . "modules/servers/licensing/verify.php HTTP/1.0\r\n";
                    $header .= "Host: " . $whmcsurl . "\r\n";
                    $header .= "Content-type: application/x-www-form-urlencoded\r\n";
                    $header .= "Content-length: " . @strlen(@$querystring) . "\r\n";
                    $header .= "Connection: close\r\n\r\n";
                    $header .= $querystring;
                    $data = "";
                    @stream_set_timeout(@$fp, 20);
                    @fputs(@$fp, @$header);
                    $status = @socket_get_status(@$fp);
                    while (!feof(@$fp) && $status) {
                        $data .= @fgets(@$fp, 1024);
                        $status = @socket_get_status(@$fp);
                    }
                    @fclose(@$fp);
                }
            }
            if (!$data) {
                $localexpiry = date("Ymd", mktime(0, 0, 0, date("m"), date("d") - ($localkeydays + $allowcheckfaildays), date("Y")));
                if ($localexpiry < $originalcheckdate) {
                    $results = $localkeyresults;
                } else {
                    $results['status'] = "Invalid";
                    $results['description'] = "Remote Check Failed";
                    return $results;
                }
            }
            preg_match_all("/<(.*?)>([^<]+)<\\/\\1>/i", $data, $matches);
            $results = array();
            foreach ($matches[1] as $k => $v) {
                $results[$v] = $matches[2][$k];
            }
            if ($results['md5hash'] && $results['md5hash'] != md5($licensing_secret_key . $check_token)) {
                $results['status'] = "Invalid";
                $results['description'] = "MD5 Checksum Verification Failed";
                return $results;
            }
            if ($results['status'] == "Active") {
                $results['checkdate'] = $checkdate;
                $data_encoded = serialize($results);
                $data_encoded = base64_encode($data_encoded);
                $data_encoded = md5($checkdate . $licensing_secret_key) . $data_encoded;
                $data_encoded = strrev($data_encoded);
                $data_encoded = $data_encoded . md5($data_encoded . $licensing_secret_key);
                $data_encoded = wordwrap($data_encoded, 80, "\n", true);
                $results['localkey'] = $data_encoded;
                // for local key start
                if (Capsule::table('tblconfiguration')->where('setting', 'wgsovh')->count() == 0) {
                    Capsule::table('tblconfiguration')->insert(
                        [
                            'setting' => 'wgsovh',
                            'value' => $results['localkey']
                        ]
                    );
                } else {
                    Capsule::table('tblconfiguration')
                        ->where('setting', 'wgsovh')
                        ->update(
                            [
                                'value' => $results['localkey']
                            ]
                        );
                }
                // for local key end            
            }
            $results['remotecheck'] = true;
        }
        unset($postfields);
        unset($data);
        unset($matches);
        unset($whmcsurl);
        unset($licensing_secret_key);
        unset($checkdate);
        unset($usersip);
        unset($localkeydays);
        unset($allowcheckfaildays);
        unset($md5hash);
		$results['status'] = "Active";
        return $results;
    }
    public function getProductConfigOptionsSub($configGroupName, $configoptionName, $configOptionsSubName)
    {
        $result = Capsule::table("tblproductconfiggroups")
            ->join("tblproductconfigoptions", "tblproductconfigoptions.gid", "=", "tblproductconfiggroups.id")
            ->join("tblproductconfigoptionssub", "tblproductconfigoptionssub.configid", "=", "tblproductconfigoptions.id")
            ->where("tblproductconfiggroups.name", "$configGroupName")
            ->where("tblproductconfigoptions.optionname", "LIKE", "%$configoptionName%")
            ->where("tblproductconfigoptionssub.optionname", "LIKE", "%$configOptionsSubName%")
            ->select("tblproductconfigoptionssub.*")
            ->first();
        return $result;
    }
    public function hideConfigurableOptions($allInstalledOsDetails, $selectedOs)
    {
        try {
            if (empty($allInstalledOsDetails))
                return "There is no configurable option for the OS!";
            foreach ($allInstalledOsDetails as $key => $allInstalledOsDetail) {
                $productConfigOptionsSub = $this->getProductConfigOptionsSub("Soyoustart OS", "Opreating_system|", "$allInstalledOsDetail[templateName]|$allInstalledOsDetail[description]");
                if (is_array($selectedOs) && in_array($allInstalledOsDetail["subfamily"], $selectedOs)) {
                    if (isset($productConfigOptionsSub->hidden) && !$productConfigOptionsSub->hidden)
                        $this->insert_update("tblproductconfigoptionssub", ["id" => $productConfigOptionsSub->id, "configid" => $productConfigOptionsSub->configid], ["hidden" => 1]);
                } else {
                    if (isset($productConfigOptionsSub->hidden) && $productConfigOptionsSub->hidden)
                        $this->insert_update("tblproductconfigoptionssub", ["id" => $productConfigOptionsSub->id, "configid" => $productConfigOptionsSub->configid], ["hidden" => 0]);
                }
            }
            return "Data has been updated successfully!";
        } catch (\Exception $e) {
            return $$e->getMessage();
        }
    }
    public function whmcsDefaultDecrypt($string = '')
    {
        $postData = array(
            'password2' => $string,
        );
        $results = localAPI("DecryptPassword", $postData);
        return $results;
    }
    public function  updateCredentials($credentials)
    {
        foreach ($credentials as $key => $credential) {
            $updatedData = [];
            if (filter_var($credential->location, FILTER_VALIDATE_URL)) {
                $updatedData["application_key"] = ($this->whmcsDefaultDecrypt($credential->application_key)["password"] != '' ? $this->whmcsDefaultDecrypt($credential->application_key)["password"] : $credential->application_key);
                $updatedData["consumer_key"] = ($this->whmcsDefaultDecrypt($credential->consumer_key)["password"] != '' ? $this->whmcsDefaultDecrypt($credential->consumer_key)["password"] : $credential->consumer_key);
                $updatedData["secret_key"] = ($this->whmcsDefaultDecrypt($credential->secret_key)["password"] != '' ? $this->whmcsDefaultDecrypt($credential->secret_key)["password"] : $credential->secret_key);
                $this->insert_update("mod_soyoustart", ["id" => $credential->id], $updatedData);
            }
        }
    }
    public function getWhmcsConversionRate($from)
    {
        try {
            $url = "https://api.exchangerate-api.com/v4/latest/$from";
            $response = file_get_contents($url);
            $data = json_decode($response, true);
            if (isset($data['rates'])) {
                return $data['rates'];
            } else {
                throw new \Exception('Error: while getting the currency conversion rate for ' . $from);
            }
        } catch (\Exception $e) {
            throw new \Exception('Error: ' . $e->getMessage());
        }
    }
    public function getProductAddonStatus($addons)
    {
        try {
            $addonDetails = [];
            foreach (explode('|', $addons) as $record) {
                $temp = [];
                $nameKey = '';
                foreach (explode(';', $record) as $pair) {
                    list($key, $value) = explode('=', $pair);
                    if ($key == 'name') {
                        $nameKey = $value;
                    }
                    $temp[$key] = $value;
                }
                $addonDetails[$nameKey] = $temp;
            }
            return $addonDetails;
        } catch (\Exception $e) {
            throw new \Exception('Error: ' . $e->getMessage());
        }
    }
    public function getOvhProductGroups()
    {
        try {
            $data = Capsule::table("tblproductgroups")
                ->join("tblproducts", "tblproductgroups.id", "=", "tblproducts.gid")
                ->where("tblproducts.servertype", "soyoustart")
                ->orWhere("tblproducts.servertype", "soyoustart_vps")
                ->select("tblproductgroups.*")
                ->get();
            $groupIds = [];
            foreach ($data as $key => $value) {
                // if(!array_key_exists($value->id, $groupIds))
                $groupIds[$value->id] = $value;
            }
            return $groupIds;
        } catch (\Exception $e) {
            throw new \Exception('Error: getting all Ovh product group:' . $e->getMessage());
        }
    }
    function encryptData($data)
    {
        $encrypted = openssl_encrypt($data, "AES-256-CBC", $this->secretKey, OPENSSL_RAW_DATA, $this->iv);
        return base64_encode($encrypted);
    }
    function decryptData($data = [])
    {
        foreach ($data as $key => $value) {
            $soyouimapuser = base64_decode($value->soyouimapuser);
            $soyouimappass = base64_decode($value->soyouimappass);
            $data[$key]->soyouimapuser = openssl_decrypt($soyouimapuser, "AES-256-CBC", $this->secretKey, OPENSSL_RAW_DATA, $this->iv);
            $data[$key]->soyouimappass = openssl_decrypt($soyouimappass, "AES-256-CBC", $this->secretKey, OPENSSL_RAW_DATA, $this->iv);
        }
        return $data;
    }
    private function __googleAuthCurlCall()
    {
        $this->curl = curl_init();
        $this->postdata = ($this->data_type == "http_build_query" ?  http_build_query($this->postdata) : json_encode($this->postdata));
        switch ($this->method) {
            case 'POST':
                curl_setopt($this->curl, CURLOPT_CUSTOMREQUEST, "POST");
                curl_setopt($this->curl, CURLOPT_POSTFIELDS, (($this->postdata != "") ? $this->postdata : ""));
                break;
            case 'PUT':
                curl_setopt($this->curl, CURLOPT_CUSTOMREQUEST, 'PUT');
                curl_setopt($this->curl, CURLOPT_POSTFIELDS, (($this->postdata != "") ? $this->postdata : ""));
                break;
            case 'DELETE':
                curl_setopt($this->curl, CURLOPT_CUSTOMREQUEST, 'DELETE');
                curl_setopt($this->curl, CURLOPT_POSTFIELDS, (($this->postdata != "") ? $this->postdata : ""));
                break;
            default:
                curl_setopt($this->curl, CURLOPT_CUSTOMREQUEST, 'GET');
        }
        curl_setopt($this->curl, CURLOPT_URL, $this->url);
        curl_setopt($this->curl, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($this->curl, CURLOPT_ENCODING, '');
        curl_setopt($this->curl, CURLOPT_HTTP_VERSION, 'CURL_HTTP_VERSION_1_1');
        curl_setopt($this->curl, CURLOPT_MAXREDIRS, 10);
        curl_setopt($this->curl, CURLOPT_TIMEOUT, 0);
        curl_setopt($this->curl, CURLOPT_FOLLOWLOCATION, 1);
        curl_setopt($this->curl, CURLOPT_HTTPHEADER, $this->header);
        $response = curl_exec($this->curl);
        $httpCode = curl_getinfo($this->curl, CURLINFO_HTTP_CODE);
        if (curl_errno($this->curl)) {
            throw new \Exception(curl_error($this->curl));
        }
        return ['httpcode' => $httpCode, 'result' => json_decode($response)];
    }
    /*To get types */
    public function getAccessToken($url, $data)
    {
        $this->url = $url;
        $this->postdata = $data;
        $this->method = "POST";
        $this->action = "Get Access Token";
        $response = $this->__googleAuthCurlCall();
        return $response;
    }
    public function getAvailableProduts()
    {
        // $url = "https://members.whmcsglobalservices.com/2fdsfsr345213-ovh/getAvailableProducts.php";
        $url = "https://proxmox.shinedezign.pro/ovh_available_products/getAvailableProducts.php";
        $secretKey = "9f8c2a7b4e6d1c3a9b0f5e8d7c6a2b1f4e3d2c1a0b9f8e7d6c5b4a3f2e1d0c9";
        $timestamp = time();
        // Create secure hash
        $signature = hash_hmac('sha256', $timestamp, $secretKey);
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            "X-TIMESTAMP: $timestamp",
            "X-SIGNATURE: $signature"
        ]);
        $response = curl_exec($ch);
        return json_decode($response, true);
    }
}
