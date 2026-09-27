<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\Filters;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\Filters;

/**
 * Description of Rage
 *
 * @author inbs
 */
class Rage extends Filters
{

    protected function loadFilter()
    {
        $records = $this->records;
        $from    = (isset($this->data['from']) && is_numeric($this->data['from'])) ? (integer)($this->data['from']) : null;
        $to      = (isset($this->data['to']) && is_numeric($this->data['to'])) ? (integer)($this->data['to']) : null;
        foreach ($records as $key => $item)
        {
            if (isset($data[$this->name]))
            {
                $value = (is_numeric($item[$this->name])) ? (integer)($item[$this->name]) : null;
                if (isset($value) && (isset($from) && ($value < $from) || isset($to) && ($value > $to)))
                {
                    unset($this->records[$key]);
                }
            }
        }
    }
}
