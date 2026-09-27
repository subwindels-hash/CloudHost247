<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons\DropdawnButtonWrappers;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\DropdownItemInterface;

/**
 * A button in dropdawn buttons list
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class ButtonDropdownItem extends \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons\ButtonModal
{
    protected $id = 'duttonDropdownItem';
    protected $class = ['lu-dropdown__link'];
    protected $icon = 'lu-dropdown__link-icon lu-zmdi lu-zmdi-edit';
    protected $title = 'dropdownButton';
    protected $htmlAttributes = [
        'href' => 'javascript:;'
    ];
}
