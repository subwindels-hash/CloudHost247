<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons\ModalActionButtons;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder\BaseContainer;

/**
 * Base Modal Cancel Button
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class BaseCancelButton extends BaseContainer
{
    protected $id = 'baseCancelButton';
    protected $name = 'baseCancelButton';
    protected $class = ['lu-btn lu-btn--danger lu-btn--outline lu-btn--plain closeModal'];
    protected $title = 'title';
    protected $htmlAttributes = [
        '@click' => 'closeModal($event)'
    ];
}
