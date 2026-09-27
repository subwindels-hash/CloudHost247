<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions;

/**
 * Base module Exception type
 *
 * @author Sławomir Miśkowicz <rafal.os@modulesgarden.com>
 */
class Exception extends \Exception
{
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\ErrorCodesLibrary;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Lang;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\IsDebugOn;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\RequestObjectHandler;

    /**
     * A default error code number, selected when no code number provided
     */
    const DEFAULT_ERROR_CODE = 'CORE_ERR_000001';

    /**
     * An error code object
     *
     * @var type \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\ErrorCodes\ErrorCode
     */
    protected $errorCode = null;

    /**
     * Every Exception which can be caught as \Exception
     * @var type \Exception
     */
    protected $originalException = null;

    /**
     * An array of additionall data that will be logged with the Exception in order to help debug
     * @var type array
     */
    protected $additionalData = [];

    /**
     * An array of strings to be replaced in translate process, eg. for message:
     * "An error :xyz: occured" in order to replace key ':xyz:' with a '123' set this
     * param to: ['xyz' => '123']
     *
     * @var type array
     */
    protected $toTranslate = [];

    /**
     * This is a way to replace standard ErrorCode message, use it when no original exception
     * is present and the ErrorCode message, needs to be replaced, eg. API string error responses
     *
     * @var type string
     */
    protected $customMessage = null;

    public function __construct($errorCode = null, $additionalData = null, $toTranslate = null, $originalException = null)
    {
        $this->errorCode = $this->genErrorCode(($errorCode ?: self::DEFAULT_ERROR_CODE));

        $this->setAdditionalData($additionalData);
        $this->setToTranslate($toTranslate);

        $this->setOriginalException($originalException);
    }

    /**
     * Returns an error code for the exception
     * @return type string
     */
    public function getMgCode()
    {
        return $this->errorCode->getCode();
    }

    /**
     * Returns an error token for the exception, an unique string based on exception occurence timestamp
     * @return type string
     */
    public function getMgToken()
    {
        return $this->errorCode->getToken();
    }

    /**
     * Returns a date for the exception occurence
     * @return type string
     */
    public function getMgTime()
    {
        return date("Y-m-d H:i:s", time());
    }

    /**
     * Returns a translated or raw error message
     * @param type bool $translate
     * @return type string
     */
    public function getMgMessage($translate = true)
    {
        if ($translate)
        {
            $this->loadLang();

            $message = $this->lang->absoluteTranslate(
                $this->errorCode === self::DEFAULT_ERROR_CODE ? 'errorMessage' : 'errorCodeMessage',
                $this->selectProperMessage());
        }
        else
        {
            $message = $this->selectProperMessage();
        }

        return $this->replaceMessageVars($message);
    }

    /**
     * Replaces provided vars in the message string
     *
     * @param type $message string
     */
    public function replaceMessageVars($message)
    {
        foreach ($this->toTranslate as $key => $value)
        {
            $message = str_replace(':' . $key . ':', $value, $message);
        }

        return $message;
    }

    /**
     * Returns an originall exception object if such was provided
     *
     * @return type \Exception
     */
    public function getOriginalException()
    {
        return $this->originalException;
    }

    /**
     * Returns an array of data to be displayed when exception occured
     *
     * @return type array
     */
    public function getDetailsToDisplay()
    {
        $errorDetails = [];

        if ($this->isDebugOn() && $this->isAdminLogedIn())
        {
            $errorDetails['errorCode']  = $this->getMgCode();
            $errorDetails['errorToken'] = $this->getMgToken();
            $errorDetails['errorTime']  = $this->getMgTime();
        }

        $errorDetails['errorMessage'] = $this->getMgMessage(true);

        return $errorDetails;
    }

    /**
     * Returns an array of data to be logged when exception occured
     *
     * @return type array
     */
    public function getDetailsToLog()
    {
        $errorDetails = [];

        $errorDetails['errorCode']      = $this->getMgCode();
        $errorDetails['errorToken']     = $this->getMgToken();
        $errorDetails['errorTime']      = $this->getMgTime();
        $errorDetails['errorMessage']   = $this->getMgMessage(false);
        $errorDetails['additionalData'] = $this->getAdditionalData();

        return $errorDetails;
    }

    /**
     * Select a proper message for the exepction
     * Priority:
     * 1 custom message
     * 2 original Exception message
     * 3 error code message
     *
     * @return type string
     */
    protected function selectProperMessage()
    {
        if (is_string($this->customMessage))
        {
            return $this->customMessage;
        }

        if ($this->originalException !== null)
        {
            return $this->originalException->getMessage();
        }

        return $this->errorCode->getMessage();
    }

    /**
     * Sets a $originalException param, so you can wrap other exception in this one,
     * in order to log and parse them automatically
     *
     * @param \Exception $originalException
     */
    public function setOriginalException($originalException)
    {
        if ($originalException instanceof \Exception)
        {
            $this->originalException = $originalException;

            parent::__construct($originalException->getMessage(), $originalException->getCode(), $originalException->getPrevious());
        }
    }

    /**
     *
     * @param type $data array
     * @return $this
     */
    public function setAdditionalData($data = [])
    {
        if (is_array($data))
        {
            $this->additionalData = $data;
        }

        return $this;
    }

    /**
     *
     * @return type array
     */
    public function getAdditionalData()
    {
        return $this->additionalData;
    }

    /**
     *
     * @param type $data array
     * @return $this
     */
    public function setToTranslate($data = [])
    {
        if (is_array($data))
        {
            $this->toTranslate = $data;
        }

        return $this;
    }

    /**
     *
     * @param type $message string
     * @return $this
     */
    public function setCustomMessage($message = null)
    {
        if (is_string($message) && $message !== '')
        {
            $this->customMessage = $message;
        }

        return $this;
    }

    /**
     * Check if the exception should be logged or not
     *
     * @return boolean
     */
    public function isLogable()
    {
        if ($this->errorCode->isLogable())
        {
            return true;
        }

        if ($this->isAdminLogedIn() && $this->isDebugOn())
        {
            return true;
        }

        return false;
    }

    /**
     * Check if the administrator user is logged in current session
     *
     * @return boolean
     */
    public function isAdminLogedIn()
    {
        $this->loadRequestObj();

        $adminId = $this->request->getSession('adminid');

        if (is_int($adminId) && $adminId > 0)
        {
            return true;
        }

        return false;
    }
}
