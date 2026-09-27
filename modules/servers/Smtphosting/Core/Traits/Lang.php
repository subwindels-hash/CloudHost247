<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;

trait Lang
{
    /**
     * @var null|\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Lang\Lang
     */
    protected $lang = null;

    public function loadLang()
    {
        if ($this->lang === null)
        {
            $this->lang = ServiceLocator::call('lang');
        }
    }
}