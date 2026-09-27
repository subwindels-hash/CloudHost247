<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Http\Request;

/**
 * Adds methods to handle requests data
 */
trait RequestObjectHandler
{
    /**
     * request object variable
     * @var \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Http\Request
     */
    protected $request = null;

    /**
     * loads request object
     */
    protected function loadRequestObj()
    {
        if ($this->request === null)
        {
            $this->request = Request::build();
        }

        return $this;
    }

    /**
     * returns data from request by provided $key or dafault value if key was not found
     * @param string $key
     * @param mixed $defaultValue
     * @return string|array|int
     */
    public function getRequestValue($key, $defaultValue = false)
    {
        $this->loadRequestObj();

        if ($this->request)
        {
            return $this->request->get($key, $defaultValue);
        }

        return $defaultValue;
    }
}
