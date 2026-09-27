<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons\ModalActionButtons;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder\BaseContainer;

/**
 * Base Modal Accept Button
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class BaseAcceptButton extends BaseContainer
{
    protected $id = 'baseAcceptButton';
    protected $name = 'baseAcceptButton';
    protected $class = ['lu-btn lu-btn--success submitForm mg-submit-form'];
    protected $title = 'title';
    protected $htmlAttributes = [
        '@click' => 'submitForm($event)'
    ];
}
