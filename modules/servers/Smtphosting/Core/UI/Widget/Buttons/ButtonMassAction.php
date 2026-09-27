<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Modals\ExampleModal;

/**
 * base button controller
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class ButtonMassAction extends ButtonModal
{
    protected $id = 'baseMassActionButton';
    protected $class = ['lu-btn lu-btn--link lu-btn--plain lu-btn--default'];
    protected $icon = 'lu-btn__icon lu-zmdi lu-zmdi-account';
    protected $title = 'baseMassActionButton';
    protected $htmlAttributes = [
        'href' => 'javascript:;'
    ];

    public function initContent()
    {
        $this->initLoadModalAction((new ExampleModal()));
    }

    public function switchToRemoveBtn()
    {
        $this->replaceClasses(['lu-btn lu-btn--danger lu-btn--link lu-btn--plain']);
        $this->setIcon('lu-btn__icon lu-zmdi lu-zmdi-delete');

        return $this;
    }
}
