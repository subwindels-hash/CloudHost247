<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

/**
 * Icons related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait TableRowCol
{
    protected $tableRowCol = 'lu-col-md-12';

    public function setTableRowCol($tableRowCol = null)
    {
        if ($tableRowCol)
        {
            $this->tableRowCol = $tableRowCol;
        }

        return $this;
    }

    public function disableTableRowCol()
    {
        $this->tableRowCol = null;

        return $this;
    }

    public function getTableRowCol()
    {
        return $this->tableRowCol;
    }
}
