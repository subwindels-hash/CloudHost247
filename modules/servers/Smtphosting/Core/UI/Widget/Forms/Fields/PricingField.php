<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields;

/**
 * BaseField controler
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class PricingField extends BaseField
{
    protected $id = 'pricingField';
    protected $name = 'pricingField';

    protected $availableValues = '';

    public function setSelectedValue($value)
    {
        $this->value = $value;

        return $this;
    }

    public function setAvailableValues($values)
    {
        $this->availableValues = $values;

        return $this;
    }

    public function getAvailableValues()
    {
        return $this->availableValues;
    }
}
