<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\LoggerManager\Modals;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Modals\BaseModal;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\LoggerManager\Forms\DeleteLoggerForm;

/**
 * DOE DeleteTldModal controler
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class MassDeleteLoggerModal extends BaseModal implements AdminArea
{
    protected $id = 'massDeleteLoggerModal';
    protected $name = 'massDeleteLoggerModal';
    protected $title = 'massDeleteLoggerModal';

    public function initContent()
    {
        $this->replaceSubmitButtonClasses(['btn btn--danger submitForm']);

        $this->addForm(new DeleteLoggerForm());
    }
}
