<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\FileReader;

/**
 * Description of File
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class File
{
    public static function createFile()
    {
        // next version
    }

    public static function createPaths()
    {
        foreach (func_get_args() as $path)
        {
            if (is_array($path) && isset($path['permission']) && self::createPath($path['full'], $path['permission']) === false)
            {
                $parentPath = explode(DS, $path['full']);
                array_pop($parentPath);
                $parentPath = implode(DS, $parentPath);
                self::setPermission($parentPath);
                self::setUser($path['full'], 'www-data');
                self::createPath($path['full'], $path['permission']);
            }
            elseif (is_array($path) && self::createPath($path['full']) === false)
            {
                $parentPath = explode(DS, $path['full']);
                array_pop($parentPath);
                $parentPath = implode(DS, $parentPath);
                self::setPermission($parentPath);
                self::setUser($path['full'], 'www-data');
                self::createPath($path['full']);
            }
            else
            {
                self::createPath($path);
            }
        }
    }

    public static function createPath($path, $permission = 0777)
    {
        return !file_exists($path) ? mkdir($path, $permission) : false;
    }

    public static function setPermission($file, $permission = 0777)
    {
        return file_exists($file) ? chmod($file, $permission) : false;
    }

    public static function setUser($file, $user)
    {
        return file_exists($file) ? chown($file, $user) : false;
    }

    /**
     * @return PathValidator
     */
    public static function getValidator()
    {
        return new PathValidator();
    }
}
