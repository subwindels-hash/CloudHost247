<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\RegisterManager;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\Exception;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\ErrorCodes\ErrorCodesLib;

/**
 * Description of Register
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class Register
{
    /**
     * @var Register
     */
    private static $instace;

    /**
     * @var Entity[]
     */
    private $registeredEntity = [];

    private function __construct()
    {

    }

    private function __clone()
    {

    }

    public function register($key = null, $data = null)
    {

        if ($key != null)
        {
            if ($this->isRegister($key))
            {
                throw new Exception(ErrorCodesLib::CORE_CREG_000001, ['registerKey' => $key]);
            }

            $key                          = str_replace(' ', '', $key);
            $this->registeredEntity[$key] = $this->factoryEntityModel()
                ->setKey($key)
                ->setData($data);
        }

        return $this;
    }

    public function isRegister($key = null)
    {
        return isset($this->registeredEntity[$key]);
    }

    public function registry($key = null)
    {
        if ($this->isRegister($key))
        {
            return $this->registeredEntity[$key]->getData();
        }

        return null;
    }

    public function removeRegistry($key = null)
    {
        if ($this->isRegister($key))
        {
            unset($this->registeredEntity[$key]);
        }

        return $this;
    }

    protected static function createInstace()
    {
        self::$instace = (new Register());
    }

    public static function getInstace()
    {
        if (self::$instace === null)
        {
            self::createInstace();
        }

        return self::$instace;
    }

    /**
     * @return Entity
     */
    public function factoryEntityModel()
    {
        return (new Entity());
    }
}
