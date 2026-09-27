<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\DataProviders;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\FormDataProviderInterface;

/**
 * BaseDataProvider - form controller witch CRUD implementation
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
abstract class BaseDataProvider implements FormDataProviderInterface
{
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\RequestObjectHandler;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\RequestFormDataHandler;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\WhmcsParams;

    protected $data = [];
    protected $availableValues = [];
    protected $loaded = false;
    protected $disabledList = [];
    protected $parentFormType = null;

    public function __construct()
    {
        $this->loadFormDataFromRequest();
    }

    public function create()
    {
        //to be overwritten if needed
    }

    abstract public function read();

    abstract public function update();

    public function delete()
    {
        //to be overwritten if needed
    }

    public function reload()
    {
        //to be overwritten if needed
        $this->read();
    }

    public function getValueById($id)
    {
        if ($this->data[$id] || $this->data[$id] === 0)
        {
            return $this->data[$id];
        }

        return null;
    }

    public function getAvailableValuesById($id)
    {
        if (is_countable($this->availableValues[$id]) && count($this->availableValues[$id]) > 0)
        {
            return $this->availableValues[$id];
        }

        return null;
    }

    public function getData()
    {
        return $this->data;
    }

    public function isDisabledById($id)
    {
        if (in_array($id, $this->disabledList))
        {
            return true;
        }

        return false;
    }

    public function initData()
    {
        if ($this->loaded === false)
        {
            $this->read();
            $this->loaded = true;
        }
    }

    protected function setData($data)
    {
        $this->data = $data;

        return $this;
    }

    protected function setDisabled($id)
    {
        if (!in_array($id, $this->disabledList))
        {
            $this->disabledList[] = $id;
        }
    }

    protected function removeFromDisabled($id)
    {
        if (in_array($id, $this->disabledList))
        {
            $key = array_search($id, $this->disabledList[]);
            if ($key)
            {
                unset($this->disabledList[$key]);
            }
        }
    }

    public function setParentFormType($formType = null)
    {
        if (is_string($formType) && $formType !== '')
        {
            $this->parentFormType = $formType;
        }

        return $this;
    }

    public function getParentFormType()
    {
        return $this->parentFormType;
    }
}
