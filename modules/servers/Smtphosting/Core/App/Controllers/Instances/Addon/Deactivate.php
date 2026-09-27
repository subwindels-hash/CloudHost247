<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\Addon;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Interfaces\AddonController;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;

/**
 * Deactivate module action
 */
class Deactivate extends \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\AddonController implements AddonController
{

    /**
     * @param array $params
     * @return array
     */
    public function execute($params = [])
    {
        try
        {
            // before
            $return = ServiceLocator::call(\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration\Addon\Deactivate\Before::class)->execute($params);

            if (!isset($return['status']))
            {
                $return['status'] = 'success';
            }

            // after
            $return = ServiceLocator::call(\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration\Addon\Deactivate\After::class)->execute($return);

            return $return;
        }
        catch (\Exception $exc)
        {
            ServiceLocator::call(\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\ErrorManager::class)->addError(self::class, $exc->getMessage(), $return);
            return [
                'status'      => 'error',
                'description' => $exc->getMessage()
            ];
        }
    }
}
