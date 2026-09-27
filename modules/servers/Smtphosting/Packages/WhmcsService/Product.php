<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService;


use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Currency;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\AppParams;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Config\Enum;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Config\PackageConfiguration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Traits\ConfigurableOptionsConfig;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Traits\CustomFieldsConfig;
use WHMCS\Database\Capsule;

/**
 * Class Product
 * @package ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService
 */
class Product
{

    use ConfigurableOptionsConfig;
    use CustomFieldsConfig;
    use AppParams;

    /**
     * @var
     */
    protected $configOptions;
    /**
     * @var
     */
    protected $productId;
    /**
     * @var array|mixed
     */
    protected $configOptionsListt;
    /**
     * @var
     */
    protected $product;

    /**
     * Product constructor.
     * @param null $productId
     * @param array $configOptionsListt
     */
    public function __construct($productId = null, $configOptionsListt = [])
    {
        $this->setProductId($productId);
        $this->configOptionsList = $configOptionsListt;
        $this->loadWhmcsService();
    }

    /**
     *
     */
    protected function loadWhmcsService()
    {
        $this->product = \WHMCS\Product\Product::find($this->productId);
    }

    /**
     * @param null $productId
     */
    protected function setProductId($productId = null)
    {
        $relationId = (int)$productId;
        if ($relationId <= 0)
        {
            throw new \InvalidArgumentException('Wrong product id : ' . $relationId);
        }

        $this->productId = $relationId;
    }

    /**
     * @param null $optionName
     */
    public function addConfigurableOption($optionName = null)
    {
        if (!$this->canOptionBeAdded($optionName))
        {
            return;
        }
        $gid = $this->getConfigurableOptionGroupId();
        $this->loadConfigurableOptionsList();
        $this->createConfigurableOption($optionName, $gid);
    }

    protected function loadConfigurableOptionsList()
    {
        if (!$this->configOptionsList)
        {
            $packageConfiguration = new PackageConfiguration();

            $this->configOptionsList = $packageConfiguration->getConfigurationForResellerProduct()['configurableOptions'];
        }
    }

    /**
     * @param null $optionName
     * @return bool
     */
    public function canOptionBeAdded($optionName = null): bool
    {

        if (!is_string($optionName) || trim($optionName) === '')
        {
            return false;
        }

        if ($this->doesConfigurableOptionExist($optionName))
        {
            return false;
        }

        return true;
    }

    /**
     * @param null $optionName
     * @return bool
     */
    public function doesConfigurableOptionExist($optionName = null): bool
    {

        if (!is_string($optionName) || trim($optionName) === '')
        {
            return false;
        }

        $this->loadConfigOptions();

        $rawOptionName = $this->configOptionNameToRaw($optionName);
        foreach ($this->configOptions as $option)
        {
            if ($rawOptionName === $this->configOptionNameToRaw($option->optionname))
            {
                return true;
            }
        }
        return false;
    }

    /**
     * @param $optionName
     * @return string
     */
    public function configOptionNameToRaw($optionName): string
    {
        if (!is_string($optionName) || trim($optionName) === '' || substr($optionName, 0, 1) === '|')
        {
            return '';
        }

        if (strpos($optionName, '|') > 0)
        {
            $parts = explode('|', $optionName);

            return $parts[0];
        }

        return $optionName;
    }

    /**
     * @param $optionName
     * @param $gid
     */
    public function createConfigurableOption($optionName, $gid)
    {
        foreach ($this->configOptionsList as $option)
        {
            if ($option[Enum::OPTION_NAME] === $optionName || $this->configOptionNameToRaw($option[Enum::OPTION_NAME]) === $optionName)
            {
                $optId = Capsule::table('tblproductconfigoptions')->insertGetId([
                    Enum::OPTION_GROUP_ID     => $gid,
                    Enum::OPTION_NAME         => $option[Enum::OPTION_NAME],
                    Enum::OPTION_TYPE         => $option[Enum::OPTION_TYPE],
                    Enum::OPTION_QUANTITY_MIN => $option[Enum::OPTION_QUANTITY_MIN] ? $option[Enum::OPTION_QUANTITY_MIN] : Enum::OPTION_QUANTITY_MIN_DEFAULT,
                    Enum::OPTION_QUANTITY_MAX => $option[Enum::OPTION_QUANTITY_MAX] ? $option[Enum::OPTION_QUANTITY_MAX] : Enum::OPTION_QUANTITY_MAX_DEFAULT,
                    Enum::ORDER               => $option[Enum::ORDER] ? $option[Enum::ORDER] : Enum::ORDER_DEFAULT,
                    Enum::HIDDEN              => $option[Enum::HIDDEN] ? $option[Enum::HIDDEN] : Enum::HIDDEN_DEFAULT
                ]);

                if ($option[Enum::OPTION_TYPE] == Enum::OPTION_TYPE_QUANTITY && !$option[Enum::CONFIG_SUB_OPTIONS])
                {
                    $defaultConfig = Enum::DEFAULT_QUANTITY_SUB_CONFIG;
                    $this->createConfigurableSubOption($optId, $defaultConfig[Enum::OPTION_SUB_NAME],
                        $defaultConfig[Enum::OPTION_SUB_ORDER], $defaultConfig[Enum::OPTION_SUB_HIDDEN]);
                }

                foreach ($option[Enum::CONFIG_SUB_OPTIONS] as $subOption)
                {
                    $this->createConfigurableSubOption($optId, $subOption[Enum::OPTION_SUB_NAME],
                        $subOption[Enum::OPTION_SUB_ORDER], $subOption[Enum::OPTION_SUB_HIDDEN]);
                }
            }
        }

    }

    /**
     * @param null $optId
     * @param null $optName
     * @param int $sortOrder
     * @param int $hidden
     */
    public function createConfigurableSubOption($optId = null, $optName = null, $sortOrder = 0, $hidden = 0)
    {
        if (!is_string($optName) || trim($optName) === '')
        {
            return;
        }
        $subId = Capsule::table('tblproductconfigoptionssub')->insertGetId([
            Enum::OPTION_SUB_OPTION_ID => (int)$optId,
            Enum::OPTION_SUB_NAME      => $optName,
            Enum::OPTION_SUB_ORDER     => (int)$sortOrder ? (int)$sortOrder : Enum::OPTION_SUB_ORDER_DEFAULT,
            Enum::OPTION_SUB_HIDDEN    => (int)$hidden ? (int)$hidden : Enum::OPTION_SUB_HIDDEN_DEFAULT,
        ]);

        //add default pricing - 0
        $this->insertDefaultConfigOptionPricing($subId);

        return $subId;
    }

    /**
     * @param null $relId
     * @param string $defaultPrice
     * @return null
     */
    public function insertDefaultConfigOptionPricing($relId = null, $defaultPrice = '0.00')
    {
        $defaultCurrencyId = Currency::getDefaultCurrencyId();

        if (!$defaultCurrencyId || !$relId)
        {
            return null;
        }

        $prId = Capsule::table('tblpricing')->insertGetId([
            'type'       => 'configoptions', 'currency' => $defaultCurrencyId,
            'relid'      => $relId, 'msetupfee' => $defaultPrice, 'qsetupfee' => $defaultPrice, 'ssetupfee' => $defaultPrice,
            'asetupfee'  => $defaultPrice, 'bsetupfee' => $defaultPrice, 'tsetupfee' => $defaultPrice, 'monthly' => $defaultPrice,
            'quarterly'  => $defaultPrice, 'semiannually' => $defaultPrice, 'annually' => $defaultPrice,
            'biennially' => $defaultPrice, 'triennially' => $defaultPrice
        ]);

        return $prId;
    }

    /**
     * @return mixed
     */
    public function getConfigurableOptionGroupId()
    {
        $gid = $this->getFirstOptionGroupId();
        if (!$gid)
        {
            $this->createConfigOptionsGroup();
            $this->loadConfigOptions(true);

            $gid = $this->getFirstOptionGroupId();
        }

        return $gid;
    }

    /**
     *
     */
    public function createConfigOptionsGroup()
    {
        $productName = $this->product->name;
        $moduleName  = $this->getModuleName();

        $groupId = Capsule::table('tblproductconfiggroups')->insertGetId([
            'name'        => 'Configurable options for ' . $productName . ' product',
            'description' => 'Auto generated by module ' . $moduleName
        ]);

        if (is_int($groupId) && $groupId > 0)
        {
            Capsule::table('tblproductconfiglinks')->insertGetId(['gid' => $groupId, 'pid' => $this->productId]);
        }

        $this->configurableOptionsGroupCreated = true;
    }

    /**
     * @return string
     */
    public function getModuleName(): string
    {
        return 'Smtphosting';
    }

    /**
     * @return false
     */
    public function getFirstOptionGroupId()
    {
        $this->loadConfigOptions();

        foreach ($this->configOptions as $option)
        {
            return $option->gid;
        }

        $optionGroup = Capsule::table('tblproductconfiggroups')
            ->join('tblproductconfiglinks', 'tblproductconfiglinks.gid', '=', 'tblproductconfiggroups.id')
            ->where('tblproductconfiglinks.pid', $this->productId)->first();

        if (is_object($optionGroup))
        {
            return $optionGroup->gid;
        }

        return false;
    }

    /**
     * @param false $force
     */
    public function loadConfigOptions($force = false)
    {
        if ($force || $this->configOptions === null)
        {
            $this->configOptions = Capsule::table('tblproductconfigoptions')
                ->leftJoin('tblproductconfiglinks', 'tblproductconfigoptions.gid', '=', 'tblproductconfiglinks.gid')
                ->join('tblproductconfiggroups', 'tblproductconfigoptions.gid', '=', 'tblproductconfiggroups.id')
                ->select('tblproductconfigoptions.id', 'tblproductconfigoptions.optionname', 'tblproductconfigoptions.gid')
                ->where('tblproductconfiglinks.pid', $this->productId)->get();
        }
    }

    public function isConfigurableOptionsGroupCreated()
    {
        return $this->configurableOptionsGroupCreated;
    }
}
