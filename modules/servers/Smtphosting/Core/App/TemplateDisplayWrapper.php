<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;

/**
 * Template Display Wrapper
 *
 * @author slawomir@modulesgarden.com
 */
class TemplateDisplayWrapper
{
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Lang;

    protected $templateName = null;
    protected $templateDir = null;
    protected $vars = [];


    public function __construct($templateName = null, $templateDir = null, $vars = [], $lang = null)
    {
        $this->setTemplate($templateName, $templateDir);
        $this->setVars($vars);
        $this->setLang($lang);
    }

    public function toHtml()
    {
        $pageContent = ServiceLocator::call('smarty')
            ->setLang($this->lang)
            ->setTemplateDir($path)
            ->view($fileName, $vars);

        return $pageContent;
    }

    public function setTemplate($templateName = null, $templateDir = null)
    {
        if (file_exists($templateDir . DIRECTORY_SEPARATOR . $templateName . '.tpl'))
        {
            $this->templateName = $templateName;
            $this->templateDir  = $templateDir;
        }
    }

    public function setVars($vars = [])
    {
        if (is_array($vars))
        {
            $this->vars = $vars;
        }
    }

    public function setLang($lang = null)
    {
        if ($lang instanceof \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Lang)
        {
            $this->lang = $lang;
        }

        $this->loadLang();
    }
}
