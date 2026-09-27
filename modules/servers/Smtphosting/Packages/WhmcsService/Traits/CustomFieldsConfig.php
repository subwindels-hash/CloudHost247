<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Traits;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Packages\PackageManager;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Config\Enum;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Config\PackageConfiguration;
use WHMCS\Database\Capsule;

trait CustomFieldsConfig
{
    protected $customFieldsList = [];

    public function loadCustomFieldsList()
    {
        if (!$this->configOptionsList)
        {
            $packageManager = new PackageManager();
            $config         = $packageManager->getPackageConfiguration(PackageConfiguration::getPackageName());

            $this->customFieldsList = $config->{Enum::CUSTOM_FIELDS};
        }
    }

    public function trimCustomFieldNameName($name = null)
    {
        if (is_string($name) && trim($name) !== '' && stripos($name, '|') > 0)
        {
            $parts = explode('|', $name);

            return $parts[0];
        }

        return $name;
    }

    public function getCustomFieldConfigParams($fieldName = null)
    {
        $this->loadConfigurableOptionsList();

        foreach ($this->customFieldsList as $fieldConfig)
        {
            if (!$fieldConfig || !is_array($fieldConfig))
            {
                continue;
            }

            if ($fieldConfig[Enum::OPTION_NAME] === $fieldName || $this->trimConfigOptionName($fieldConfig[Enum::OPTION_NAME]) === $fieldName)
            {
                return $fieldConfig;
            }
        }

        return false;
    }

    public function createCustomFieldsFromConfig()
    {
        $this->loadCustomFieldsList();

        foreach ($this->customFieldsList as $fieldData)
        {
            $this->addCustomField($fieldData);
        }

    }

    public function addCustomField($fieldParams = [])
    {
        if (!$fieldParams || !$this->isValidString($fieldParams[Enum::FIELD_NAME]))
        {
            return false;
        }

        $relationType = $this->isValidString($fieldParams[Enum::FIELD_RELATION_TYPE])
            ? $fieldParams[Enum::FIELD_RELATION_TYPE] : Enum::FIELD_RELATION_TYPE_DEFAULT;

        $relationId = ($fieldParams[Enum::FIELD_RELATION_TYPE] === Enum::FIELD_RELATION_TYPE_CLIENT)
            ? '0' : $this->productId;

        if ($this->customFieldExists($fieldParams[Enum::FIELD_NAME], $relationType, $relationId))
        {
            return false;
        }

        $cfId = Capsule::table('tblcustomfields')->insertGetId([
            //name
            Enum::FIELD_NAME           => $fieldParams[Enum::FIELD_NAME],
            //relation type
            Enum::FIELD_RELATION_TYPE  => $relationType,
            //relation id
            Enum::CUSTOM_FIELDS_REL_ID => $relationId,
            //field type
            Enum::FIELD_TYPE           => $this->isValidString($fieldParams[Enum::FIELD_TYPE])
                ? $fieldParams[Enum::FIELD_TYPE] : Enum::FIELD_TYPE_DEFAULT,
            //description
            Enum::FIELD_DESCRIPTION    => $this->isValidString($fieldParams[Enum::FIELD_DESCRIPTION])
                ? $fieldParams[Enum::FIELD_DESCRIPTION] : Enum::FIELD_DESCRIPTION_DEFAULT,
            //field options
            Enum::FIELD_OPTIONS        => $this->isValidString($fieldParams[Enum::FIELD_OPTIONS])
                ? $fieldParams[Enum::FIELD_OPTIONS] : Enum::FIELD_OPTIONS_DEFAULT,
            //regular expresion
            Enum::FIELD_REG_EXPR       => $this->isValidString($fieldParams[Enum::FIELD_REG_EXPR])
                ? $fieldParams[Enum::FIELD_REG_EXPR] : Enum::FIELD_REG_EXPR_DEFAULT,
            //admin only
            Enum::FIELD_ADMIN_ONLY     => $this->isValidString($fieldParams[Enum::FIELD_ADMIN_ONLY])
                ? $fieldParams[Enum::FIELD_ADMIN_ONLY] : Enum::FIELD_ADMIN_ONLY_DEFAULT,
            //required
            Enum::FIELD_REQUIRED       => $this->isValidString($fieldParams[Enum::FIELD_REQUIRED])
                ? $fieldParams[Enum::FIELD_REQUIRED] : Enum::FIELD_REQUIRED_DEFAULT,
            //show on order form
            Enum::FIELD_SHOW_ORDER     => $this->isValidString($fieldParams[Enum::FIELD_SHOW_ORDER])
                ? $fieldParams[Enum::FIELD_SHOW_ORDER] : Enum::FIELD_SHOW_ORDER_DEFAULT,
            //show on invoice
            Enum::FIELD_SHOW_INVOICE   => $this->isValidString($fieldParams[Enum::FIELD_SHOW_INVOICE])
                ? $fieldParams[Enum::FIELD_SHOW_INVOICE] : Enum::FIELD_SHOW_INVOICE_DEFAULT,
            //sort order
            Enum::FIELD_SORT_ORDER     => $this->isValidString($fieldParams[Enum::FIELD_SORT_ORDER])
                ? $fieldParams[Enum::FIELD_SORT_ORDER] : Enum::FIELD_SORT_ORDER_DEFAULT,
            //created at
            Enum::FIELD_CREATED_AT     => $this->isValidString($fieldParams[Enum::FIELD_CREATED_AT])
                ? $fieldParams[Enum::FIELD_CREATED_AT] : Enum::FIELD_CREATED_AT_DEFAULT,
            //updated at
            Enum::FIELD_UPDATED_AT     => $this->isValidString($fieldParams[Enum::FIELD_UPDATED_AT])
                ? $fieldParams[Enum::FIELD_UPDATED_AT] : Enum::FIELD_UPDATED_AT_DEFAULT,
        ]);
    }

    public function isValidString($string = null)
    {
        return (is_string($string) && trim($string) !== '');
    }

    public function customFieldExists($fieldName = null, $relationType = null, $relationId = null)
    {
        if (!$fieldName || !$relationType || (!$relationId && $relationId !== 0 & $relationId !== '0'))
        {
            return false;
        }

        $count = Capsule::table('tblcustomfields')
            ->where(Enum::FIELD_NAME, 'LIKE', $this->trimConfigOptionName($fieldName) . '|%')
            ->where(Enum::FIELD_RELATION_TYPE, $relationType)
            ->where(Enum::CUSTOM_FIELDS_REL_ID, $relationId)
            ->count();

        return ($count > 0);
    }
}
