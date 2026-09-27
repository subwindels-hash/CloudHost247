<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers;


use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;

class ActionsFileGenerator
{
    /**
     * @var string
     */
    private $content = "<?php\n" . 'use ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\SubmoduleController;' . "\n\n";

    /**
     * @param string $actionName
     */
    public function addAction(string $actionName): void
    {
        $this->content .= 'function Smtphosting_' . $actionName . '($params)' . "\n" .
                          "{\n" .
                          "\treturn SubmoduleController::call(\"$actionName\", " . '$params);' . "\n" .
                          "}\n";
    }

    /**
     *
     */
    public function save(): void
    {
        $dir = ModuleConstants::getStorageDir() . DIRECTORY_SEPARATOR . "app" . DIRECTORY_SEPARATOR . "GeneratedFunctions.php";
        file_put_contents($dir, $this->content);
    }
}
