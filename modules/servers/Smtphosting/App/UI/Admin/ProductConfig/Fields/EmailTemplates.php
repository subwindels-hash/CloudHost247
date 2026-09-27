<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Fields;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\EmailTemplate;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Lang;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\AjaxFields\Select;

class EmailTemplates extends Select implements AdminArea
{
    use Lang;

    const TYPE_PRODUCT = 'product';
    protected $id = 'emailTemplates';
    protected $name = 'emailTemplates';
    protected $title = 'emailTemplates';

    /**
     * @var EmailTemplate $emailTemplateModel
     */
    protected $emailTemplateModel = null;

    protected $defaultVueComponentName = 'mg-ajax-select-with-data';

    public function prepareAjaxData()
    {
        $this->loadLang();

        $this->loadEmailTemplateRepository();

        $this->setAvailableValues($this->loadAvailableEmailTemplates());

        $this->setSelectedValue($this->getSelectedTemplate());
    }

    protected function loadEmailTemplateRepository()
    {
        if (is_null($this->emailTemplateModel))
        {
            $this->emailTemplateModel = new EmailTemplate();
        }
    }

    protected function loadAvailableEmailTemplates()
    {
        $list = $this->emailTemplateModel->where('type', self::TYPE_PRODUCT)->get();

        $processed = [
            [
                'key'   => 'off',
                'value' => $this->lang->translate('donotsend')
            ]
        ];
        foreach ($list as $emailTemplate)
        {
            $processed[] = [
                'key'   => $emailTemplate->id,
                'value' => $emailTemplate->name
            ];
        }

        return $processed;
    }

    protected function getSelectedTemplate()
    {
        $productId = $this->getRequestValue('id');

        $settingRepo     = new Repository();
        $productSettings = $settingRepo->getProductSettings($productId);

        return ($productSettings['emailTemplate']) ?: reset($this->getAvailableValues())['key'];
    }
}
