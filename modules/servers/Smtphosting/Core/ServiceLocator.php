<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection\DependencyInjection;

/**
 * Class ServiceLocator
 * @package ModulesGarden\ProductsReseller\Server\Smtphosting\Core
 * @TODO remove that class //MM
 */
class ServiceLocator extends DependencyInjection
{
    /**
     * @var bool
     * @TODO - move it to different class //MM
     */
    public static $isDebug = false;
}
