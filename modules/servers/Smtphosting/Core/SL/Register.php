<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\SL;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;

/**
 * Description of Register
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class Register extends AbstractReaderYml
{

    protected function load()
    {
        [$dataDev, $dataCore] = $this->readFiles();
        $data = null;

        if (isset($dataDev) && isset($dataCore))
        {
            $this->buildData($dataDev, $dataCore, $data);
        }
        elseif (!isset($dataDev) && isset($dataCore) && isset($dataCore['class']))
        {
            $data = $dataCore['class'];
        }
        elseif (isset($dataDev) && !isset($dataCore) && isset($dataDev['class']))
        {
            $data = $dataDev['class'];
        }
        $this->data = $data;
    }

    private function buildData($dataDev, $dataCore, &$data)
    {
        if (isset($dataDev['class']) && isset($dataCore['class']))
        {
            foreach ($dataCore['class'] as $core)
            {
                $isFind = false;
                foreach ($dataDev['class'] as $dev)
                {
                    if ($dev['namespace'] === $core['namespace'])
                    {
                        $isFind = true;
                        break;
                    }
                }
                if (!$isFind)
                {
                    $dataDev['class'][] = $core;
                }
            }
            $data = $dataDev['class'];
        }
        elseif (!isset($dataDev['class']) && isset($dataCore['class']))
        {
            $data = $dataCore['class'];
        }
        elseif (isset($dataDev['class']) && !isset($dataCore['class']))
        {
            $data = $dataDev['class'];
        }
    }

    private function readFiles()
    {
        return [
            $this->readYml(ModuleConstants::getFullPath('App', 'Config', 'di', 'register.yml')),
            $this->readYml(ModuleConstants::getFullPath('Core', 'Config', 'di', 'register.yml'))
        ];
    }
}
