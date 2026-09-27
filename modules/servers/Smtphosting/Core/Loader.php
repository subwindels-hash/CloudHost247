<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core;

/**
 * Description of Loader
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class Loader
{
    private $rootdir;

    public function __construct(string $dir)
    {
        $this->rootdir = $dir;
        $this->register();
        ModuleConstants::initialize();
    }

    protected function register(): void
    {
        spl_autoload_register(function ($className) {
            $namespace = str_replace("\\Core", "", __NAMESPACE__);
            if (strpos($className, $namespace) === 0)
            {
                $className = str_replace("\\", DIRECTORY_SEPARATOR, $className);
                $file      = str_replace("ModulesGarden" . DIRECTORY_SEPARATOR . "ProductsReseller" . DIRECTORY_SEPARATOR . "Server" . DIRECTORY_SEPARATOR . "Smtphosting", $this->rootdir, $className) . '.php';

                if (file_exists($file))
                {
                    require_once $file;
                }
            }
        });
    }
}
