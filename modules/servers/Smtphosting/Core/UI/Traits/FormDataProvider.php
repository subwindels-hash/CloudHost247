<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\FormDataProviderInterface;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper;

/**
 * Form DataProvider related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait FormDataProvider
{

    /**
     * Providing save and load data functionalities for Forms
     * @var \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\FormDataProviderInterface
     */
    protected $dataProvider = null;
    protected $providerClass = '';

    public function loadProvider()
    {
        if ($this->providerClass != '' && !is_object($this->dataProvider))
        {
            $this->setProvider(Helper\di($this->providerClass));
        }

        return $this;
    }

    /**
     * Sets data provider for Form
     * @return $this
     */
    public function setProvider(FormDataProviderInterface $provider)
    {
        $this->dataProvider = $provider;
        if (method_exists($this, 'getFormType'))
        {
            $this->dataProvider->setParentFormType($this->getFormType());
        }

        return $this;
    }

    public function getFormData()
    {
        if ($this->dataProvider === null)
        {
            $this->loadProvider();
        }

        return $this->dataProvider->getData();
    }
}
