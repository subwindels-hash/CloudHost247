<?php

namespace WHMCS\Module\Server\RDP;

use WHMCS\Database\Capsule;

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

class Helper
{
    public $baseUrl = '';
    public $method = 'GET';
    public $data = [];
    public $header = [];
    public $endPoint = '';
    public $action = '';

    public $curl;

    public function __construct($params)
    {

        try {

            $apitoken = isset($params['serveraccesshash']) ? $params['serveraccesshash'] : $this->getServerAccessHash();

            $this->baseUrl = "https://www.rdparena.com/payments/resellerapi.php";

            $this->header = [
                'Content-Type: application/json',
                'Cra-Token: ' . $apitoken
            ];
        } catch (\Exception $e) {
            logActivity("Error: RDP server module failed to execute the __construct function - " . $e->getMessage());
        }
    }

    /** Function to test the server connection. */
    public function testConnection()
    {
        try {
            $this->method = 'GET';
            $this->endPoint = 'stock';
            $this->action = 'Test Connection';
            $curlResponse = $this->curlCall();

            return $curlResponse;

        } catch (\Exception $e) {
            logActivity("Error: RDP server module failed to execute the testConnection function - " . $e->getMessage());
        }

    }

    /** Function to retrieve the stock. */
    public function getStocks()
    {
        try {
            $this->method = 'GET';
            $this->endPoint = 'stock';
            $this->action = 'Get Stocks';
            $curlResponse = $this->curlCall();

            return $curlResponse;

        } catch (\Exception $e) {
            logActivity("Error: RDP server module failed to execute the getStock function - " . $e->getMessage());
        }

    }

    /** Function to create the service. */
    public function createOrder($productid)
    {

        try {
            $this->method = 'POST';
            $this->endPoint = 'order';
            $this->action = 'Create Order';
            $orderdata = [
                [
                    'id' => (int) $productid,
                    'quantity' => 1
                ]
            ];
            $this->data = json_encode($orderdata);
            $curlResponse = $this->curlCall();

            return $curlResponse;

        } catch (\Exception $e) {
            logActivity("Error: RDP server module failed to execute the createOrder function - " . $e->getMessage());
        }

    }

    /** Function to handle service renewal. */
    public function renewService($serviceid)
    {
        try {
            $this->method = 'POST';
            $this->endPoint = 'service/' . $serviceid;
            $this->action = 'Renew Order';
            $curlResponse = $this->curlCall();

            return $curlResponse;

        } catch (\Exception $e) {
            logActivity("Error: RDP server module failed to execute the renewService function - " . $e->getMessage());
        }

    }

    /** Function to retrieve the service details. */
    public function getServiceDetail($serviceid)
    {
        try {
            $this->method = 'GET';
            $this->endPoint = 'service/' . $serviceid;
            $this->action = 'Get service Detail';
            $curlResponse = $this->curlCall();

            return $curlResponse;
        } catch (\Exception $e) {
            logActivity("Error: RDP server module failed to execute the getServiceDetail function - " . $e->getMessage());
        }
    }

    /** Function to run the API using cURL. */
    public function curlCall()
    {
        try {
            $this->curl = curl_init();

            switch ($this->method) {
                case 'POST':
                    curl_setopt($this->curl, CURLOPT_POST, true); // corrected: should be `true` not 'POST'
                    curl_setopt($this->curl, CURLOPT_POSTFIELDS, (!empty($this->data) ? $this->data : ""));
                    break;

                case 'PUT':
                    curl_setopt($this->curl, CURLOPT_CUSTOMREQUEST, 'PUT');
                    curl_setopt($this->curl, CURLOPT_POSTFIELDS, (!empty($this->data) ? $this->data : ""));
                    break;

                case 'DELETE':
                    curl_setopt($this->curl, CURLOPT_CUSTOMREQUEST, 'DELETE');
                    curl_setopt($this->curl, CURLOPT_POSTFIELDS, (!empty($this->data) ? $this->data : ""));
                    break;

                case 'PATCH':
                    curl_setopt($this->curl, CURLOPT_CUSTOMREQUEST, 'PATCH');
                    curl_setopt($this->curl, CURLOPT_POSTFIELDS, (!empty($this->data) ? $this->data : ""));
                    break;

                default:
                    curl_setopt($this->curl, CURLOPT_CUSTOMREQUEST, 'GET');
            }

            curl_setopt($this->curl, CURLOPT_URL, $this->baseUrl . $this->endPoint);
            curl_setopt($this->curl, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($this->curl, CURLOPT_TIMEOUT, 10000); // timeout in seconds
            curl_setopt($this->curl, CURLOPT_FOLLOWLOCATION, 1);
            curl_setopt($this->curl, CURLOPT_HTTPHEADER, $this->header); // Added Content-Type for JSON

            $response = curl_exec($this->curl);
            $httpCode = curl_getinfo($this->curl, CURLINFO_HTTP_CODE);

            /** Log the API request and response for the RDP Server module */
            logModuleCall("RDP Server module", $this->action, [
                "url" => $this->baseUrl . $this->endPoint,
                "method" => $this->method,
                "data" => $this->data
            ], [
                "httpCode" => $httpCode,
                "result" => json_decode($response),
            ]);

            if (curl_errno($this->curl)) {
                throw new \Exception(curl_error($this->curl));
            }

            return ['httpcode' => $httpCode, 'result' => json_decode($response)];

        } catch (\Exception $e) {
            logActivity("Error: RDP server module failed to execute the curlCall function - " . $e->getMessage());
        }
    }


    /** Function to create the custom field. */
    public function CreateCustomFields($pid)
    {
        try {
            $customfieldarray = [
                'Uuid' => [
                    'type' => 'product',
                    'fieldname' => 'serviceid|Service id',
                    'relid' => $pid,
                    'fieldtype' => 'text',
                    'description' => 'Enter service id here',
                    'adminonly' => 'on',
                    "required" => "",
                    "showorder" => "",
                    'sortorder' => '0'
                ]
            ];

            foreach ($customfieldarray as $key => $customfieldval) {
                $fieldname = explode('|', $customfieldval['fieldname']);
                $exist_custom_fields = Capsule::table('tblcustomfields')->where('type', $customfieldval['type'])->where('relid', $customfieldval['relid'])->where('fieldname', 'like', $fieldname[0] . '|%')->get();

                if (!isset($exist_custom_fields[0]->id)) {
                    Capsule::table('tblcustomfields')->insert($customfieldval);
                }
            }
        } catch (\Exception $e) {

            logActivity("Error: RDP server module failed to execute the CreateCustomFields function - " . $e->getMessage());
        }
    }

    /** Function to save or update the custom field value. */
    public function saveCustomFiledValue($pid, $serviceid, $value)
    {

        try {
            $customFieldId = Capsule::table('tblcustomfields')->where("type", "=", "product")->where("relid", $pid)->where("fieldname", "like", "serviceid|%")->value('id');

            if (Capsule::table('tblcustomfieldsvalues')->where('fieldid', $customFieldId)->where('relid', $serviceid)->first()) {

                return Capsule::table('tblcustomfieldsvalues')->where('fieldid', $customFieldId)->where('relid', $serviceid)->update([
                    'value' => $value
                ]);
            } else {
                return Capsule::table('tblcustomfieldsvalues')->insert([
                    'fieldid' => $customFieldId,
                    'relid' => $serviceid,
                    'value' => $value
                ]);
            }
            // return Capsule::table('tblcustomfieldsvalues')->where('fieldid', $customFieldId)->where('relid', $serviceid)->update([
            //     'value' => $value
            // ]);

        } catch (\Exception $e) {

            logActivity("Error: RDP server module failed to execute the saveCustomFieldValue function - " . $e->getMessage());

        }
    }

    /** Function to create an email template. */
    public function createTemplate()
    {
        try {
            if (!Capsule::table('tblemailtemplates')->where('type', 'general')->where('name', 'Welcome RDP Credentials Email')->count()) {
                Capsule::table('tblemailtemplates')->insert([
                    'type' => 'general',
                    'name' => 'Welcome RDP Credentials Email',
                    'subject' => 'RDP Access Credentials',
                    'message' => '<p>Dear {$client_name},</p><p>Thank you for choosing our RDP service. Below are your RDP access details:</p><p><strong>IP Address:</strong> {$RDP_ip}</p><p><strong>Username:</strong> {$RDP_username}</p><p><strong>Password:</strong> {$RDP_password}</p><p>Please keep these credentials secure. If you experience any issues or need assistance, feel free to contact our support team.</p><p>Best regards,<br>{$company_name}</p>',
                    'custom' => 1
                ]);
            }
        } catch (\Exception $e) {
            logActivity("Error: RDP server module failed to execute the createTemplate function - " . $e->getMessage());

        }
    }

    /** Function to send an email to the client using the local API. */
    function sendEmail($postData)
    {
        try {
            return localAPI('SendEmail', $postData);

        } catch (\Exception $e) {
            logActivity("Error: RDP server module failed to execute the sendEmail function -" . $e->getMessage());
        }
    }

    /** Function to retrieve the server hash value from the database. */
    private function getServerAccessHash()
    {
        // Retrieve the server access hash from WHMCS settings or database
        $result = Capsule::table('tblservers')
            ->where('type', '=', 'RDP') // Replace with your module type if different
            ->value('accesshash');

        return $result ?? ''; // Return the hash or an empty string if not found
    }
}
