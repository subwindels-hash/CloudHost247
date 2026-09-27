<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\CustomFields\Buttons;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons\ButtonDataTableModalAction;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons\ButtonRedirect;

class OptionDetails extends ButtonRedirect implements AdminArea
{
    protected $id = 'optionDetailsButton';
    protected $name = 'optionDetailsButton';
    protected $title = 'optionDetailsButtonTitle';

    public function initContent()
    {
        $this->addHtmlAttribute('v-if', "dataRow.exists");

        $this->rawUrl = 'configproductoptions.php?action=managegroup';
        $this->setRedirectParams(['id' => ':gid']);
    }
}
