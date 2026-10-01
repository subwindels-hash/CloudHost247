<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\Api;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Interfaces\DefaultController;

/**
 * Placeholder for a future API controller. The module exposes no API endpoint
 * (see AppControllers\Api), so this fails closed instead of doing nothing silently.
 */
class ApiController implements DefaultController
{
    public function execute($params = null)
    {
        throw new \RuntimeException('The Smtphosting module does not expose an API endpoint.');
    }

    public function runExecuteProcess($params = null)
    {
        return $this->execute($params);
    }
}
