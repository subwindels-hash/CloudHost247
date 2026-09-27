<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

/**
 * DisableButtonByColumnValue related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait DisableButtonByColumnValue
{
    protected $disableByColumnValue = false;
    protected $disableColumnName = null;
    protected $disableColumnValue = null;

    public function setDisableByColumnValue($disableColumnName, $disableColumnValue)
    {
        if (is_string($disableColumnName))
        {
            $this->disableColumnValue   = $disableColumnValue;
            $this->disableColumnName    = $disableColumnName;
            $this->disableByColumnValue = true;
        }

        return $this;
    }

    public function unsetDisableByColumnValue()
    {
        $this->disableColumnValue   = null;
        $this->disableColumnName    = null;
        $this->disableByColumnValue = false;

        return $this;
    }

    public function isDisableByColumnValue()
    {
        return $this->disableByColumnValue;
    }

    public function getDisableColumnName()
    {
        return $this->disableColumnName;
    }

    public function getDisableByColumnValue()
    {
        return $this->disableColumnValue;
    }

    public function isDisableColumnValueString()
    {
        return is_string($this->disableColumnValue);
    }
}
