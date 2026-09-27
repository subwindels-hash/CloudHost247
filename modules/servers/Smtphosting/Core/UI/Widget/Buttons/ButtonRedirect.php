<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder\BaseContainer;


class ButtonRedirect extends BaseContainer
{
    protected $id = 'redirectButton';
    protected $class = ['lu-btn lu-btn--sm lu-btn--link lu-btn--icon lu-btn--plain lu-btn--default'];
    protected $icon = 'lu-btn__icon lu-zmdi lu-zmdi-info';
    protected $title = 'redirectButton';
    protected $showTitle = false;

    /*
     * No href attribute should be added to the redirect button in order for the middle mouse button events
     * worked correctly!
     */
    protected $htmlAttributes = [
        //'href'        => 'javascript:;',
        'data-toggle' => 'lu-tooltip',
    ];

    protected $rawUrl = null;
    protected $redirectParams = [];

    public function initContent()
    {

    }

    // do not overwrite this function
    public function afterInitContent()
    {
        $this->htmlAttributes['@click.middle'] = 'redirect($event, ' . $this->parseCustomParams() . ', true)';
        $this->htmlAttributes['@click']        = 'redirect($event, ' . $this->parseCustomParams() . ')';
    }

    protected function parseCustomParams()
    {
        if (count($this->redirectParams) === 0 && $this->rawUrl === null)
        {
            return '{}';
        }

        return $this->parseListTOJsString($this->redirectParams);
    }

    protected function parseListTOJsString($params)
    {
        $jsString = '{';

        if ($this->rawUrl !== null)
        {
            $params['rawUrl'] = $this->rawUrl;
        }

        foreach ($params as $key => $value)
        {
            $jsString .= ' ' . str_replace('-', '__', $key) . ': ' . (is_array($value) ? ($this->parseListTOJsString($value) . ',') : ("'" . (string)$value) . "',");
        }

        $jsString = trim($jsString, ',') . ' } ';

        return $jsString;
    }

    public function setRawUrl($url)
    {
        $this->rawUrl = $url;

        return $this;
    }

    public function addRedirectParam($key, $value)
    {
        $this->redirectParams[$key] = $value;

        $this->updateHtmlAttributesByRedirectParams();

        return $this;
    }

    public function setRedirectParams($paramsList)
    {
        $this->redirectParams = $paramsList;

        $this->updateHtmlAttributesByRedirectParams();

        return $this;
    }

    protected function updateHtmlAttributesByRedirectParams()
    {
        foreach ($this->redirectParams as $key => $value)
        {
            $this->updateHtmlAttribute($key, $value);
        }
    }

    protected function updateHtmlAttribute($key, $value)
    {
        if (strpos($value, ':') === 0)
        {
            $this->addHtmlAttribute(':data-' . $key, 'dataRow.' . trim($value, ':'));
        }
    }
}
