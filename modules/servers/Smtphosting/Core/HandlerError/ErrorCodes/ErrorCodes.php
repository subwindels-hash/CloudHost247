<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\ErrorCodes;

abstract class ErrorCodes
{
    const MESSAGE     = 'message';
    const LOG         = 'log';
    const CODE        = 'code';
    const DEV_MESSAGE = 'dev_message';

    /**
     * @param null $code
     * @param null $errorToken
     * @return ErrorCode|null
     */
    public function getErrorMessageByCode($code = null, $errorToken = null)
    {
        $constantName = get_class($this) . '::' . $code;
        if (!defined($constantName))
        {
            return $this->getUndefinedErrorMessage($code, $errorToken);
        }

        return $this->getErrorCode($code, constant($constantName), $errorToken);
    }

    /**
     * @param null|string $code
     * @param null|string $errorToken
     * @return ErrorCode|null
     */
    public function getUndefinedErrorMessage($code = null, $errorToken = null)
    {
        return $this->getErrorCode($code, 'Invalid Error Code!', $errorToken);
    }

    /**
     * @param null|string $code
     * @param null|string $message
     * @param null|string $token
     * @return ErrorCode|null
     */
    protected function getErrorCode($code = null, $message = null, $token = null)
    {
        $token = new ErrorCode($code, $message, ($token ?: $this->genToken()));

        return $token;
    }

    /**
     * returns a string
     */
    protected function genToken()
    {
        return md5(time());
    }

    /**
     * @param null|string $code
     * @return bool
     */
    public function errorCodeExists($code = null)
    {
        $constantName = get_class($this) . '::' . $code;
        if (!defined($constantName))
        {
            return false;
        }

        return true;
    }
}
