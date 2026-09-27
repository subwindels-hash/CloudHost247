<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields;

/**
 * BaseField controler
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class Textarea extends BaseField
{
    protected $id = 'textarea';
    protected $name = 'textarea';

    protected $textAreaRows;
    protected $textAreaCols;

    public function isRows()
    {
        return isset($this->textAreaRows);
    }

    public function isCols()
    {
        return isset($this->textAreaCols);
    }

    public function setRows($rows)
    {
        $this->textAreaRows = (int)$rows;

        return $this;
    }

    public function setCols($cols)
    {
        $this->textAreaCols = (int)$cols;

        return $this;
    }

    public function getRows()
    {
        return $this->textAreaRows;
    }

    public function getCols()
    {
        return $this->textAreaCols;
    }
}
