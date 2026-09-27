<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI;


use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\Dispatcher;

class CustomFieldsSection
{
    /**
     *
     */
    const CUSTOM_FIELDS = 'customFields';

    /**
     * @var array
     */
    protected $customFields;
    /**
     * @var \Smarty
     */
    protected $smarty;

    /**
     * ConfigOptionsSection constructor.
     * @param array $customFields
     */
    public function __construct(array $customFields)
    {
        $this->smarty = new \Smarty();
        global $templates_compiledir;
        $this->smarty->compile_dir   = $templates_compiledir;
        $this->smarty->force_compile = 1;
        $this->smarty->caching       = 0;

        $this->customFields = $customFields;
    }

    /**
     * @return string|void
     */
    public function getCustomFieldSection(): ?string
    {
        if (empty($this->customFields))
        {
            return null;
        }
        try
        {
            ModuleConstants::initialize();
            $injectorScript = ModuleConstants::getTemplatesDir() . DIRECTORY_SEPARATOR . self::CUSTOM_FIELDS . '.tpl';
            $templateDir    = ModuleConstants::getTemplatesDir();

            $this->smarty->template_dir = $templateDir;
            $lang                       = \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Lang\Lang::getInstance();

            if (empty($this->customFields))
            {
                return '';
            }

            $this->smarty->assign('template ', Dispatcher::getAATemplate('customFields'));
            $this->smarty->assign('lang', $lang);
            $this->smarty->assign('whmcsProductId', $_REQUEST['id']);
            $this->smarty->assign('customFields', $this->customFields);
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
