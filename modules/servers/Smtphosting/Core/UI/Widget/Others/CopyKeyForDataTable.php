<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Others;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder\BaseContainer;

/**
 * CopyKeyForDataTable - a copy on click ui element
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class CopyKeyForDataTable extends BaseContainer
{
    protected $id = 'copyKeyForDataTable';
    protected $name = 'copyKeyForDataTable';

    protected $vueComponent = true;
    protected $defaultVueComponentName = 'ds-copy-on-click';

    protected $textToCopy = null;

    public function setCopyText($textToCopy)
    {
        if (is_string($textToCopy) && trim($textToCopy) !== '')
        {
            $this->textToCopy = $textToCopy;
        }

        return $this;
    }

    public function getCopyText()
    {
        return $this->textToCopy;
    }
}
