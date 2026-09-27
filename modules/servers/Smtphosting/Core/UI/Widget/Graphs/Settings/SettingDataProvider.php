<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Graphs\Settings;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\DataProviders\BaseModelDataProvider;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ModuleSettings\Model;

/**
 * Description of SettingDataProvider
 *
 * @author inbs
 */
class SettingDataProvider extends BaseModelDataProvider
{
    public function __construct()
    {
        parent::__construct('\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ModuleSettings\Model');
    }

    public function read()
    {
        $data = Model::where('setting', $this->getRequestValue('index', ''))->first();

        if ($data)
        {
            $this->data = json_decode($data->value, true);
        }
        else
        {
            $customParams          = json_decode(html_entity_decode($this->getRequestValue('customParams', "{}")));
            $defaultFilter         = json_decode(html_entity_decode($this->getRequestValue('defaultFilter', "{}")));
            $this->data['setting'] = $this->getRequestValue('index', '');
            if ($customParams->labels && $defaultFilter->displayEditColor)
            {
                foreach ($customParams->labels as $label)
                {
                    $this->data[$label] = '47FF44';
                }
            }
        }
    }

    public function update()
    {
        $query = Model::where('setting', $this->formData['setting']);
        if ($query->count() > 0)
        {
            $query->update(['value' => json_encode($this->formData)]);
        }
        else
        {
            Model::create([
                'setting' => $this->formData['setting'],
                'value'   => json_encode($this->formData)
            ]);
        }
    }
}
