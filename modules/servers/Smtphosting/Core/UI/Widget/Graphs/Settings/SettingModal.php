<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Graphs\Settings;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Modals\BaseEditModal;

/**
 * Description of SettingModal
 *
 * @author inbs
 */
class SettingModal extends BaseEditModal
{
    protected $id = 'settingModal';
    protected $name = 'settingModal';
    protected $title = 'settingModal';

    protected $configFields = [];

    public function initContent()
    {
        $form = new SettingForm();
        $form->setConfigFields($this->configFields);
        $this->addForm($form);
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
