<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\AjaxFields;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ResponseTemplates;

/**
 * Select field controler
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class SelectRemoteSearch extends Select
{

    protected $id = 'ajaxSelectRemoteSearch';
    protected $name = 'ajaxSelectRemoteSearch';

    protected $vueComponent = true;
    protected $defaultVueComponentName = 'mg-ajax-select-rs';

    /**
     * do not overwrite this function
     * @return type \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ResponseTemplates\RawDataJsonResponse
     */
    public function returnAjaxData()
    {
        $this->prepareAjaxData();

        $returnData = [
            'options' => $this->getAvailableValues()
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
    }

    public function initContent()
    {

    }
}
