<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Pages;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Others\InfoWidget;

class CronInfo extends InfoWidget implements AdminArea
{
    protected $id = 'cronInfo';
    protected $name = 'cronInfo';
    protected $title = 'cronInfoTitle';

    public function initContent()
    {
        $cronPath = ModuleConstants::getModuleRootDir() . DIRECTORY_SEPARATOR . 'cron' . DIRECTORY_SEPARATOR . 'cron.php';
        $this->setMessage('php -q ' . $cronPath . ' queue', true);
    }
}
