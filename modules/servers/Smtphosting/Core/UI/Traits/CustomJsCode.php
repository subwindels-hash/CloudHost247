<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;

/**
 * Custom Js Code(per page) related functions
 * View Trait
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait CustomJsCode
{
    protected $customJsPath = null;
    protected $customCssPath = null;

    protected function getCustomAssetPath($class, $function, $assetType = 'js', $fileType = 'js', $forceReturn = false)
    {
        $ctrlPos = stripos($class, '\App\Http\\');
        if ($ctrlPos)
        {
            $ctrl    = substr($class, $ctrlPos + 10);
            $parts   = explode('\\', $ctrl);
            $tmpType = $parts[0];
            unset($parts[0]);
            $parts[] = $function;
            array_walk($parts, function (&$value, $key) {
                $value = lcfirst($value);
            });

            array_unshift($parts, 'App', 'UI', $tmpType, 'Templates', 'assets', $assetType);
            $file = call_user_func_array([ModuleConstants::class, 'getFullPath'], $parts) . '.' . $fileType;
            if (file_exists($file) || $forceReturn === true)
            {
                return $file;
            }

            return null;
        }

        return null;
    }

    /**
     * @return string
     */
    public function getCustomJsCode()
    {
        if ($this->customJsPath && file_exists($this->customJsPath))
        {
            if (!$this->isDebugOn())
            {
                return file_get_contents($this->customJsPath);
            }

            return PHP_EOL . '/*' . PHP_EOL . ' * File: ' . $this->trimPath($this->customJsPath) . PHP_EOL . '*/' . PHP_EOL .
                   file_get_contents($this->customJsPath) . PHP_EOL .
                   '/*' . PHP_EOL . ' * End of ' . $this->trimPath($this->customJsPath) . PHP_EOL . '*/' . PHP_EOL;
        }
    }

    /**
     * @return string
     */
    public function getCustomCssCode()
    {
        if ($this->customCssPath && file_exists($this->customCssPath))
        {
            if (!$this->isDebugOn())
            {
                return file_get_contents($this->customCssPath);
            }

            return PHP_EOL . '/*' . PHP_EOL . ' * File: ' . $this->trimPath($this->customCssPath) . PHP_EOL . '*/' . PHP_EOL .
                   file_get_contents($this->customCssPath) . PHP_EOL .
                   '/*' . PHP_EOL . ' * End of ' . $this->trimPath($this->customCssPath) . PHP_EOL . '*/' . PHP_EOL;
        }
    }

    public function trimPath($path)
    {
        if (stripos($path, 'app' . DIRECTORY_SEPARATOR . 'UI') !== false)
        {
            $parts = explode('app' . DIRECTORY_SEPARATOR . 'UI', $path);

            $path = '...' . DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR . 'UI' . end($parts);
        }

        return $path;
    }


    public function initCustomAssetFiles()
    {
        $this->customJsPath  = null;
        $this->customCssPath = null;

        $controlerName = $this->getAppParam(($this->isIntegration() ? 'IntegrationControlerName' : 'HttpControlerName'));
        $method        = $this->getAppParam(($this->isIntegration() ? 'IntegrationControlerMethod' : 'HttpControlerMethod'));

        if (!is_string($controlerName) || !is_string($method) || $controlerName === '' || $method === '')
        {
            return false;
        }

        $this->customJsPath  = $this->getCustomAssetPath($controlerName, $method);
        $this->customCssPath = $this->getCustomAssetPath($controlerName, $method, 'css', 'css');
    }

    public function debugGetAssetsPlacement()
    {
        $controlerName = $this->getAppParam(($this->isIntegration() ? 'IntegrationControlerName' : 'HttpControlerName'));
        $method        = $this->getAppParam(($this->isIntegration() ? 'IntegrationControlerMethod' : 'HttpControlerMethod'));

        if (!is_string($controlerName) || !is_string($method) || $controlerName === '' || $method === '')
        {
            return false;
        }

        return [
            'js'  => $this->getCustomAssetPath($controlerName, $method, 'js', 'js', true),
            'css' => $this->getCustomAssetPath($controlerName, $method, 'css', 'css', true)
        ];
    }
}
