<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Validators;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\BaseValidatorInterface;

/**
 * BaseValidator
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
abstract class BaseValidator implements BaseValidatorInterface
{
    protected $type = 'php'; //todo php/js
    protected $errorsList = [];
    protected $lang = null;


    /**
     * return true if data is valid, false if not,
     * add error messages to $errorsList
     *
     * @param $data mixed
     * @param $additionalData mixed
     * @return boolen
     */
    abstract protected function validate($data, $additionalData = null);

    /**
     * returns array of errors encountered during data validation
     *
     * @return array
     */
    public function getErrorsList()
    {
        return $this->errorsList;
    }

    /**
     * returns true if data is valid, false if not,
     * baset on validate function result
     *
     * @param $data mixed
     * @param $additionalData mixed
     * @return boolen
     */
    public function isValid($data, $additionalData = null)
    {
        $this->cleanErrorsList();

        return $this->validate($data, $additionalData);
    }

    protected function cleanErrorsList()
    {
        $this->errorsList = [];
    }

    protected function addValidationError($message, $isRaw = false, $constList = [])
    {
        if ($isRaw !== false)
        {
            $this->errorsList[] = $message;
        }

        $this->loadLang();

        foreach ($constList as $key => $value)
        {
            $this->lang->addReplacementConstant($key, $value);
        }

        $this->errorsList[] = $this->lang->absoluteT('FormValidators', $message);

        return $this;
    }


    protected function loadLang()
    {
        if ($this->lang === null)
        {
            $this->lang = ServiceLocator::call('lang');
        }
    }
}
