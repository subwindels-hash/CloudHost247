<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\RegisterManager;

/**
 * Description of Entity
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class Entity
{
    protected $key;
    protected $data;

    public function setData($data)
    {
        $this->data = $data;

        return $this;
    }

    public function getData()
    {
        return $this->data;
    }

    public function setKey($key)
    {
        $this->key = $key;

        return $this;
    }

    public function getKey()
    {
        return $this->key;
    }
}
