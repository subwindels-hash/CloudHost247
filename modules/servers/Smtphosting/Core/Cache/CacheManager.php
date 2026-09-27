<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Cache;

use Symfony\Component\Cache\Simple\FilesystemCache;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Interfaces\CacheManagerInterface;

/**
 * Description of CacheManager
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class CacheManager implements CacheManagerInterface
{
    protected static $instance = null;

    /**
     * @var CacheManagerInterface
     */
    protected $manager;

    /**
     * @var string
     */
    protected $dir = '';

    /**
     * @var string
     */
    protected $namespace = '';

    /**
     * @var string
     */
    protected $key;

    /**
     * @var string|array|object
     */
    protected $data;

    public function __construct()
    {
        $this->namespace = ModuleConstants::getRootNamespace();
        $this->dir       = ModuleConstants::getModuleRootDir() . DS . 'storage' . DS . 'framework';
        $this->manager   = new FilesystemCache('', 0, $this->dir);
    }

    private function __clone()
    {

    }


    /**
     * @param string $key
     * @return $this
     * @throws \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\MGModuleException
     */
    public function setKey($key = 'default')
    {
        try
        {
            $this->key = $key;
            $this->setData($this->manager->get($this->key));
        }
        catch (\Exception $ex)
        {
            throw new \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\MGModuleException(self::class, $ex->getMessage(), $ex->getCode(), $ex);
        }


        return $this;
    }

    /**
     * @return string
     */
    public function getKey()
    {
        return $this->key;
    }

    /**
     * @param mixed $data
     * @return $this
     */
    public function setData($data = null)
    {
        if ($data !== null)
        {
            $this->data = $data;
        }

        return $this;
    }

    /**
     * @return mixed
     * @throws \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\MGModuleException
     */
    public function getData()
    {
        try
        {
            if (isset($this->key))
            {
                $this->data = $this->manager->get($this->key);
            }
            return $this->data;
        }
        catch (\Exception $ex)
        {
            throw new \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\MGModuleException(self::class, $ex->getMessage(), $ex->getCode(), $ex);
        }

    }

    /**
     * @return $this
     * @throws \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\MGModuleException
     */
    public function save()
    {
        try
        {
            $this->manager->set($this->key, $this->data);
        }
        catch (\Exception $ex)
        {
            throw new \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\MGModuleException(self::class, $ex->getMessage(), $ex->getCode(), $ex);
        }
        return $this;
    }

    /**
     * @return $this
     * @throws \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\MGModuleException
     */
    public function remove()
    {
        try
        {
            $this->manager->delete($this->key);
        }
        catch (\Exception $ex)
        {
            throw new \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\MGModuleException(self::class, $ex->getMessage(), $ex->getCode(), $ex);
        }
        return $this;
    }

    /**
     * @return $this
     * @throws \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\MGModuleException
     */
    public function clearAll()
    {
        try
        {
            $this->manager->clear();
        }
        catch (\Exception $ex)
        {
            throw new \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\MGModuleException(self::class, $ex->getMessage(), $ex->getCode(), $ex);
        }
        return $this;
    }

    /**
     * @return type
     * @throws \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\MGModuleException
     */
    public function exist()
    {
        try
        {
            return $this->manager->has($this->key);
        }
        catch (\Exception $ex)
        {
            throw new \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\MGModuleException(self::class, $ex->getMessage(), $ex->getCode(), $ex);
        }
    }

    /**
     * @return CacheManager
     */
    public static function instance()
    {
        if (CacheManager::$instance === null)
        {
            CacheManager::$instance = new CacheManager();
        }
        return CacheManager::$instance;
    }

    public static function cache($key = null)
    {
        $istance = self::instance();
        if ($key)
        {
            $istance->setKey($key);
        }

        return $istance;
    }
}
