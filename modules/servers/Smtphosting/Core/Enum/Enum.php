<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Enum;

/**
 * Description of Enum
 *
 * @author Pawel Kopec <pawelk@modulesgardne.com>
 */
abstract class Enum
{
    static function getKeys()
    {
        $class = new ReflectionClass(get_called_class());
        return array_keys($class->getConstants());
    }
}
