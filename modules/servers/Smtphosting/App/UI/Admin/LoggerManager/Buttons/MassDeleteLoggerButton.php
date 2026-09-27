<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\LoggerManager\Buttons;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons\ButtonMassActionContextLang;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\LoggerManager\Modals\MassDeleteLoggerModal;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;

/**
 * Description of DeleteTldButton
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class MassDeleteLoggerButton extends ButtonMassActionContextLang implements AdminArea
{
    protected $id = 'massDeleteLoggerButton';
    protected $name = 'massDeleteLoggerButton';
    protected $title = 'massDeleteLoggerButton';

    public function initContent()
    {
        $this->initLoadModalAction(new MassDeleteLoggerModal());
        $this->switchToRemoveBtn();
    }
}
