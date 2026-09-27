<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Helpers\AlertTypesConstants;

/**
 * Alerts related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait Alerts
{
    protected $internalAlertMessage = null;
    protected $internalAlertMessageType = 'info';
    protected $internalAlertMessageRaw = false;
    protected $internalAlertSize = 'sm';

    public function setInternalAlertMessage($message)
    {
        if (is_string($message))
        {
            $this->internalAlertMessage = $message;
        }

        return $this;
    }

    public function getInternalAlertMessage()
    {
        return $this->internalAlertMessage;
    }

    public function setInternalAlertMessageType($type)
    {
        if (in_array($type, AlertTypesConstants::getAlertTypes()))
        {
            $this->internalAlertMessageType = $type;
        }

        return $this;
    }

    public function getInternalAlertMessageType()
    {
        return $this->internalAlertMessageType;
    }

    public function setInternalAlertMessageRaw($isRaw = false)
    {
        if (is_bool($isRaw))
        {
            $this->internalAlertMessageRaw = $isRaw;
        }

        return $this;
    }

    public function isInternalAlertMessageRaw()
    {
        return $this->internalAlertMessageRaw;
    }

    public function addInternalAlert($message = null, $type = null, $size = null, $isRaw = false)
    {
        $this->setInternalAlertMessage($message);
        $this->setInternalAlertMessageType($type);
        $this->setInternalAlertSize($size);
        $this->setInternalAlertMessageRaw($isRaw);

        return $this;
    }

    public function haveInternalAlertMessage()
    {
        return $this->internalAlertMessage !== null;
    }

    public function setInternalAlertSize($size = null)
    {
        if (in_array($size, AlertTypesConstants::getAlertSizes()))
        {
            $this->internalAlertSize = $size;
        }

        return $this;
    }

    public function getInternalAlertSize()
    {
        return $this->internalAlertSize;
    }
}
