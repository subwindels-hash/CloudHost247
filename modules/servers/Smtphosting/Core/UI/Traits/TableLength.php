<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;
// to do disable title

/**
 * Title elements related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait TableLength
{
    protected $tableLength = 10;
    protected $tableLengthList = [10, 25];
    protected $isTableLengthInfinity = true;

    public function enabledTalbeLengthInfinity()
    {
        $this->isTableLengthInfinity = true;

        return $this;
    }

    public function disabledTalbeLengthInfinity()
    {
        $this->isTableLengthInfinity = false;

        return $this;
    }

    public function setTableLengthList(array $tableLengthList = [])
    {
        $this->tableLengthList = $tableLengthList;

        return $this;
    }

    public function getTableLengthList()
    {
        $returnList = $this->tableLengthList;
        if ($this->isTableLengthInfinity)
        {
            $returnList[] = "inf";
        }

        return $returnList;
    }

    public function setTableLength($tableLength = 10)
    {
        if (in_array($tableLength, $this->tableLengthList, true))
        {
            $this->tableLength = $tableLength;
        }

        return $this;
    }

    public function getTableLength()
    {
        return $this->tableLength;
    }
}
