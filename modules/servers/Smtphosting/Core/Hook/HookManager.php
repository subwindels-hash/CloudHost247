<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Hook;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;

class HookManager
{
    protected $hookRegister = [];
    protected static $currentName = "";
    protected $files = [];

    /**
     * @var Config
     */
    protected $config;

    public function __construct($dir)
    {
        $this->config = new Config();
        $path         = $dir . DS . "App" . DS . "Hooks";
        $files        = scandir($path, 1);

        if (count($files) != 0)
        {
            foreach ($files as $key => &$value)
            {
                if ($value === "." || $value === ".." || is_dir($path . DIRECTORY_SEPARATOR . $value))
                {
                    unset($files[$key]);
                }
            }
        }

        $this->files = $files;
    }

    public function getSpecificModuleHooks()
    {
        $integrations = $this->getIntegrationsUsed();
        $integrationDir = ModuleConstants::getIntegrationsDir();
        $dirs = [];
        foreach ($integrations as $integration)
        {
            $dir = $integrationDir . DS . $integration . DS . "app". DS . "Hooks";
            if(!file_exists($dir))
            {
                continue;
            }
            $dirs[$integration] = array_map(function ($element) use ($dir) {
                return $dir . DS . $element;
            },scandir($dir));

        }
        return $dirs;
    }

    protected function getIntegrationsUsed()
    {
        $productsList = $this->getProductsForModule();
        foreach ($productsList as $product)
        {
            $resellerProductType = (new Repository())->getProductSettings($product->id)['resellerProductType'];
            $modules[]           = $resellerProductType;
        }

        return array_filter(array_unique($modules));
    }
    protected function getProductsForModule()
    {
        $modulePath = explode(DS, ModuleConstants::getModuleRootDir());
        $moduleName = end($modulePath);

        return \WHMCS\Database\Capsule::table('tblproducts')
            ->where('servertype', $moduleName)
            ->get();
    }

    public static function create($dir)
    {
        $hookManager = new HookManager($dir);
        foreach ($hookManager->getFiles() as $file)
        {
            $path = $dir . DS . "App" . DS . "Hooks" . DS . $file;
            try
            {
                HookManager::$currentName = explode(".", $file)[0];
                require $path;
            }
            catch (\Exception $e)
            {
                ServiceLocator::call('errorManager')->addError(self::class, $e->getMessage() . " ||||HookPath: {$path}", $e->getTrace());
            }
        }
        foreach ($hookManager->getSpecificModuleHooks() as $integration => $hooks)
        {
            foreach ($hooks as $hook)
            {
                if (strpos($hook, DS . ".") !== false || strpos($hook, DS . "..") !== false || is_dir($hook))
                {
                    continue;
                }
                HookManager::$currentName = basename($hook, ".php");
                require $hook;
            }

        }
        $hookManager->start();
        return $hookManager;
    }

    public function getFiles()
    {
        return $this->files;
    }

    public function register($callback, $sort = 1)
    {

        //todo ustawianie wlasnego name w zaleznosci od modulu itnegracji
        //public function registerWithname($name,$callback, $sort = 1)
        //globalny hook
        //
        $this->hookRegister[] = [
            "name"     => HookManager::$currentName,
            "function" => $callback,
            "sort"     => $sort
        ];
    }

    public function registerWithName($name,$callback, $sort = 1)
    {

    }




    protected function start()
    {
        foreach ($this->hookRegister as $hook)
        {
            if ($this->config->checkHook($hook['name']))
            {
                add_hook(
                    $hook['name'], $hook['sort'], $hook['function']
                );
            }
        }
    }
}
