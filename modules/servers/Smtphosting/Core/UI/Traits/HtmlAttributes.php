<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

/**
 * Html Attributes related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait HtmlAttributes
{
    protected $htmlAttributes = [];

    public function getHtmlAttributes()
    {
        return $this->htmlAttributes;
    }

    public function addHtmlAttribute($key, $value)
    {
        $this->htmlAttributes[$key] = $value;

        return $this;
    }

    public function getHtmlAttribute($key)
    {
        return $this->htmlAttributes[$key];
    }

    public function deleteHtmlAttribute($key)
    {
        unset($this->htmlAttributes[$key]);

        return $this;
    }

    public function setHtmlAttributes(array $attribuetsList = [])
    {
        $this->htmlAttributes = $attribuetsList;

        return $this;
    }

    public function initOnClickVue($vueMethod = 'submitForm')
    {
        $stringClick = (string)$vueMethod . "(";
        $argsCount   = 0;
        foreach (func_get_args() as $param)
        {
            if ($param === $vueMethod)
            {
                continue;
            }
            if ($argsCount > 0)
            {
                $stringClick .= ',';
            }
            $stringClick .= $param;
            $argsCount++;
        }
        $stringClick                    .= ")";
        $this->htmlAttributes['@click'] = $stringClick;

        return $this;
    }
}
