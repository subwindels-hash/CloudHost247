<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder\BaseContainer;


class ButtonCustomAction extends BaseContainer
{
    protected $id = 'ButtonCustomAction';
    protected $class = ['lu-btn lu-btn--sm lu-btn--link lu-btn--icon lu-btn--plain lu-btn--default'];
    protected $icon = 'lu-zmdi lu-zmdi-plus';
    protected $title = 'ButtonCustomAction';
    protected $htmlAttributes = [
        'href'        => 'javascript:;',
        'data-toggle' => 'lu-tooltip',
    ];

    protected $customActionName = null;
    protected $customActionParams = [];

    /**
     * Overwrite this function in order to set up:
     * $customActionName and $customActionParams values
     */
    public function initContent()
    {

    }

    /**
     * Do not use or override this method!
     */
    protected function afterInitContent()
    {
        $this->htmlAttributes['@click'] = 'makeCustomAction(\'' . $this->customActionName . '\', ' . $this->parseCustomParams() . ', $event, \'' . $this->getNamespace() . '\', \'' . $this->getIndex() . '\')';
    }

    public function setCustomActionName($name)
    {
        $this->customActionName = $name;

        return $this;
    }

    public function setCustomActionParams(array $params)
    {
        $this->customActionParams = $params;

        return $this;
    }

    public function addCustomActionParam($key, $value)
    {
        $this->customActionParams[$key] = $value;

        return $this;
    }

    protected function parseCustomParams()
    {
        if (count($this->customActionParams) === 0)
        {
            return '{}';
        }

        return $this->parseListTOJsString($this->customActionParams);
    }

    protected function parseListTOJsString($params)
    {
        $jsString = '{';
        foreach ($params as $key => $value)
        {
            $jsString .= ' ' . $key . ': ' . (is_array($value) ? ($this->parseListTOJsString($value) . ',') : ("'" . (string)$value) . "',");
        }

        $jsString = trim($jsString, ',') . ' } ';

        return $jsString;
    }

}