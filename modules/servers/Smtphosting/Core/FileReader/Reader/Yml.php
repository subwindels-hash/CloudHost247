<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\FileReader\Reader;

use Symfony\Component\Yaml\Yaml;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;

/**
 * Description of Yml
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class Yml extends AbstractType
{

    protected function loadFile()
    {
        $return = [];
        try
        {
            if (file_exists($this->path . DS . $this->file))
            {
                $return = Yaml::parse(file_get_contents($this->path . DS . $this->file));
                $return = array_map(self::class . '::replaceBackslash', $return ?: []);
            }
        }
        catch (\Symfony\Component\Yaml\Exception\ParseException $e)
        {
            ServiceLocator::call('errorManager')->addError(self::class, $e->getMessage(), $e->getTrace());
        }

        $this->data = $return;
    }

    protected static function replaceBackslash($data)
    {
        if (is_array($data))
        {
            return array_map(self::class . '::replaceBackslash', $data);
        }
        else
        {
            return str_replace('\\\\', '\\', $data);
        }
    }
}
