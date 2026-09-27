<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core;


class ModuleConstants
{
    private static $mgHelperLangs = '';
    private static $mgModuleRootDir = '';
    private static $assetsDir = '';
    private static $templatesDir = '';
    private static $imagesDirForSmarty = '';
    private static $templatesDirForSmarty = '';
    private static $stylesDir = '';
    private static $stylesDirForSmarty = '';
    private static $jsDir = '';
    private static $jsDirForSmarty = '';
    private static $storageDir = '';
    //framework
    private static $mgDevConfig = '';
    private static $mgCoreConfig = '';
    private static $mgTemplateDir = '';
    protected static $prefixDataBase = '';
    protected static $mgModuleNamespace = 'ModulesGarden\ProductsReseller\Server\Smtphosting';
    private static $mgIntegrationsDir = '';


    protected static $mgIsPhp7 = false;

    public static function initialize()
    {
        self::$mgModuleRootDir       = dirname(__DIR__);
        self::$mgHelperLangs         = self::getFullPath("langs");
        self::$assetsDir             = self::getFullPath("templates", "assets");
        self::$stylesDir             = self::getFullPath("templates", "assets", "styles");
        self::$templatesDir          = self::getFullPath("templates", "assets", "tpl");
        self::$jsDir                 = self::getFullPath("templates", "assets", "js");
        self::$templatesDirForSmarty = self::getFullPathForSmarty("templates", "assets", "tpl");
        self::$stylesDirForSmarty    = self::getFullPathForSmarty("templates", "assets", "css");
        self::$imagesDirForSmarty    = self::getFullPathForSmarty("templates", "assets", "img");
        self::$jsDirForSmarty        = self::getFullPathForSmarty("templates", "assets", "js");
        self::$storageDir            = self::getFullPath("storage");

        self::$mgModuleRootDir = dirname(__DIR__);
        self::$mgDevConfig     = self::getFullPath("App", "Config");
        self::$mgHelperLangs   = self::getFullPath("langs");
        self::$mgCoreConfig    = self::getFullPath("Core", "Config");
        self::$mgTemplateDir   = self::getFullPath("templates");
        self::$mgIsPhp7        = self::checkIfPhp7();
        self::$prefixDataBase  = self::loadDataBasePrefix();
        self::$mgIntegrationsDir  = self::getFullPath('Submodules');
    }

    public static function loadDataBasePrefix()
    {
        $namespaceParts = explode("\\", self::$mgModuleNamespace);

        return end($namespaceParts);
    }

    public static function checkIfPhp7()
    {
        return (version_compare(PHP_VERSION, '7.0.0') >= 0);
    }

    public static function getDevConfigDir()
    {
        return self::$mgDevConfig;
    }

    public static function getIntegrationsDir()
    {
        return self::$mgIntegrationsDir;
    }

    public static function getCoreConfigDir()
    {
        return self::$mgCoreConfig;
    }

    public static function getLangsDir()
    {
        return self::$mgHelperLangs;
    }

    public static function getModuleRootDir()
    {
        return self::$mgModuleRootDir;
    }

    public static function getFullPath()
    {
        $fullPath = self::getModuleRootDir();
        foreach (func_get_args() as $dir)
        {
            $fullPath .= (DS . $dir);
        }

        return $fullPath;
    }

    public static function getFullNamespace()
    {
        $fullNamespace = self::getRootNamespace();
        foreach (func_get_args() as $dir)
        {
            $fullNamespace .= ("\\" . $dir);
        }

        return $fullNamespace;
    }

    public static function getFullPathWhmcs()
    {
        $fullPath = ROOTDIR;
        foreach (func_get_args() as $dir)
        {
            $fullPath .= (DS . $dir);
        }

        return $fullPath;
    }

    public static function requireFile($file, $ones = true)
    {
        if ($ones)
        {
            require_once $file;
        }
        else
        {
            require $file;
        }
    }

    public static function getTemplateDir()
    {
        return self::$mgTemplateDir;
    }

    public static function isPhp7orHigher()
    {
        return self::$mgIsPhp7;
    }

    public static function getPrefixDataBase()
    {
        return self::$prefixDataBase . "_";
    }

    public static function getRootNamespace()
    {
        return self::$mgModuleNamespace;
    }

    public static function getModuleType()
    {
        $pathParts   = explode(DIRECTORY_SEPARATOR, __DIR__);
        $typeElement = array_slice($pathParts, -3, 1);

        switch ($typeElement[0])
        {
            case 'servers':
                return 'server';
            case 'registrars':
                return 'registrar';
            default:
                return 'addon';
        }
    }


    /**
     * @return string
     */
    public static function getFullPathForSmarty(): string
    {
        global $CONFIG;
        $fullPath = str_replace(ROOTDIR, '', self::getFullPath());
        $parsed   = parse_url(trim($CONFIG["SystemURL"], '/'));
        foreach (func_get_args() as $dir)
        {
            $fullPath .= (DIRECTORY_SEPARATOR . $dir);
        }
        return $parsed['path'] !== '/' ? $parsed['path'] . $fullPath : $fullPath;
    }


    /**
     * @return mixed
     */
    public static function getMgHelperLangs(): string
    {
        return self::$mgHelperLangs;
    }

    /**
     * @return mixed
     */
    public static function getAssetsDir(): string
    {
        return self::$assetsDir;
    }

    /**
     * @return mixed
     */
    public static function getTemplatesDir(): string
    {
        return self::$templatesDir;
    }

    /**
     * @return mixed
     */
    public static function getStylesDir(): string
    {
        return self::$stylesDir;
    }

    /**
     * @return mixed
     */
    public static function getJsDir(): string
    {
        return self::$jsDir;
    }

    /**
     * @return mixed
     */
    public static function getStylesDirForSmarty(): string
    {
        return self::$stylesDirForSmarty;
    }

    /**
     * @return mixed
     */
    public static function getTemplatesDirForSmarty(): string
    {
        return self::$templatesDirForSmarty;
    }

    /**
     * @return mixed
     */
    public static function getJsDirForSmarty(): string
    {
        return self::$jsDirForSmarty;
    }

    /**
     * @return mixed
     */
    public static function getStorageDir(): string
    {
        return self::$storageDir;
    }

    /**
     * @return string
     */
    public static function getImagesDirForSmarty(): string
    {
        return self::$imagesDirForSmarty;
    }

}
