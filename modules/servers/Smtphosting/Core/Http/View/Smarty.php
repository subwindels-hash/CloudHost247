<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Http\View;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\isAdmin;

/**
 * Smarty Wrapper
 *
 * @author Michal Czech <michael@modulesgarden.com>
 * @SuppressWarnings(PHPMD)
 */
class Smarty
{
    private static $instance = null;
    private $smarty;
    private $templateDIR;
    private $lang;

    final private function __construct()
    {
        $this->smarty = new \Smarty();
    }

    private function __clone()
    {

    }

    public static function get()
    {
        if (empty(self::$instance))
        {
            self::$instance = new self;
        }

        return self::$instance;
    }

    public function setLang($land)
    {
        $this->lang = $land;

        return $this;
    }

    /**
     * Set Tempalte Dir
     *
     * @param string $dir
     * @author Michal Czech <michael@modulesgarden.com>
     */
    public function setTemplateDir($dir)
    {
        if (is_array($dir))
        {
            ServiceLocator::call('errorManager')->addError(self::class, 'Wrong Template Path : ' . $dir, ['dir' => $dir]);
        }
        $this->templateDIR = $dir;
        return $this;
    }

    /**
     * Parse Template File
     *
     * @param string $template
     * @param string $template
     * @param array $vars
     * @param string $customDir
     * @return string
     * @throws exceptions\System
     * @author Michal Czech <michael@modulesgarden.com>
     * @global string $templates_compiledir
     */
    public function view($template, $vars = [], $customDir = false)
    {
        if (is_array($customDir))
        {
            ServiceLocator::call('errorManager')->addError(self::class, 'Wrong Template Path : ' . $customDir, ['dir' => $customDir]);
            return '';
        }

        global $templates_compiledir;

        $this->smarty->template_dir = $customDir;

        if ($customDir)
        {
            $this->smarty->template_dir = $customDir;
        }
        else
        {
            $this->smarty->template_dir = $this->templateDIR;
        }

        $this->smarty->compile_dir   = $templates_compiledir;
        $this->smarty->force_compile = 1;
        $this->smarty->caching       = 0;

        $this->clear();

        $this->smarty->assign('MGLANG', $this->lang);

        if (is_array($vars))
        {
            foreach ($vars as $key => $val)
            {
                $this->smarty->assign($key, $val);
            }
        }
        if (is_array($this->smarty->template_dir))
        {
            $file = rtrim($this->smarty->template_dir[0], DS) . DS . $template . '.tpl';
        }
        else
        {
            $file = rtrim($this->smarty->template_dir, DS) . DS . $template . '.tpl';
        }
        if (!file_exists($file))
        {
            $errorManager = ServiceLocator::call('errorManager');
            $errorManager->addError(self::class, 'Unable to find Template: ' . $file, ['file' => $file]);
            return (string)$errorManager;
        }
        if (isset($vars['isError']) && $vars['isError'] === false || !isset($vars['isError']) || ServiceLocator::$isDebug === false)
        {
            return $this->smarty->fetch($template . '.tpl', uniqid());
        }
        else
        {
            $template = ModuleConstants::getTemplateDir() . DS . (isAdmin() ? "admin" : ("client" . DS . "default")) . DS . "ui" . DS . "Core" . DS . "default" . DS;

            return $this->smarty->fetch($template . 'errorComponent.tpl', uniqid());
        }

    }

    public function clear()
    {
        if (method_exists($this->smarty, 'clearAllAssign'))
        {
            $this->smarty->clearAllAssign();
        }
        elseif (method_exists($this->smarty, 'clear_all_assign'))
        {
            $this->smarty->clear_all_assign();
        }
    }

    public function fetch($stringTemplate, $params)
    {
        global $templates_compiledir;
        $this->smarty->compile_dir   = $templates_compiledir;
        $this->smarty->force_compile = 1;
        $this->smarty->caching       = 0;

        foreach ($params as $key => $val)
        {
            $this->smarty->assign($key, $val);
        }

        return $this->smarty->fetch('string:' . $stringTemplate);
    }
}
