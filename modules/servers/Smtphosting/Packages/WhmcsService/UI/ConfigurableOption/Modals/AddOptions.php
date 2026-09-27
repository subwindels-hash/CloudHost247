<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\UI\ConfigurableOption\Modals;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Modals\BaseEditModal;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\UI\ConfigurableOption\Forms\AddOptions as AddOptionsForm;

class AddOptions extends BaseEditModal implements AdminArea
{
    protected $id = 'addOptionsModal';
    protected $name = 'addOptionsModal';
    protected $title = 'addOptionsModalTitle';

    public function initContent()
    {
        $form = new AddOptionsForm();
        $this->addForm($form);
    }
}
