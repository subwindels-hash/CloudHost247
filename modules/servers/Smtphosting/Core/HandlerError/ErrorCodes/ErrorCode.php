<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\ErrorCodes;

class ErrorCode
{
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Lang;

    protected $code = null;
    protected $message = null;
    protected $token = null;
    protected $logable = false;

    public function __construct($code = null, $codeDetails = null, $token = null)
    {
        $this->setToken($token);
        $this->setCode($code);

        $this->setDetails($codeDetails);
    }

    /**
     * @param null $code
     */
    public function setCode($code = null)
    {
        if (is_string($code))
        {
            $this->code = $code;
        }
    }

    /**
     * @param null $message
     */
    public function setMessage($message = null)
    {
        if (is_string($message) && $message !== '')
        {
            $this->message = $message;
        }
    }

    /**
     * @param null $token
     */
    public function setToken($token = null)
    {
        if (is_string($token))
        {
            $this->token = $token;
        }
    }

    /**
     * @return string
     */
    public function getCode()
    {
        return $this->code === null ? '' : $this->code;
    }

    /**
     * @return string
     */
    public function getToken()
    {
        return $this->token === null ? '' : $this->token;
    }

    /**
     * @return string
     */
    public function getMessage()
    {
        return $this->message === null ? '' : $this->message;
    }

    public function getRawErrorMessage()
    {
        return 'Error Code: ' . ($this->getCode() ?: 'none') . ' Error Token: ' . ($this->getToken() ?: 'none') . 'Error Message: ' . $this->getMessage() ?: 'none.';
    }

    public function setLogable($logable)
    {
        if (is_bool($logable))
        {
            $this->logable = $logable;
        }
    }

    public function isLogable()
    {
        return $this->logable;
    }

    public function setDetails($codeDetails)
    {
        if (is_string($codeDetails))
        {
            $this->setMessage($codeDetails);

            return;
        }

        $this->setMessage($codeDetails[ErrorCodes::MESSAGE]);
        $this->setLogable($codeDetails[ErrorCodes::LOG]);
    }
}
