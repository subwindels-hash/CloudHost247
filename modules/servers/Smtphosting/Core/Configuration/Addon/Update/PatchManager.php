<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration\Addon\Update;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;

/**
 * Description of PatchManager
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class PatchManager
{

    protected $updatePath;

    protected $updateFiles = [];

    public function __construct()
    {
        $this->updatePath = ModuleConstants::getModuleRootDir() . DS . "app" . DS . "Configuration" . DS . "Addon" . DS . "Update" . DS . "Patch";
        $this->loadUpdatePath();
    }

    public function run($newVersion, $oldVersion)
    {
        $fullPath = $this->getUpdatePath();
        array_map(function ($version, $fileName) use ($newVersion, $oldVersion, $fullPath) {
            if ($this->checkVersion($newVersion, $oldVersion, $version))
            {
                try
                {
                    $className = ModuleConstants::getRootNamespace() . "\App\Configuration\Addon\Update\Patch\\" . $fileName;
                    DependencyInjection::create($className)->setVersion($version)->execute();
                }
                catch (\Exception $exc)
                {
                    ServiceLocator::call("errorManager")
                        ->addError(
                            self::class,
                            $exc->getMessage(),
                            [
                                "newVersion"    => $newVersion,
                                "oldVersion"    => $oldVersion,
                                "updateVersion" => $version,
                                "fullFileName"  => $fullPath . DS . $fileName . ".php"
                            ]
                        );
                }

            }
        },
            array_keys($this->getUpdateFiles()),
            $this->getUpdateFiles()
        );

        return $this;
    }


    protected function checkVersion($newVersion, $oldVersion, $fileVersion)
    {
        if (version_compare($oldVersion, $fileVersion, "<"))
        {
            return true;
        }

        return false;
    }

    protected function getUpdatePath()
    {
        return $this->updatePath;
    }

    protected function getUpdateFiles()
    {
        return $this->updateFiles;
    }

    protected function loadUpdatePath()
    {
        $files = scandir($this->getUpdatePath(), 1);

        if (count($files) != 0)
        {
            foreach ($files as $file)
            {
                if ($file !== "." && $file !== "..")
                {
                    $version                     = $this->generateVersion($file);
                    $this->updateFiles[$version] = explode(".", $file)[0];
                }
            }
        }
    }

    protected function generateVersion($fileName)
    {
        $name = explode('.', $fileName)[0];
        return str_replace(["M", "P"], ".", substr($name, 1));
    }
}
