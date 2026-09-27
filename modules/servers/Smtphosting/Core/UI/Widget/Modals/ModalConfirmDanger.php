<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Modals;

/**
 * Modal for confirmation of a dangerous action
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class ModalConfirmDanger extends BaseModal
{
    protected $id = 'modalConfirmDanger';
    protected $name = 'modalConfirmDanger';
    protected $title = 'modalConfirmDanger';

    public function __construct($baseId = null)
    {
        parent::__construct($baseId);

        $this->setModalTitleTypeDanger();
    }

    public function preInitContent()
    {
        parent::preInitContent();
        $this->initActionButtons();
        $this->setSubmitButtonClassesDanger();
    }
}
