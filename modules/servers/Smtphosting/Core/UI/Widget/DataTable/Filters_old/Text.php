<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\Filters;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\Filters;

/**
 * Description of Text
 *
 * @author inbs
 */
class Text extends Filters
{

    protected function loadFilter()
    {
        $records = $this->records;
        foreach ($records as $key => $data)
        {
            if (isset($data[$this->name]) && preg_replace('/\s+/', '', $this->data) != "")
            {
                if (strpos(strtolower($data[$this->name]), strtolower($this->data)) === false)
                {
                    unset($this->records[$key]);
                }
            }
        }
    }
}
