<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons;

/**
 * Description of Button Create
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class ButtonCreate extends ButtonModal
{
    protected $id = 'buttonCreate';
    protected $class = ['lu-btn', 'lu-btn--primary'];
    protected $icon = 'lu-btn__icon lu-zmdi lu-zmdi-plus';
    protected $title = 'buttonCreate';
    protected $htmlAttributes = [
        'href' => 'javascript:;'
    ];
}
