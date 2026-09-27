<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

/**
 * Ajax actions callback related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait CallBackFunction
{
    protected $callBackFunction = null;

    public function getCallBackFunction()
    {
        return $this->callBackFunction;
    }

    public function setCallBackFunction($callBackFunction = null)
    {
        $this->callBackFunction = $callBackFunction;

        return $this;
    }
}
