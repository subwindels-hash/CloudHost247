<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;


/**
 * Class ConfigOptionsSection
 */
class ConfigOptionsSection
{
    /**
     *
     */
    const CONFIG_OPTIONS = 'configOptions';

    /**
     * @var array
     */
    protected $configOptions;
    /**
     * @var \Smarty
     */
    protected $smarty;

    /**
     * ConfigOptionsSection constructor.
     * @param array $configOptions
     */
    public function __construct(array $configOptions)
    {
        $this->smarty = new \Smarty();
        global $templates_compiledir;
        $this->smarty->compile_dir   = $templates_compiledir;
        $this->smarty->force_compile = 1;
        $this->smarty->caching       = 0;

        $this->configOptions = $configOptions;
    }

    /**
     * @return string|void
     */
    public function getConfigOptionsSection(): ?string
    {
        if (empty($this->configOptions))
        {
            return null;
        }
        try
        {
            ModuleConstants::initialize();
            $injectorScript = ModuleConstants::getTemplatesDir() . DIRECTORY_SEPARATOR . self::CONFIG_OPTIONS . '.tpl';
            $templateDir    = ModuleConstants::getTemplatesDir();

            $this->smarty->template_dir = $templateDir;
            if (empty($this->configOptions))
            {
                return '';
            }

            $lang = \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Lang\Lang::getInstance();
            $this->smarty->assign('lang', $lang);
            $this->smarty->assign('whmcsProductId', $_REQUEST['id']);
            $this->smarty->assign('configOptions', $this->configOptions);
            $this->smarty->assign('jsDir', ModuleConstants::getJsDirForSmarty());
            $this->smarty->assign('cssDir', ModuleConstants::getStylesDirForSmarty());

            return $this->smarty->display('file:' . $injectorScript);
        }
        catch (\Exception $e)
        {
            return "<h1> {$e->getMessage()} </h1>";
        }

    }

}
