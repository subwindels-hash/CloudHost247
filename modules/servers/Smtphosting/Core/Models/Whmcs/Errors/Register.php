<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Errors;

/**
 * Register Error in WHMCS Module Log
 *
 * @author Michal Czech <michael@modulesgarden.com>
 */
class Register extends \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\Exception
{

    protected $exception = null;

    /**
     * Register Exception in WHMCS Module Log
     *
     * @param Exception $exc
     * @author Michal Czech <michael@modulesgarden.com>
     */
    static function register($exc)
    {
        if (!self::isExceptionLogable($exc))
        {
            return;
        }

        $debug = var_export($exc, true);

        \logModuleCall("Error", __NAMESPACE__, [
            'message' => $exc->getMessage(),
            'code'    => $exc->getCode(),
            'token'   => self::getToken($exc),
        ],
            $debug, 0, 0);
    }

    /**
     * Returns an error token string
     * @return type string
     */
    public static function getToken($exception)
    {
        $token = 'Unknow Token';

        if (method_exists($exception, 'getToken'))
        {
            $token = $exception->getToken();
        }

        return $token;
    }

    /**
     * Checks if the exception can be logged
     * @return boolean
     */
    public static function isExceptionLogable($exception = null)
    {
        if (method_exists($exception, 'isLogable'))
        {
            return $exception->isLogable();
        }

        return false;
    }
}
