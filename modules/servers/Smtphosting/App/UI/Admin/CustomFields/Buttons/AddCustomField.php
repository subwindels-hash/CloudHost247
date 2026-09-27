<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\CustomFields\Buttons;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons\ButtonDataTableModalAction;

class AddCustomField extends ButtonDataTableModalAction implements AdminArea
{
    protected $id = 'addCustomFieldButton';
    protected $name = 'addCustomFieldButton';
    protected $title = 'addCustomFieldButtonTitle';

    protected $icon = 'lu-btn__icon lu-zmdi lu-zmdi-plus';

    public function initContent()
    {
        $this->addHtmlAttribute('v-if', "!dataRow.exists");

        $modal = new AddCustomFieldsModal();
        $this->initLoadModalAction($modal);
    }

}