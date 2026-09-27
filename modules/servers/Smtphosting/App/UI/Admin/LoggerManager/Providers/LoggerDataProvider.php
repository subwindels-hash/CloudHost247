<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\LoggerManager\Providers;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\DataProviders\BaseModelDataProvider;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ResponseTemplates;

/**
 * CategoryDataProvider
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class LoggerDataProvider extends BaseModelDataProvider implements AdminArea
{

    public function __construct()
    {
        parent::__construct('\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Logger\Model');
    }

    public function delete()
    {

        if ($this->formData['id'])
        {
            parent::delete();

            return (new ResponseTemplates\HtmlDataJsonResponse())->setMessageAndTranslate('loggerDeletedSuccesfully');
        }

        if ($this->requestObj->get('massActions', []))
        {
            foreach ($this->requestObj->get('massActions', []) as $tldId)
            {
                $this->model->where('id', $tldId)->delete();
            }

            return (new ResponseTemplates\HtmlDataJsonResponse())->setMessageAndTranslate('loggersDeletedSuccesfully');
        }
    }

    public function deleteall()
    {
        $this->model->truncate();

        return (new ResponseTemplates\HtmlDataJsonResponse())->setMessageAndTranslate('loggersDeletedSuccesfully');
    }
}
