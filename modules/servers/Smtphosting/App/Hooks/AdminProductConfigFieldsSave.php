<?php
$hookManager->register(
    function ($args) {
        try
        {
            if(!\ModulesGarden\ProductsReseller\Server\Smtphosting\App\Helpers\ResellerModuleChecker::isProperProduct($args['pid']))
            {
                return;
            }
            //todo product/module chceck
            $configController = new  \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\Addon\ConfigOptions();
            $configController->runExecuteProcess($args);
        }
        catch (\Exception $exc)
        {
            //do nothing on save
        }
    },
    100
);
