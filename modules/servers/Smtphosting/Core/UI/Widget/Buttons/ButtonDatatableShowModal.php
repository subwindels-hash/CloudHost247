<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AjaxElementInterface;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Modals\ExampleModal;

/**
 * base button controller
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class ButtonDatatableShowModal extends ButtonModal implements AjaxElementInterface
{
    protected $id = 'baseDatatableModalButton';
    protected $title = 'baseDatatableModalButton';
    protected $htmlAttributes = [
        'href'        => 'javascript:;',
        'data-toggle' => 'lu-tooltip',
    ];

    public function initContent()
    {
        $this->initLoadModalAction(new ExampleModal());
    }
}
