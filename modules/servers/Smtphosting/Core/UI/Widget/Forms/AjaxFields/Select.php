<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\AjaxFields;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AjaxElementInterface;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ResponseTemplates;

/**
 * Select field controler
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class Select extends \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\Select implements AjaxElementInterface
{
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\HideByDefaultIfNoData;

    protected $id = 'ajaxSelect';
    protected $name = 'ajaxSelect';

    protected $vueComponent = true;
    protected $defaultVueComponentName = 'mg-ajax-select';

    /**
     * a list of fields id's, fi those fields are changed the select will reload its content
     * @var type array
     */
    protected $reloadOnChangeFields = [];


    /**
     * do not overwrite this function
     * @return type \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ResponseTemplates\RawDataJsonResponse
     */
    public function returnAjaxData()
    {
        $this->prepareAjaxData();

        $returnData = [
            'options'        => $this->getAvailableValues(),
            'selected'       => $this->getValue(),
            'additionalData' => $this->data['additionalData']
        ];

        return (new ResponseTemplates\RawDataJsonResponse($returnData))->setCallBackFunction($this->callBackFunction);
    }

    /**
     * overwrite this function, use setSelectedValue && setAvailableValues functions
     */
    public function prepareAjaxData()
    {
        $this->setAvailableValues([
            ['key' => '1', 'value' => 'value1'],
            ['key' => '2', 'value' => 'value2']
        ]);

        // '2' for single, ['1', '2'] for multiple
        $this->setSelectedValue('2');
    }

    public function initContent()
    {

    }

    public function addReloadOnChangeField($fieldId = null)
    {
        if (is_string($fieldId) && $fieldId !== '')
        {
            $this->reloadOnChangeFields[] = $fieldId;
        }

        return $this;
    }

    public function getReloadOnChangeFields()
    {
        return $this->reloadOnChangeFields;
    }

    public function wrappReloadIdsToString()
    {
        $str = '';

        foreach ($this->reloadOnChangeFields as $key => $value)
        {
            $str .= (string)$key . " : '" . $value . "'" . ($key === end(array_keys($this->reloadOnChangeFields)) ? ' ' : ', ');
        }

        return $str;
    }
}
