<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper;

/**
 * Wrapper for WHMCS params passed to controler functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class WhmcsParams
{
    private $params = [];

    public function setParams($params = [])
    {
        if (is_array($params))
        {
            $this->params = $params;
        }

        return $this;
    }

    public function getParamByKey($key, $default = false)
    {
        return isset($this->params[$key]) ? $this->params[$key] : $default;
    }

    public function getWhmcsParams()
    {
        return $this->params;
    }
}
