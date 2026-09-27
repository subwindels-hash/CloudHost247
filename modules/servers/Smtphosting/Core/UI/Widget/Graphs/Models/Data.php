<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Graphs\Models;

/**
 * Description of ChartData
 *
 * @author inbs
 */
class Data
{
    protected $labels = [];
    /**
     * @var DataSet[]
     */
    protected $datasets = [];

    public function __construct(array $labels = [], array $datasets = [])
    {
        $this->labels   = $labels;
        $this->datasets = $datasets;
    }

    public function addLabel($label = '')
    {
        $this->labels[] = $label;

        return $this;
    }

    public function setLabels(array $labels = [])
    {
        $this->labels = $labels;

        return $this;
    }

    public function addDataSet(DataSet $dataset)
    {
        $this->datasets[] = $dataset;

        return $this;
    }

    public function setDataSets(array $dataSets = [])
    {
        $this->datasets = $dataSets;

        return $this;
    }


    public function toArray()
    {
        $return = [
            'labels'   => $this->labels,
            'datasets' => []
        ];

        foreach ($this->datasets as $dataset)
        {
            $return['datasets'][] = $dataset->toArray();
        }

        return $return;
    }
}
