<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Graphs;

/**
 * Description of EmptyGraph
 *
 * @author inbs
 */
class Line extends EmptyGraph
{
    protected $id = 'lineGraph';
    protected $name = 'lineGraph';

    protected function preInitContent()
    {
        //Do not use or override this method
        $this->setChartTypeToLine();
        $this->loadSettings();
    }

    public function afterInitContent()
    {
        $this->addGraphSettings();
    }

    public function prepareAjaxData()
    {
        $labels = ['day 1', 'day 2', 'day 3']; //labels on the bottom

        $this->setLabels($labels);

        //Data Set 1
        $dataSet1 = new Models\DataSet();
        $dataSet1->setTitle('Data Set 1')
            ->setData([1, 5, 9])
            ->setConfigurationDataSet([
                "backgroundColor" => "rgba(39, 133, 134, 0.91)",
                "borderColor"     => "rgba(39, 133, 134, 1)"
            ]);

        $this->addDataSet($dataSet1);

        //Data Set 2
        $dataSet2 = new Models\DataSet();
        $dataSet2->setTitle('Data Set 2')
            ->setData([8, 7, 4])
            ->setConfigurationDataSet([
                "backgroundColor" => "rgba(174, 198, 57, 0.79)",
                "borderColor"     => "rgba(174, 198, 57, 1)"
            ]);

        $this->addDataSet($dataSet2);

        //Data Set 3
        $dataSet3 = new Models\DataSet();
        $dataSet3->setTitle('Data Set 3')
            ->setData([8, 12, 6])
            ->setConfigurationDataSet([
                "backgroundColor" => "pink",
                "borderColor"     => "red"
            ]);

        $this->addDataSet($dataSet3);
    }
}
