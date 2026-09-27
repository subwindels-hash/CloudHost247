<?php

namespace WGSModule\Soyoustart\classes;

use WHMCS\Module\Addon\Soyoustart\Helper;

class Configuration extends Helper
{

    /**
     * Holds the  data.
     *
     * @var array
     */
    private $data;
    private $availableProducts;

    /**
     * Constructor to load the JSON file.
     *
     * @throws \Exception
     */
    public function __construct()
    {
        $rootDir = explode('/modules', __DIR__)[0];
        $filePath = $rootDir . '/modules/addons/soyoustart/config.json';
        if (!file_exists($filePath)) {
            throw new \Exception("The server locations file does not exist: {$filePath}");
        }
        $jsonData = json_decode(file_get_contents($filePath), true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new \Exception("Error decoding JSON: " . json_last_error_msg());
        }
        // if (!file_exists($rootDir . '/modules/addons/soyoustart/availableProducts.json')) {
        //     throw new \Exception("The available products file does not exist: {$filePath}");
        // }
        // $availableProductData = json_decode(file_get_contents($rootDir . '/modules/addons/soyoustart/availableProducts.json'), true);
        // if (json_last_error() !== JSON_ERROR_NONE) {
        //     throw new \Exception("Error decoding JSON: " . json_last_error_msg());
        // }
        // $this->availableProducts = $availableProductData;
        $this->data = $jsonData;
    }

    /* get available products */

    public function getAvailableProducts( $productType, $subsidiary)
    {
        $availableProductData = $this->getAvailableProduts();
        if($availableProductData["status"] != "success"){
            throw new \Exception("Error fetching available products: " . $availableProductData["message"]);
        }
        return $availableProductData["data"][$productType][$subsidiary] ?? [];
    }


    /* serverl locations */

    public function serverLocation()
    {
        if (isset($this->data['serverLocation'])) {
            return $this->data['serverLocation'];
        } else {
            throw new \Exception("The 'serverLocation' key does not exist in the loaded JSON data.");
        }
    }



    /* product settings page config */

    /* update a languge file with the same value */
    public function productType()
    {
        if (isset($this->data['productType'])) {
            return $this->data['productType'];
        } else {
            throw new \Exception("The 'productType' key does not exist in the loaded JSON data.");
        }
    }

    /* Hide Opreating System Name to display in order */
    public function hideOsName()
    {

        if (isset($this->data['hideOsName'])) {
            return $this->data['hideOsName'];
        } else {
            throw new \Exception("The 'hideOsName' key does not exist in the loaded JSON data.");
        }
    }
    public function defaultOsList()
    {

        if (isset($this->data['defaultOsList'])) {
            return $this->data['defaultOsList'];
        } else {
            throw new \Exception("The 'defaultOsList' key does not exist in the loaded JSON data.");
        }
    }

    public function aclSettings()
    {
        if (isset($this->data['aclSettings'])) {
            return $this->data['aclSettings'];
        } else {
            throw new \Exception("The 'hideOsName' key does not exist in the loaded JSON data.");
        }
    }

    public function aclSettingsDedicated()
    {
        if (isset($this->data['aclSettingsDedicated'])) {
            return $this->data['aclSettingsDedicated'];
        } else {
            throw new \Exception("The 'aclSettingsDedicated' key does not exist in the loaded JSON data.");
        }
    }


    public function aclSettingsVps()
    {
        if (isset($this->data['aclSettingsVps'])) {
            return $this->data['aclSettingsVps'];
        } else {
            throw new \Exception("The 'aclSettingsVps' key does not exist in the loaded JSON data.");
        }
    }

    public function aditinalIpConfigOptionsData()
    {
        if (isset($this->data['aditinalIpConfigOptionsData'])) {
            return $this->data['aditinalIpConfigOptionsData'];
        } else {
            throw new \Exception("The 'aditinalIpConfigOptionsData' key does not exist in the loaded JSON data.");
        }
    }


    public function dataCenter()
    {

        if (isset($this->data['dataCenter'])) {
            return $this->data['dataCenter'];
        } else {
            throw new \Exception("The 'dataCenter' key does not exist in the loaded JSON data.");
        }
    }


    public function imapAclSetting()
    {
        if (isset($this->data['imapAclSetting'])) {
            return $this->data['imapAclSetting'];
        } else {
            throw new \Exception("The 'imapAclSetting' key does not exist in the loaded JSON data.");
        }
    }

    /* 
        @param $productType = OVH produt type.

        @return array of product group

    */

    public function ovhProductGroup($productType)
    {

        if (isset($this->data['ovhProductGroup'])) {
            $groups = $this->data['ovhProductGroup'];

            return $groups[strtoupper($productType)];
        } else {
            throw new \Exception("The 'ovhProductGroup' key does not exist in the loaded JSON data.");
        }
    }
}
