<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Validators;

/**
 * IsNumberBetween form data validator
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class Decimal extends BaseValidator
{
    protected $mValue = 10;
    protected $dValue = 2;

    public function __construct($mValue = 10, $dValue = 2)
    {
        if (is_int($mValue) && $mValue > 0)
        {
            $this->mValue = (int)$mValue;
        }

        if (is_int($dValue) && $dValue >= 0 && $dValue <= 30 && $dValue <= $this->mValue)
        {
            $this->dValue = (int)$dValue;
        }
    }

    protected function validate($data, $additionalData = null)
    {
        if (!is_numeric($data))
        {
            $this->addValidationError('PleaseProvideANumericValue');

            return false;
        }

        $stringData = trim((string)$data, '-');
        $brake      = strpos($stringData, '.');
        $lenght     = strlen($stringData);
        if ((($lenght - 1) <= $this->mValue) && ($lenght <= $brake + 1 + $this->dValue))
        {
            return true;
        }

        $this->addValidationError('PleaseProvideANumericValue');

        return false;
    }
}
