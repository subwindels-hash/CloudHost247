<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration\Addon\Update;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration\Addon\AbstractAfter;

/**
 * runs after module update actions
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class After extends AbstractAfter
{

    /**
     * @param array $params
     * @return array
     */
    public function execute(array $params = [])
    {

        return $params;
    }
}
