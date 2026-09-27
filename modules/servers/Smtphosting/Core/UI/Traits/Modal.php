<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

/**
 * Modal Elements related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait Modal
{
    protected $confirmTitle = 'saveChanges';
    protected $cancelTitle = 'cancel';
    protected $modalSize = 'sm';
    protected $modalTitleType = 'success';

    public function getConfirmTitle()
    {
        return $this->confirmTitle;
    }

    public function setConfirmTitle($title)
    {
        $this->confirmTitle = $title;

        return $this;
    }

    public function getCancelTitle()
    {
        return $this->cancelTitle;
    }

    public function setCancelTitle($title)
    {
        $this->cancelTitle = $title;

        return $this;
    }

    public function getModalSize()
    {
        return $this->modalSize;
    }

    public function setModalSize($size = 'sm')
    {
        $this->modalSize = $size;

        return $this;
    }

    public function setModalSizeSmall()
    {
        $this->modalSize = 'sm';

        return $this;
    }

    public function setModalSizeMedium()
    {
        $this->modalSize = 'md';

        return $this;
    }

    public function setModalSizeLarge()
    {
        $this->modalSize = 'lg';

        return $this;
    }

    public function getModalTitleType()
    {
        return $this->modalTitleType;
    }

    function setModalTitleTypeDanger()
    {
        $this->modalTitleType = 'danger';

        return $this;
    }

    function setModalTitleTypeSuccess()
    {
        $this->modalTitleType = 'success';

        return $this;
    }

    function setModalTitleTypeInfo()
    {
        $this->modalTitleType = 'info';

        return $this;
    }

    function setModalTitleTypePrimary()
    {
        $this->modalTitleType = 'primary';

        return $this;
    }
}
