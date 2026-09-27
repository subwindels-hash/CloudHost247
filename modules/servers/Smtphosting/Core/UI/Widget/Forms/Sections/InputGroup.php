<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Sections;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\Description;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\InputGroupElements;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Validators\BaseValidator;

/**
 * InputGroup section controler
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class InputGroup extends BaseSection
{
    use Description;

    protected $id = 'inputGroup';
    protected $name = 'inputGroup';

    public function __construct($baseId = null)
    {
        parent::__construct($baseId);
        $this->description = null;
    }

    public function addInputComponent($component)
    {
        $this->addField($component);

        return $this;
    }

    public function addTextField($initName, $placecholder = false, $notEmpty = true, BaseValidator $validator = null)
    {
        $newTextField = new InputGroupElements\Text($initName);
        if ($notEmpty && !$validator)
        {
            $newTextField->notEmpty();
        }
        else
        {
            $newTextField->addValidator($validator);
        }

        if ($placecholder)
        {
            $newTextField->setPlaceholder($placecholder);
        }

        $this->addInputComponent($newTextField);

        return $this;
    }

    public function addInputAddon($initName, $title = false, $rawTitle = false)
    {
        $newAddonField = new InputGroupElements\InputAddon();
        $newAddonField->setName($initName);

        if ($title)
        {
            $newAddonField->setTitle($title);
        }

        if ($rawTitle)
        {
            $newAddonField->setRawTitle($rawTitle);
        }

        $this->addInputComponent($newAddonField);

        return $this;
    }
}
