<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Others;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder\BaseContainer;

/**
 * ModuleDescription
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class Label extends BaseContainer
{
    const LABEL_WARNING = 'warning';
    const LABEL_DANGER  = 'danger';
    const LABEL_INFO    = 'info';
    const LABEL_DEFAULT = 'default';
    const LABEL_PRIMARY = 'primary';
    const LABEL_SUCCESS = 'success';

    protected $name = 'mgLabel';
    protected $id = 'mgLabel';
    protected $title = 'mgLabel';
    protected $class = ['lu-label lu-tooltip drop-target drop-element-attached-bottom drop-element-attached-center drop-target-attached-top drop-target-attached-center'];

    protected $message = null;
    protected $color = '';
    protected $backgroundColor = '';

    protected $labelType = false;

    public function setMessage($message)
    {
        $this->message = $message;

        return $this;
    }

    public function getMessage()
    {
        return $this->message;
    }

    public function setColor($color)
    {
        $this->color = $color;

        return $this;
    }

    public function setBackgroundColor($backgroundColor)
    {
        $this->backgroundColor = $backgroundColor;

        return $this;
    }

    public function getColor()
    {
        return $this->color;
    }

    public function getBackgroundColor()
    {
        return $this->backgroundColor;
    }

    public function setType($type)
    {
        $this->labelType = $type;
    }

    public function getType()
    {
        return $this->labelType;
    }
}
