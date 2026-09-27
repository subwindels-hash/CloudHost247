<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\LoggerManager\Modals;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Modals\BaseModal;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\LoggerManager\Forms\DeleteLoggerForm;

/**
 * DOE DeleteLabelModal controler
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class DeleteLoggerModal extends BaseModal implements AdminArea
{
    protected $id = 'deleteLoggerModal';
    protected $name = 'deleteLoggerModal';
    protected $title = 'deleteLoggerModal';

    public function initContent()
    {
        $deleteLabelForm = new DeleteLoggerForm();

        $this->replaceSubmitButtonClasses(['btn btn--danger submitForm']);

        $this->addForm($deleteLabelForm);
    }
}
