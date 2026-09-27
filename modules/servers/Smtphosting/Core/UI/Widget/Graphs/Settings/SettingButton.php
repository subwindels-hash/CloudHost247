<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Graphs\Settings;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons\ButtonDatatableModalContextLang;

/**
 * Description of SettingButton
 *
 * @author inbs
 */
class SettingButton extends ButtonDatatableModalContextLang
{
    protected $id = 'settingButton';
    protected $name = 'settingButton';
    protected $title = 'settingButton';

    protected $icon = 'lu-btn__icon lu-zmdi lu-zmdi-edit';

    protected $configFields = [];

    public function initContent()
    {
        $modal = new SettingModal();
        $modal->setConfigFields($this->configFields);
        $this->initLoadModalAction($modal);
    }

    public function addNamespaceScope($namespaceScope = null)
    {
        $this->namespaceScope = $namespaceScope;

        return $this;
    }

    public function getNamespace()
    {
        if ($this->namespaceScope)
        {
            return $this->namespaceScope;
        }

        return parent::getNamespace();
    }

    public function setConfigFields($fieldsList = [])
    {
        if ($fieldsList)
        {
            $this->configFields = $fieldsList;
        }

        return $this;
    }
}
