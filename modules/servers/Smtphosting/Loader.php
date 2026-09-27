<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting;

use ModulesGarden\ProductsReseller\Server\Smtphosting as main;

if (!defined('DS'))
{
    define('DS', DIRECTORY_SEPARATOR);
}

/**
 * Module Class Loader
 *
 * @author Michal Czech <michael@modulesgarden.com>
 */
require_once __DIR__ . DS . 'vendor' . DS . 'autoload.php';

if (!class_exists(__NAMESPACE__ . '\Loader'))
{
    class Loader
    {
        static $whmcsDir;
        static $myName;
        static $avaiableDirs = [];

        /**
         * Set Paths
         *
         * @param ?string $dir
         */
        function __construct(?string $dir = null)
        {
            if (empty($dir))
            {
                $checkDirs = [
                    'modules' . DS . 'addons' . DS,
                    'modules' . DS . 'servers' . DS
                ];

                self::$myName = substr(__NAMESPACE__, 38);

                foreach ($checkDirs as $dir)
                {
                    if ($pos = strpos(__DIR__, $dir . self::$myName))
                    {
                        self::$whmcsDir = substr(__DIR__, 0, $pos);
                        break;
                    }
                }

                if (self::$whmcsDir)
                {
                    foreach ($checkDirs as $dir)
                    {
                        $tmp = self::$whmcsDir . $dir . self::$myName;
                        if (file_exists($tmp))
                        {
                            self::$avaiableDirs[] = $tmp . DS;
                        }
                    }
                }
            }
            else
            {
                self::$mainDir = $dir;
            }

            spl_autoload_register([$this, 'loader']);
        }

        /**
         * Load Class File
         *
         * @param string $className
         * @return bool
         * @author Michal Czech <michael@modulesgarden.com>
         */
        static function loader(string $className): bool
        {
            if (strpos($className, __NAMESPACE__) !== false)
            {
                $className = substr($className, strlen(__NAMESPACE__));
            }
            else
            {
                return false;
            }

            $originClassName = $className;
            $className       = ltrim($className, '\\');
            $fileName        = '';
            $namespace       = '';
            if ($lastNsPos = strrpos($className, '\\'))
            {
                $namespace = substr($className, 0, $lastNsPos);
                $className = substr($className, $lastNsPos + 1);
                $fileName  = str_replace('\\', DS, $namespace) . DS;
            }

            $fileName .= str_replace('_', DS, $className) . '.php';

            $foundFile = false;

            $error = [];

            foreach (self::$avaiableDirs as $dir)
            {
                $tmp = $dir . $fileName;

                if (!$foundFile && file_exists($tmp))
                {
                    $foundFile = $tmp;
                }
            }

            if ($foundFile)
            {
                require_once $foundFile;
            }
            return true;
        }
    }
}
