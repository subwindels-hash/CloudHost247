<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Others;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder\BaseContainer;

/**
 * InfoWidget
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class InfoWidget extends BaseContainer
{
    protected $name = 'infoWidget';
    protected $id = 'infoWidget';
    protected $title = 'infoWidgetTitle';

    public function initContent()
    {
        $this->setMessage('Test');
    }

    public function setMessage($message, $isRaw = false, $htmlTagsAllowed = false)
    {
        $description = new ModuleDescription($this->getId() . '_desc');
        $description->setDescription($message);
        $description->setRaw($isRaw);
        if ($htmlTagsAllowed)
        {
            $description->allowHtmlTags();
        }

        $this->addElement($description);
    }
}
