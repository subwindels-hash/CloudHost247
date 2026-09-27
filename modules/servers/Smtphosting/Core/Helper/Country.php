<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\FileReader\Reader;

/**
 * Description of Country
 *
 * @author inbs
 */
class Country
{
    protected static $instance = null;
    protected $path = '';
    protected $type = '';

    protected $country = [];

    public function __construct()
    {
        global $GLOBALS;
        $varsionArray = explode('.', $GLOBALS['CONFIG']['Version']);

        $varsion = $varsionArray[0] . "." . $varsionArray[1] . "." . $this->getOnlyNumber($varsionArray[2]);

        if (version_compare($varsion, '7.0.0', '>='))
        {
            $this->path = ModuleConstants::getFullPathWhmcs('resources', 'country', 'dist.countries.json');
            $this->type = 'json';
        }
        else
        {
            $this->path = ModuleConstants::getFullPathWhmcs('includes', 'countries.php');
            $this->type = 'php';
        }

        $this->initCountry();
    }

    protected function getOnlyNumber($string)
    {
        $length = strlen($string);
        $return = '';
        for ($i = 0; $i < $length; $i++)
        {
            if (is_numeric($string[$i]))
            {
                $return .= $string[$i];
                continue;
            }
            break;
        }

        return $return;
    }

    protected function initCountry()
    {
        if ($this->type === 'json')
        {
            foreach (Reader::read($this->path)->get() as $code => $data)
            {
                $this->country[$code] = $data['name'];
            }
        }
        else
        {
            ModuleConstants::requireFile($this->path);
            $this->country = $countries;
        }
    }

    public function getFullName($code)
    {
        if (isset($this->country[$code]))
        {
            return $this->country[$code];
        }

        return null;
    }

    public function getCountry($withKey = true)
    {
        if ($withKey)
        {
            return $this->country;
        }

        $country = [];
        foreach ($this->country as $code => $name)
        {
            $country[] = [
                'code' => $code,
                'name' => $name
            ];
        }

        return $country;
    }

    public function getCode($fullName)
    {
        if (in_array($fullName, $this->country, true))
        {
            return array_search($fullName, $this->country, true);
        }

        return null;
    }

    /**
     * @return Country
     */
    public static function getInstance()
    {
        if (self::$instance === null)
        {
            self::$instance = new self();
        }

        return self::$instance;
    }
}
