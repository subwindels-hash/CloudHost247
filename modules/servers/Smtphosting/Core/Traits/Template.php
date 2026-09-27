<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits;

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits;

trait Template
{
    protected $templateName = null;
    protected $templateDir = null;

    /**
     * @return string|null
     */
    public function getTemplateDir()
    {
        return $this->templateDir;
    }

    /**
     * @return string|null
     */
    public function getTemplateName()
    {
        return $this->templateName;
    }

    public function setTemplateName($templateName)
    {
        $this->templateName = $templateName;

        return $this;
    }

    public function setTemplateDir($templateDir)
    {
        $this->templateDir = $templateDir;

        return $this;
    }
}
