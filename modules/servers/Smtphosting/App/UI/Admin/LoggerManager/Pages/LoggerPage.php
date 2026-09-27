<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\LoggerManager\Pages;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\DataTable;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\Column;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\DataProviders\DataProvider;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\DataProviders\Providers\ArrayDataProvider;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Others;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Logger\Entity;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\LoggerManager\Buttons\DeleteLoggerModalButton;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\LoggerManager\Buttons\MassDeleteLoggerButton;

/**
 * Description of Filters
 *
 * @author inbs
 */
class LoggerPage extends DataTable implements AdminArea
{
    protected $id = 'loggercont';
    protected $name = 'loggercont';
    protected $title = null;

    protected $colorArray = [
        Entity::TYPE_DEBUG    => [
            'color'           => '7b007b',
            'backgroundColor' => 'e9ebf0'
        ],
        Entity::TYPE_ERROR    => [
            'color'           => 'fcffff',
            'backgroundColor' => 'ed4040'
        ],
        Entity::TYPE_INFO     => [
            'color'           => 'e9fff7',
            'backgroundColor' => '737980'
        ],
        Entity::TYPE_SUCCESS  => [
            'color'           => 'e5fff4',
            'backgroundColor' => '5bc758'
        ],
        Entity::TYPE_CRITICAL => [
            'color'           => 'fcffff',
            'backgroundColor' => 'ed4040'
        ]
    ];

    protected function loadHtml()
    {
        $this
            ->addColumn((new Column('id'))
                ->setOrderable(DataProvider::SORT_DESC)
                ->setSearchable(true, Column::TYPE_INT))
            ->addColumn((new Column('message'))
                ->setOrderable()
                ->setSearchable(true))
            ->addColumn((new Column('type'))
                ->setOrderable()
                ->setSearchable(true))
            ->addColumn((new Column('date'))
                ->setSearchable(true, Column::TYPE_DATE)
                ->setOrderable());
    }

    public function replaceFieldMessage($key, $row)
    {
        return html_entity_decode($row[$key]);
    }

    public function replaceFieldType($key, $row)
    {
        return (new Others\Label())->initIds('label')
            ->setMessage($row['typeLabel'])
            ->setTitle($row['typeLabel'])
            ->setColor($this->colorArray[$row[$key]]['color'])
            ->setBackgroundColor($this->colorArray[$row[$key]]['backgroundColor'])
            ->getHtml();
    }

    public function initContent()
    {
        $this->addActionButton((new DeleteLoggerModalButton()));
        $this->addMassActionButton((new MassDeleteLoggerButton()));
    }

    protected function loadData()
    {
        $collection = Helper\sl('entityLogger')->all();
        $data       = [];
        foreach ($collection as $model)
        {
            $data[] = $model->toArray();
        }

        $dataProv = new ArrayDataProvider();
        $dataProv->setDefaultSorting('id', 'desc')->setData($data);

        $this->setDataProvider($dataProv);
    }
}
