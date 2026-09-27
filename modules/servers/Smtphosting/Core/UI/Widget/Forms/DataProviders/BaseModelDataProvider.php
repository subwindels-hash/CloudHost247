<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\DataProviders;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ResponseTemplates;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection;

/**
 * Description of BaseModelDataProvider
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class BaseModelDataProvider extends BaseDataProvider
{
    protected $model = null;

    public function __construct($model)
    {
        parent::__construct();

        $this->setModel($model);
        //throw exc
    }

    protected function setModel($model)
    {
        if ($this->isModelProper($model))
        {
            $this->model = DependencyInjection::create($model);
        }

        return $this;
    }

    protected function getModel()
    {
        return $this->model;
    }

    protected function isModelProper($model)
    {
        if (in_array(get_parent_class($model), [
            'ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ExtendedEloquentModel',
            'Illuminate\Database\Eloquent\Model'
        ]))
        {
            return true;
        }

        return false;
    }

    public function read()
    {
        if (!$this->actionElementId)
        {
            return false;
        }

        $dbData = $this->model->where('id', $this->actionElementId)->first();
        if ($dbData !== null)
        {
            $this->data = $dbData->toArray();
        }
    }

    public function create()
    {
        $this->model->fill($this->formData)->save();
    }

    public function update()
    {
        $dbData = $this->model->where('id', $this->formData['id'])->first();
        if ($dbData === null)
        {
            return (new ResponseTemplates\HtmlDataJsonResponse())->setMessageAndTranslate('ItemNotFound')->setStatusError()->setCallBackFunction($this->callBackFunction);;
        }

        $dbData->fill($this->formData)->save();
    }

    public function delete()
    {
        if (!isset($this->formData['id']))
        {
            //todo return
        }

        $this->model->where('id', $this->formData['id'])->delete();
    }
}
