<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\Filters;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\Filters;

/**
 * Description of Date
 *
 * @author inbs
 */
class Date extends Filters
{

    protected function loadFilter()
    {
        $records = $this->records;
        $date    = strtotime($this->data);
        foreach ($records as $key => $item)
        {
            if (isset($data[$this->name]))
            {
                $value = strtotime($item[$this->name]);
                if ($value != $date)
                {
                    unset($this->records[$key]);
                }
            }
        }
    }
}
