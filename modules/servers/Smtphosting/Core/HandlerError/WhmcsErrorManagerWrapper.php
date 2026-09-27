<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError;

class WhmcsErrorManagerWrapper
{
    protected static $errorManager = null;

    public static function setErrorManager(&$errManager = null)
    {
        if ($errManager)
        {
            self::$errorManager = $errManager;
        }
    }

    /**
     * @return null
     */
    public static function getErrorManager()
    {
        return self::$errorManager;
    }
}
