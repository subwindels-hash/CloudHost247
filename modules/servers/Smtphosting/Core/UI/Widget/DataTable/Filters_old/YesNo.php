<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\Filters;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\Filters;

/**
 * Description of YesNo
 *
 * @author inbs
 */
class YesNo extends Filters
{

    protected function loadFilter()
    {
        $records = $this->records;
        foreach ($records as $key => $data)
        {
            if (isset($data[$this->name]))
            {
                if ((string)$data[$this->name] != (string)$this->data)
                {
                    unset($this->records[$key]);
                }
            }
        }
    }
}
