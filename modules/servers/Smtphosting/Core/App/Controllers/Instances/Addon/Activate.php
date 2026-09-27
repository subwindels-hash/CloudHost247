<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\Addon;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Interfaces\AddonController;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\DatabaseHelper;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;

/**
 * Activate module actions
 */
class Activate extends \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\AddonController implements AddonController
{
    /**
     * @var null|DatabaseHelper
     */
    protected $databaseHelper = null;

    public function execute($params = [])
    {
        try
        {
            //Before module activation
            $return = ServiceLocator::call(\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration\Addon\Activate\Before::class)->execute($params);
            if (!isset($return['status']))
            {
                $return['status'] = 'success';
            }

            //module activation process
            $return = $this->activate($return);

            //After module activation
            $return = ServiceLocator::call(\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration\Addon\Activate\After::class)->execute($return);

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

    protected function activate($params = [])
    {
        $this->databaseHelper = DependencyInjection::call(DatabaseHelper::class);

        if ($params['status'] === 'error')
        {
            return $params;
        }

        $isErrorCore     = $this->databaseHelper->performQueryFromFile(ModuleConstants::getFullPath('Core', 'Database', 'schema.sql'));
        $isErrorApp      = $this->databaseHelper->performQueryFromFile(ModuleConstants::getFullPath('App', 'Database', 'schema.sql'));
        $isErrorDataCore = $this->databaseHelper->performQueryFromFile(ModuleConstants::getFullPath('Core', 'Database', 'data.sql'));
        $isErrorDataApp  = $this->databaseHelper->performQueryFromFile(ModuleConstants::getFullPath('App', 'Database', 'data.sql'));

        if ($isErrorCore || $isErrorDataCore || $isErrorApp || $isErrorDataApp)
        {
            return ['status' => 'error', 'description' => ServiceLocator::call('errorManager')->getFirstError()->getMessage()];
        }

        return ['status' => 'success'];
    }
}
