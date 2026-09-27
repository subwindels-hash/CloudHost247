<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Graphs;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder\BaseContainer;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AjaxElementInterface;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\Exception;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\ErrorCodes\ErrorCodesLib;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ModuleSettings\Model;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ResponseTemplates;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Graphs\Models\Data;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Graphs\Models\DataSet;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\Hidden;
use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl;

/**
 * Description of EmptyGraph
 *
 * @author inbs
 */
class EmptyGraph extends BaseContainer implements AjaxElementInterface
{
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\TableRowCol;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\Icon;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\TitleButtons;

    const GRAPH_FILTER_TYPE_INT    = 'int';
    const GRAPH_FILTER_TYPE_STRING = 'string';
    const GRAPH_FILTER_TYPE_DATE   = 'date';

    const GRAPH_OPTIONS_MODE_POINT   = 'point';
    const GRAPH_OPTIONS_MODE_NEAREST = 'nearest';
    const GRAPH_OPTIONS_MODE_INDEX   = 'index';
    const GRAPH_OPTIONS_MODE_DATASET = 'dataset';
    const GRAPH_OPTIONS_MODE_X       = 'x';
    const GRAPH_OPTIONS_MODE_Y       = 'y';

    protected $id = 'emptyGraph';
    protected $name = 'emptyGraph';
    protected $title = 'title';
    protected $configCharts = [
        'type'      => '',
        'data'      => [],
        'dataParse' => [],
        'options'   => [],
        'filter'    => []
    ];

    protected $tooltips = [
        'mode' => self::GRAPH_OPTIONS_MODE_INDEX
    ];

    protected $responsive = true;
    protected $responsiveAnimationDuration = null;
    protected $maintainAspectRatio = null;
    protected $onResize = null;

    protected $filterInfo = [
        'displayEditColor' => true,
        'type'             => self::GRAPH_FILTER_TYPE_INT,
        'default'          => [
            'start' => 0,
            'end'   => 100
        ]
    ];

    protected $animation = [];
    protected $layout = [];
    protected $scales = [
        'xAxes' => [
            [
                'ticks' => [
                    'beginAtZero' => true
                ]
            ]
        ]
    ];
    protected $legend = [
        'display'  => true,
        'position' => 'top'
    ];
    protected $titleGraph = [
        'display'  => false,
        'text'     => '',
        'position' => 'top'
    ];
    protected $graphWidth = 1200;
    protected $graphHeight = 400;

    protected $vueComponent = true;
    protected $defaultVueComponentName = 'mg-graph';
    protected $graphData = null;
    protected $graphSettingsKey = null;
    protected $graphSettingsEnabled = false;
    protected $configurationFields = [];

    public function returnAjaxData()
    {
        if ($this->getRequestValue('loadData', false) === 'settingButton')
        {
            $settingButton = $this->titleButtons['settingButton'];

            return $settingButton->returnAjaxData();
        }

        $this->loadData();

        $this->setTitleText(sl('lang')->T($this->name));
        $this->reloadConfigCharts();
        $this->addColorForLabels();
        $this->useFilter();

        return (new ResponseTemplates\RawDataJsonResponse($this->configCharts))->setCallBackFunction($this->callBackFunction)->setRefreshTargetIds($this->refreshActionIds);
    }

    protected function disableEditColor()
    {
        $this->filterInfo['displayEditColor'] = false;

        return $this;
    }

    protected function enableEditColor()
    {
        $this->filterInfo['displayEditColor'] = true;

        return $this;
    }

    protected function setGraphFilterInfo($type = self::GRAPH_FILTER_TYPE_INT, $defaultStart = 0, $defaultStop = 100)
    {
        if ($type !== null && in_array($type, [self::GRAPH_FILTER_TYPE_INT, self::GRAPH_FILTER_TYPE_DATE, self::GRAPH_FILTER_TYPE_STRING], true))
        {
            $this->filterInfo['type'] = $type;
        }

        if ($defaultStart !== null)
        {
            $this->filterInfo['default']['start'] = $defaultStart;
        }

        if ($defaultStop !== null)
        {
            $this->filterInfo['default']['end'] = $defaultStop;
        }

        return $this;
    }

    protected function getActionId()
    {
        return $this->getRequestValue('index', false);
    }

    protected function reloadConfigCharts()
    {
        if (is_array($this->animation) && count($this->animation) > 0)
        {
            $this->configCharts['options']['animation'] = $this->animation;
        }
        elseif (is_string($this->animation) && strlen($this->animation) > 0)
        {
            $this->configCharts['options']['animation'] = json_decode($this->animation, true);
        }

        if (is_array($this->layout) && count($this->layout) > 0)
        {
            $this->configCharts['options']['layout'] = $this->layout;
        }

        if (is_array($this->legend) && count($this->legend) > 0)
        {
            $this->configCharts['options']['legend'] = $this->legend;
        }

        if (is_array($this->titleGraph) && count($this->titleGraph) > 0)
        {
            $this->configCharts['options']['title'] = $this->titleGraph;
        }

        if (is_array($this->scales) && count($this->scales) > 0)
        {
            $this->configCharts['options']['scales'] = $this->scales;
        }

        if (is_array($this->filterInfo) && count($this->filterInfo) > 0)
        {
            $this->configCharts['filter'] = $this->filterInfo;
        }

        if ($this->responsive !== null)
        {
            $this->configCharts['options']['responsive'] = $this->responsive;
        }

        if ($this->responsiveAnimationDuration !== null)
        {
            $this->configCharts['options']['responsiveAnimationDuration'] = $this->responsiveAnimationDuration;
        }

        if ($this->maintainAspectRatio !== null)
        {
            $this->configCharts['options']['maintainAspectRatio'] = $this->maintainAspectRatio;
        }

        if ($this->onResize !== null)
        {
            $this->configCharts['options']['onResize'] = $this->onResize;
        }


        return $this;
    }

    protected function setChartScales(array $scales = [])
    {
        $this->scales = $scales;

        return $this;
    }

    protected function addChartScale($key = null, array $scales = [])
    {
        if (trim($key) !== '' && is_string($key) && !isset($this->scales[$key]))
        {
            $this->scales[$key] = $scales;
        }

        return $this;
    }

    protected function updateChartScale($key = null, array $scales = [])
    {
        if (trim($key) !== '' && is_string($key))
        {
            $this->scales[$key] = $scales;
        }

        return $this;
    }

    protected function setTooltipsMode($tooltipMode = 'index')
    {
        if (!in_array($tooltipMode, [self::GRAPH_OPTIONS_MODE_DATASET, self::GRAPH_OPTIONS_MODE_INDEX, self::GRAPH_OPTIONS_MODE_NEAREST, self::GRAPH_OPTIONS_MODE_POINT, self::GRAPH_OPTIONS_MODE_X, self::GRAPH_OPTIONS_MODE_Y]))
        {
            throw new Exception(ErrorCodesLib::CORE_GRA_000001, ['mode' => $tooltipMode]);
        }

        $this->tooltips['mode'] = $tooltipMode;

        return $this;
    }

    protected function setTitleDisplay($display = true)
    {
        $this->titleGraph['display'] = (bool)$display;

        return $this;
    }

    protected function setTitlePosition($position = 'top')
    {
        $this->titleGraph['position'] = (string)$position;

        return $this;
    }

    protected function setTitleFontSize($fontSize = 12)
    {
        $this->titleGraph['fontSize'] = (int)$fontSize;

        return $this;
    }

    protected function setTitleFontFamily($fontFamily = "'Helvetica Neue', 'Helvetica', 'Arial', sans-serif")
    {
        $this->titleGraph['fontFamily'] = (string)$fontFamily;

        return $this;
    }

    protected function setTitleFontColor($fontColor = '#666')
    {
        $this->titleGraph['fontColor'] = (string)$fontColor;

        return $this;
    }

    protected function setTitleFontStyle($fontStyle = '')
    {
        $this->titleGraph['fontStyle'] = (string)$fontStyle;

        return $this;
    }

    protected function setTitlePadding($padding = '')
    {
        $this->titleGraph['padding'] = (string)$padding;

        return $this;
    }

    protected function setTitleLineHeight($lineHeight = 1.2)
    {
        $this->titleGraph['lineHeight'] = (float)$lineHeight;

        return $this;
    }

    protected function setTitleText($text = '')
    {
        $this->titleGraph['text'] = (string)$text;

        return $this;
    }

    protected function unsetLegend()
    {
        $this->legend = [];

        return $this;
    }

    protected function setLegendLabelsBoxWidth($boxWidth = 40)
    {
        $this->legend['labels']['boxWidth'] = (int)$boxWidth;

        return $this;
    }

    protected function setLegendLabelsFontSize($fontSize = 12)
    {
        $this->legend['labels']['fontSize'] = (int)$fontSize;

        return $this;
    }

    protected function setLegendLabelsFontStyle($fontStyle = 'normal')
    {
        $this->legend['labels']['fontStyle'] = (string)$fontStyle;

        return $this;
    }

    protected function setLegendLabelsFontColor($fontColor = '#666') // Demon Color   3:-]
    {
        $this->legend['labels']['fontColor'] = (string)$fontColor;

        return $this;
    }

    protected function setLegendLabelsFontFamily($fontFamily = "'Helvetica Neue', 'Helvetica', 'Arial', sans-serif") // Demon Color   3:-]
    {
        $this->legend['labels']['fontFamily'] = (string)$fontFamily;

        return $this;
    }

    protected function setLegendLabelsPadding($padding = 10)
    {
        $this->legend['labels']['padding'] = (int)$padding;

        return $this;
    }

    protected function setLegendLabelsGenerateLabels($generateLabels = "function () {}")
    {
        $this->legend['labels']['generateLabels'] = (string)$generateLabels;

        return $this;
    }

    protected function setLegendLabelsFilter($filter = "function () {}")
    {
        $this->legend['labels']['filter'] = (string)$filter;

        return $this;
    }

    protected function setLegendLabelsUsePointStyle($usePointStyle = false)
    {
        $this->legend['labels']['usePointStyle'] = (bool)$usePointStyle;

        return $this;
    }

    protected function setLegendReverse($isReverse = false)
    {
        $this->legend['reverse'] = (bool)$isReverse;

        return $this;
    }

    protected function setLegendOnHover($eventFunction = "function (event, legendItem) {}")
    {
        $this->legend['onHover'] = (string)$eventFunction;

        return $this;
    }

    protected function setLegendOnClick($eventFunction = "function (event, legendItem) {}")
    {
        $this->legend['onClick'] = (string)$eventFunction;

        return $this;
    }

    protected function setLegendFullWidth($isFullWidth = true)
    {
        $this->legend['fullWidth'] = (bool)$isFullWidth;

        return $this;
    }

    protected function setLegendDisplay($isDisplay = true)
    {
        $this->legend['display'] = (bool)$isDisplay;

        return $this;
    }

    protected function setLegendPosition($position = 'top')
    {
        $this->legend['position'] = (string)$position;

        return $this;
    }

    protected function unsetLayout()
    {
        $this->layout = [];

        return $this;
    }

    protected function setLayoutPadding($left = 0, $right = 0, $top = 0, $bottom = 0)
    {
        $this->layout['padding'] = [
            'left'   => $left,
            'right'  => $right,
            'top'    => $top,
            'bottom' => $bottom
        ];

        return $this;
    }

    protected function setAnimation($animation)
    {
        $this->animation = $animation;

        return $this;
    }

    protected function addAnimation($event, $animation)
    {
        if (is_array($this->animation))
        {
            $this->animation[$event] = $animation;
        }
        elseif (is_string($this->animation))
        {
            $animations         = json_decode($this->animation, true);
            $animations[$event] = $animation;
            $this->animation    = json_encode($animations);
        }

        return $this;
    }

    public function setGraphWidth($graphWidth = 0)
    {
        if (!is_numeric($graphWidth))
        {
            throw new Exception(ErrorCodesLib::CORE_GRA_000002, ['width' => $graphWidth], ['width' => $graphWidth]);
        }

        $this->graphWidth = $graphWidth;

        return $this;
    }

    public function setGraphHeight($graphHeight = 0)
    {
        if (!is_numeric($graphHeight))
        {
            throw new Exception(ErrorCodesLib::CORE_GRA_000003, ['height' => $graphHeight], ['height' => $graphHeight]);
        }

        $this->graphHeight = $graphHeight;

        return $this;
    }

    public function getGraphWidth()
    {
        return $this->graphWidth;
    }

    public function getGraphHeight()
    {
        return $this->graphHeight;
    }

    public function setChartOptions(array $chartOptions = [])
    {
        $this->configCharts['options'] = $chartOptions;

        return $this;
    }

    public function updateChartOption($key = null, $value = null)
    {
        if (is_string($key) && trim($key) !== '')
        {
            $this->configCharts['options'][$key] = $value;
        }

        return $this;
    }

    public function getChartOptions()
    {
        return $this->configChartsOptions;
    }

    public function setChartType($type = '')
    {
        $this->configCharts['type'] = $type;

        return $this;
    }

    public function getChartType()
    {
        return $this->configCharts['type'];
    }

    public function setChartTypeToLine()
    {
        return $this->setChartType('line');
    }

    public function setChartTypeToBar()
    {
        return $this->setChartType('bar');
    }

    public function setChartTypeToRader()
    {
        return $this->setChartType('radar');
    }

    public function setChartTypeToPolarArea()
    {
        return $this->setChartType('polarArea');
    }

    public function setChartTypeToPie()
    {
        return $this->setChartType('pie');
    }

    public function setChartTypeToDoughnut()
    {
        return $this->setChartType('doughnut');
    }

    public function setChartTypeToBubble()
    {
        return $this->setChartType('bubble');
    }

    public function setChartData($data = [])
    {
        if (is_object($data) && $data instanceof Data)
        {
            $this->configCharts['data'] = $data->toArray();
        }
        else
        {
            $this->configCharts['data'] = $data;
        }

        return $this;
    }

    public function getChartData()
    {
        return $this->configCharts['data'];
    }

    protected function loadSettings()
    {
        $this->configChartsSettings = json_decode(Model::where('setting', $this->graphSettingsKey)->first()->value);

        if ($this->configChartsSettings)
        {
            $this->setGraphFilterInfo(null, $this->configChartsSettings->start, $this->configChartsSettings->end);
        }

        return $this;
    }

    protected function useFilter()
    {
        if ($this->configCharts['data'] && $this->configCharts['data']['labels'] && $this->configCharts['filter']['default']['start'] && $this->configCharts['filter']['default']['end'])
        {
            $this->configCharts['dataParse'] = $this->configCharts['data'];
            $removeIndex                     = [];
            $isRemove                        = true;
            foreach ($this->configCharts['data']['labels'] as $index => $value)
            {
                if ($value == $this->configCharts['filter']['default']['start'])
                {
                    $isRemove = false;
                    continue;
                }

                if ($value == $this->configCharts['filter']['default']['end'])
                {
                    $isRemove = true;
                    continue;
                }

                if ($isRemove)
                {
                    $removeIndex[] = $index;
                }
            }

            foreach ($removeIndex as $index)
            {
                if (isset($this->configCharts['data']['labels'][$index]))
                {
                    unset($this->configCharts['data']['labels'][$index]);
                }
                if (isset($this->configCharts['data']['datasets']))
                {
                    foreach ($this->configCharts['data']['datasets'] as &$dataset)
                    {
                        foreach ($dataset as $key => $value)
                        {
                            if (is_array($value) && isset($dataset[$key][$index]))
                            {
                                unset($dataset[$key][$index]);
                            }
                        }
                    }
                }
            }
        }

        return $this;
    }

    protected function addColorForLabels()
    {
        $indexColor = [];

        if ($this->configCharts['data'] && $this->configCharts['data']['labels'] && $this->filterInfo['displayEditColor'])
        {
            foreach ($this->configCharts['data']['labels'] as $labelName)
            {
                if (isset($this->configChartsSettings->{$labelName}))
                {
                    $indexColor[] = "#" . $this->configChartsSettings->{$labelName};
                }
            }

            if (!$indexColor)
            {
                return $this;
            }

            foreach ($this->configCharts['data']['datasets'] as &$dataset)
            {
                $dataset['backgroundColor']           = $indexColor;
                $dataset['borderColor']               = $indexColor;
                $dataset['hoverBackgroundColor']      = $indexColor;
                $dataset['hoverBorderColor']          = $indexColor;
                $dataset['pointBackgroundColor']      = $indexColor;
                $dataset['pointBorderColor']          = $indexColor;
                $dataset['pointHoverBackgroundColor'] = $indexColor;
                $dataset['pointHoverBorderColor']     = $indexColor;
            }
        }

        return $this;
    }

    /**
     *
     * @return Data
     */
    public function generateDataObject()
    {
        return (new Data());
    }

    /**
     * @return DataSet
     */
    public function generateDataSetObject()
    {
        return (new DataSet());
    }

    public function prepareAjaxData()
    {
        //to be overwritten
        //load the data for graph drawing in this function
    }

    public function setLabels($labels = [])
    {
        $this->initData();
        if ($labels)
        {
            $this->graphData->setLabels($labels);
        }

        return $this;
    }

    public function initData()
    {
        if (!$this->graphData)
        {
            $this->graphData = new Data();
        }

        return $this;
    }

    public function addDataSet($dataSet)
    {
        $this->graphData->addDataSet($dataSet);

        return $this;
    }

    protected function loadData()
    {
        $this->addGraphSettings();
        $this->prepareAjaxData();

        $this->setChartData($this->graphData);
    }

    protected function addGraphSettings()
    {
        if (!$this->getRequestValue('mgformtype', false) && $this->getRequestValue('ajax', false))
        {
            return $this;
        }

        if (!$this->graphSettingsEnabled)
        {
            return $this;
        }

        if (!$this->graphSettingsKey)
        {
            $this->graphSettingsKey = 'graph_' . $this->id;
        }

        if ($this->configurationFields)
        {
            $field = new Hidden('setting');
            $field->setDefaultValue($this->graphSettingsKey);
            $this->addSettingField($field);
        }

        $btn = (new Settings\SettingButton())
            ->setIndex($this->graphSettingsKey)
            ->addNamespaceScope($this->namespace)
            ->setConfigFields($this->configurationFields);
        $this->addTitleButton($btn);
    }

    public function enableGraphSettings($settingsKey = null)
    {
        $this->graphSettingsEnabled = true;
        if ((string)$settingsKey !== '')
        {
            $this->graphSettingsKey = (string)$settingsKey;
        }

        $this->addGraphSettings();

        return $this;
    }

    public function addSettingField($field)
    {
        if (is_object($field))
        {
            $this->configurationFields[$field->getId()] = $field;
        }

        return $this;
    }

    public function getGraphSettingsKey()
    {
        return $this->graphSettingsKey;
    }
}
