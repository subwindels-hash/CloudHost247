<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AjaxElementInterface;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Modals\ExampleModal;

/**
 * base button controller
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class ButtonDataTableModalAction extends ButtonModal implements AjaxElementInterface
{
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\DisableButtonByColumnValue;

    protected $id = 'baseModalDataTableActionButton';
    protected $class = ['lu-btn lu-btn--sm lu-btn lu-btn--link lu-btn--icon lu-btn--plain lu-btn--default'];
    protected $icon = 'lu-btn__icon lu-zmdi lu-zmdi-edit';
    protected $title = 'baseModalDataTableActionButton';

    public function initContent()
    {
        $this->initLoadModalAction(new ExampleModal());
    }

    public function switchToRemoveBtn()
    {
        $this->replaceClasses(['lu-btn lu-btn--sm lu-btn--danger lu-btn--link lu-btn--icon lu-btn--plain']);
        $this->setIcon('lu-btn__icon lu-zmdi lu-zmdi-delete');

        return $this;
    }
}
