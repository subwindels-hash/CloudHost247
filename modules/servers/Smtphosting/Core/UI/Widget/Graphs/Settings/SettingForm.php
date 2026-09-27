<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Graphs\Settings;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\BaseForm;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\FormConstants;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\Hidden;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\Number;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\Select2vueByValueOnly;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\ColorPicker;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Graphs\EmptyGraph;

use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl;

/**
 * Description of SettingForm
 *
 * @author inbs
 */
class SettingForm extends BaseForm
{
    protected $id = 'settingForm';
    protected $name = 'settingForm';
    protected $title = 'settingForm';
    protected $providerClass = 'ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Graphs\Settings\SettingDataProvider';

    protected $configFields = [];

    public function initContent()
    {
        $this->setFormType(FormConstants::UPDATE);

        if ($this->configFields)
        {
            foreach ($this->configFields as $field)
            {
                $this->addField($field);
            }

            $this->loadDataToForm();

            return $this;
        }
        else
        {
            $field = new Hidden();
            $field->initIds('setting');
            $this->addField($field);

            $request      = sl('request');
            $lang         = sl('lang');
            $customParams = json_decode(html_entity_decode($request->get('customParams', "{}")));

            $defaultFilter = json_decode(html_entity_decode($request->get('defaultFilter', "{}")));
            if ($defaultFilter->type)
            {
                switch ($defaultFilter->type)
                {
                    case EmptyGraph::GRAPH_FILTER_TYPE_INT:
                        $startFilter = new Number();
                        $startFilter->initIds('start')->setDefaultValue($defaultFilter->default->start);
                        $endFilter = new Number();
                        $endFilter->initIds('end')->setDefaultValue($defaultFilter->default->end);
                        $this->addField($startFilter);
                        $this->addField($endFilter);
                        break;
                    case EmptyGraph::GRAPH_FILTER_TYPE_STRING:
                    case EmptyGraph::GRAPH_FILTER_TYPE_DATE:
                        $startFilter = new Select2vueByValueOnly('start');
                        $startFilter->setDefaultValue($defaultFilter->default->start);
                        $endFilter = new Select2vueByValueOnly('end');
                        $endFilter->setDefaultValue($defaultFilter->default->end);
                        if ($customParams->labels)
                        {
                            $startFilter->setAvailableValues($customParams->labels);
                            $endFilter->setAvailableValues($customParams->labels);
                        }
                        $this->addField($startFilter);
                        $this->addField($endFilter);
                        break;
                }
            }

            if ($customParams->labels && $defaultFilter->displayEditColor)
            {
                foreach ($customParams->labels as $label)
                {
                    $colorPicker = new ColorPicker($label);
                    $colorPicker->setRawTitle(str_replace(':labelName:', $label, $lang->T('labelColor')));
                    $this->addField($colorPicker);
                }
            }

            $this->loadDataToForm();
        }
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
