<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Helpers\TemplateConstants;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper;

trait Template
{
    protected $templateName = null;
    protected $templateDir = null;
    protected $defaultTemplateName = 'container';
    protected $templateSet = null;
    protected $templateScope = null;
    protected $templateMainDir = null;
    protected $customTplVars = [];

    public function getTemplateDir()
    {
        return $this->templateDir;
    }

    public function getDefaultTemplateDir()
    {
        return ModuleConstants::getTemplateDir() . DS . $this->templateScope . DS . $this->templateMainDir . DS;
    }

    public function changeTemplateSet($templateSet)
    {
        if (file_exists(ModuleConstants::getTemplateDir() . DS . $this->templateScope . DS . $this->templateMainDir . DS . $templateSet))
        {
            $this->templateSet = $templateSet;
        }

        return $this;
    }

    public function getTemplateName()
    {
        return $this->templateName;
    }

    protected function loadTemplateVars()
    {
        $this->setScopes();

        $this->loadTemplateName();
        $this->loadTemplateDir();
        $this->evaluateTemplatePath();

        return $this;
    }

    protected function setScopes()
    {
        $this->checkAdmin();
        $this->loadSet();
        $this->loadMainDir();

        return $this;
    }

    protected function checkAdmin()
    {
        $this->templateScope = Helper\isAdmin() ? TemplateConstants::ADMIN_PATH : TemplateConstants::CLIENT_PATH;

        return $this;
    }

    protected function loadSet()
    {
        $this->templateSet = TemplateConstants::DEFAULT_SET_DIR;

        return $this;
    }

    protected function loadMainDir()
    {
        $this->templateMainDir = TemplateConstants::MAIN_DIR;

        return $this;
    }

    protected function loadTemplateName()
    {
        $className          = class_basename($this);
        $this->templateName = lcfirst($className);

        return $this;
    }

    protected function loadTemplateDir()
    {
        $class = get_class($this);
        $base  = $isCore = null;
        if (str_contains($class, 'ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\\'))
        {
            $base   = str_replace('ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\\', '', trim($class, '\\'));
            $isCore = true;
        }

        if (str_contains($class, 'ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\\'))
        {
            $base = str_replace('ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\\', '', trim($class, '\\'));
        }

        if (!$base)
        {
            $this->templateDir = $this->getDefaultTemplateDir() . $this->templateSet . DS;

            return $this;
        }

        $pathParts = explode('\\', $base);
        $lastPart  = end($pathParts);
        if ($lastPart === '')
        {
            unset($pathParts[key($pathParts)]);
            $lastPart = end($pathParts);
        }

        if ($lastPart === class_basename($this))
        {
            unset($pathParts[key($pathParts)]);
        }

        $this->getBasePatch($pathParts, $isCore);

        return $this;
    }

    protected function getBasePatch($pathParts, $isCore = false)
    {
        if ($isCore === true)
        {
            $this->getBaseCorePatch($pathParts);

            return $this;
        }

        $this->getBaseAppPatch($pathParts);

        return $this;
    }

    protected function getBaseCorePatch($pathParts)
    {
        $basePath = implode(DS, array_map('lcfirst', $pathParts));

        $this->templateDir = $this->getDefaultTemplateDir() . 'core' . DS . $this->templateSet . ($basePath ? DS . $basePath : '') . DS;
    }

    protected function getBaseAppPatch($pathParts)
    {
        $controler = $pathParts[0];
        unset($pathParts[0]);

        $controlerDir = ModuleConstants::getModuleRootDir() . DS . 'app' . DS . 'UI' . DS . $controler . DS . 'Templates';

        $basePath = implode(DS, array_map('lcfirst', $pathParts));

        $this->templateDir = $controlerDir . ($basePath ? DS . $basePath : '') . DS;
    }

    protected function evaluateTemplatePath()
    {
        if (!file_exists($this->templateDir . $this->templateName . '.tpl'))
        {
            $parent = get_parent_class($this);
            if ($parent)
            {
                $new = \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\di($parent, null, true);
                if ($new)
                {
                    $this->templateName = $new->getTemplateName();
                    $this->templateDir  = $new->getTemplateDir();

                    return;
                }
            }

            $this->templateName = $this->defaultTemplateName;
            $this->templateDir  = $this->getTemplateDir();
        }
    }

    public function getCustomTplVars()
    {
        return $this->customTplVars;
    }

    public function getCustomTplVarsValue($varName)
    {
        return $this->customTplVars[$varName];
    }

    public function setTemplate($patch = null, $tpl = null)
    {
        if ($patch && file_exists($patch) && is_readable($patch)
            && file_exists($patch . DIRECTORY_SEPARATOR . $tpl . '.tpl') && is_readable($patch . DIRECTORY_SEPARATOR . $tpl . '.tpl'))
        {
            $this->templateDir  = $patch;
            $this->templateName = $tpl;
        }
    }
}
