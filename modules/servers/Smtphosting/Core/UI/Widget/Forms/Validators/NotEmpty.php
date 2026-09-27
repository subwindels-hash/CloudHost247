<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Validators;

/**
 * NotEmpty form data validator
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class NotEmpty extends BaseValidator
{
    protected function validate($data, $additionalData = null)
    {
        if (is_array($data) && count($data) > 0)
        {
            return true;
        }

        if ((is_string($data) && strlen(trim($data)) > 0) || is_numeric($data))
        {
            return true;
        }

        $this->addValidationError('thisFieldCannotBeEmpty');

        return false;
    }
}
