<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Modals;

/**
 * BaseEditModal controller
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class BaseEditModal extends BaseModal
{
    protected $id = 'baseEditModal';
    protected $name = 'baseEditModal';
    protected $title = 'baseEditModal';

    public function __construct($baseId = null)
    {
        parent::__construct($baseId);

        $this->setModalSizeMedium();
    }
}
