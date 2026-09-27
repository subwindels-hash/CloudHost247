<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper;

class WhmcsVersionComparator
{
    /*
     * $toCompare - version string eg '7.1.0'
     * return bool
     */

    public static function isWhmcsVersionHigherOrEqual($toCompare)
    {
        if (isset($GLOBALS['CONFIG']['Version']))
        {
            $version = explode('-', $GLOBALS['CONFIG']['Version']);
            return (version_compare($version[0], $toCompare, '>='));
        }

        global $whmcs;

        return (version_compare($whmcs->getVersion()->getRelease(), $toCompare, '>='));
    }

    public function isWVersionHigherOrEqual($toCompare)
    {
        return self::isWhmcsVersionHigherOrEqual($toCompare);
    }
}
