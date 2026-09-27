<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\BaseValidatorInterface;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Validators as FieldsValidators;

/**
 * Fields related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait Field
{
    protected $fieldData = [];
    protected $value = null;
    protected $defaultValue = null;
    protected $description = null;
    protected $disabled = false;
    protected $readOnly = false;
    protected $validators = [];
    protected $width = 8;
    protected $labelWidth = 4;
    protected $placeholder = null;
    protected $validationErrors = [];

    public function setDescription($description)
    {
        $this->description = $description;

        return $this;
    }

    public function getDescription()
    {
        return $this->description;
    }

    public function setValue($value)
    {
        $this->value = $value;

        return $this;
    }

    public function getValue()
    {
        if ($this->value !== null)
        {
            return $this->value;
        }

        return $this->defaultValue;
    }

    protected function setFieldData($data)
    {
        $this->fieldData = $data;

        return $this;
    }

    public function getFieldData()
    {
        return $this->fieldData;
    }

    public function disableField()
    {
        $this->disabled = true;

        return $this;
    }

    protected function enableField()
    {
        $this->disabled = false;

        return $this;
    }

    public function enableReadOnly()
    {
        $this->readOnly = true;
        return $this;
    }

    public function isReadOnly()
    {
        return $this->readOnly;
    }

    public function isDisabled()
    {
        return $this->disabled;
    }

    public function getValidationErrors()
    {
        return $this->validationErrors;
    }

    /* 
     * adds validator for form field
     * 
     * @param $validator \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Validators\BaseValidator
     * return $this 
     */
    public function addValidator($validator)
    {
        if (is_string($validator))
        {
            $validator = new $validator();
        }

        if ($validator instanceof BaseValidatorInterface)
        {
            $this->validators[] = $validator;
        }

        return $this;
    }

    /* 
     * checks if provided data is proper for the form field
     * 
     * return boolen
     */
    public function isValueValid($data, $additionalData = null)
    {
        foreach ($this->validators as $validator)
        {
            if ($validator->isValid($data, $additionalData))
            {
                continue;
            }

            $this->validationErrors = array_merge($this->validationErrors, $validator->getErrorsList());
        }

        if (count($this->validationErrors) > 0)
        {
            return false;
        }

        return true;
    }

    public function getWidth()
    {
        return $this->width;
    }

    public function setWidth($width)
    {
        if ((int)$width > 0)
        {
            $this->width = (int)$width;
        }

        return $this;
    }

    public function getLabelWidth()
    {
        return $this->labelWidth;
    }

    public function setLabelWidth($width)
    {
        if ((int)$width > 0)
        {
            $this->labelWidth = (int)$width;
        }

        return $this;
    }

    public function setPlaceholder($placeholder)
    {
        $this->placeholder = $placeholder;

        return $this;
    }

    public function getPlaceholder()
    {
        return $this->placeholder;
    }

    public function notEmpty()
    {
        $this->addValidator(new FieldsValidators\NotEmpty());

        return $this;
    }

    public function isIntNumberBetween($min = 0, $max = 0)
    {
        $this->addValidator(new FieldsValidators\IsIntNumberBetween($min, $max));

        return $this;
    }

    public function setDecimal($mValue = null, $dValue = null)
    {
        $this->addValidator(new FieldsValidators\Decimal($mValue, $dValue));

        return $this;
    }

    public function setPricingMinimalValues($vMin = null, $vDisabled = null)
    {
        $this->addValidator(new FieldsValidators\PricingMinAndDisabled($vMin, $vDisabled));

        return $this;
    }

    public function setDefaultValue($value = null)
    {
        $this->defaultValue = $value;

        return $this;
    }

    public function getDefaultValue()
    {
        return $this->defaultValue;
    }

    public function addGroupName($groupName = null)
    {
        $addGroupWrapper = false;

        if (stripos($this->name, '[]'))
        {
            $this->name      = str_replace('[]', '', $this->name);
            $addGroupWrapper = true;
        }

        if (trim($groupName) && trim($groupName) !== '' && is_string(trim($groupName)) && $this->name)
        {
            $this->name = trim($groupName) . '[' . $this->name . ']';
        }

        if ($addGroupWrapper)
        {
            $this->name = $this->name . '[]';
        }

        return $this;
    }
}
