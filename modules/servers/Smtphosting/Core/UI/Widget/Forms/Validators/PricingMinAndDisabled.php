<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Validators;

/**
 * IsNumberBetween form data validator
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class PricingMinAndDisabled extends BaseValidator
{
    protected $vMin = 0;
    protected $vDisabled = -1;

    public function __construct($vMin = 0, $vDisabled = -1)
    {
        if (is_int($vMin) && $vMin >= 0)
        {
            $this->vMin = (float)$vMin;
        }

        if (is_int($vDisabled))
        {
            $this->vDisabled = (float)$vDisabled;
        }
    }

    protected function validate($data, $additionalData = null)
    {
        $fValue = (float)$data;

        if (is_numeric($data) && ($fValue > $this->vMin || $fValue === $this->vDisabled))
        {
            return true;
        }

        $this->addValidationError($this->vMin === $this->vDisabled ? 'PleaseProvideAPriceEqualOrHigher' : 'PleaseProvideAPriceEqualOrHigherThan',
            false, ['minValue' => $this->vMin, 'eqValue' => $this->vDisabled]);

        return false;
    }
}
