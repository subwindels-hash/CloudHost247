<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\SL;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;

/**
 * Description of InterfaceConfig
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class InterfaceConfig extends AbstractReaderYml
{

    protected function load()
    {
        [$dataDev, $dataCore] = $this->readFiles();
        $data = null;

        if (isset($dataDev) && isset($dataCore))
        {
            $this->buildData($dataDev, $dataCore, $data);
        }
        elseif (!isset($dataDev) && isset($dataCore) && isset($dataCore['interface']))
        {
            $data = $dataCore['interface'];
        }
        elseif (isset($dataDev) && !isset($dataCore) && isset($dataDev['interface']))
        {
            $data = $dataDev['interface'];
        }

        $this->data = $this->rebuildData($data);
    }

    private function rebuildData($data)
    {
        $returnData = [];

        foreach ($data as $item)
        {
            $returnData[$item['namespace']][$item['where']] = $item['class'];
        }

        return $returnData;
    }

    private function buildData($dataDev, $dataCore, &$data)
    {
        if (isset($dataDev['interface']) && isset($dataCore['interface']))
        {
            foreach ($dataCore['interface'] as $core)
            {
                $isFind = false;
                foreach ($dataDev['interface'] as $dev)
                {
                    if ($dev['namespace'] === $core['namespace'] && $dev['class'] === $core['class'] && $dev['where'] === $core['where'])
                    {
                        $isFind = true;
                        break;
                    }
                }
                if (!$isFind)
                {
                    $dataDev['interface'][] = $core;
                }
            }
            $data = $dataDev['interface'];
        }
        elseif (!isset($dataDev['interface']) && isset($dataCore['interface']))
        {
            $data = $dataCore['interface'];
        }
        elseif (isset($dataDev['interface']) && !isset($dataCore['interface']))
        {
            $data = $dataDev['interface'];
        }
    }

    private function readFiles()
    {
        return [
            $this->readYml(ModuleConstants::getFullPath('App', 'Config', 'di', 'interface.yml')),
            $this->readYml(ModuleConstants::getFullPath('Core', 'Config', 'di', 'interface.yml'))
        ];
    }
}
