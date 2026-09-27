<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\Addon;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\ResponseResolver;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Installer\ModuleInstaller;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\WhmcsVersionComparator;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Http\JsonResponse;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Product;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Server;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\AppParams;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\OutputBuffer;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\RequestObjectHandler;

/**
 * ConfigOptions module actions
 */
class ConfigOptions extends \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\AddonController
{
    use AppParams;
    use RequestObjectHandler;
    use OutputBuffer;

    public function execute($params = null)
    {
        $productId = $this->getRequestValue('id');
        if (($this->getRequestValue('action') === 'module-settings' || ($this->getRequestValue('loadData') && $this->getRequestValue('ajax') == '1')))
        {
            try
            {
                //check storage
                $invalidStoragePermissions = $this->getInvalidStoragePermitions();
                if ($invalidStoragePermissions)
                {
                    return $this->getInvalidStoragePermissionsError($invalidStoragePermissions);
                }

                //check server type
                if (!$this->isCorrectServerType())
                {
                    return $this->getInvalidServerTypeError();
                }

                $requirementsHandler = new \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Requirements\Checker();

                if ($requirementsHandler->getUnfulfilledRequirements())
                {
                    $data = $this->buildErrorMessage(implode('<br>', $requirementsHandler->getUnfulfilledRequirements()));

                    return $this->returnAjaxResponse($data);
                }

                $this->updateProductType();
                $this->addRequiredCustomFields();
                //run installer
                $installer = new ModuleInstaller();

                $installer->makeInstall();

                if (!$installer->isInstallCorrect())
                {
                    return $this->buildFailedQueriesMessage($installer->getFailedQueries());
                }
            }
            catch (\Excpetion $exc)
            {
                $data = $this->buildErrorMessage($exc->getMessage());

                return $this->returnAjaxResponse($data);
            }

            try
            {
                $this->setAppParam('IntegrationControlerName', \ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions\ConfigOptions::class);
                $this->setAppParam('IntegrationControlerMethod', 'runExecuteProcess');

                $configOptionsController = new \ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions\ConfigOptions();

                $result = $configOptionsController->execute();

                return $result;
            }
            catch (\Exception $exc)
            {
                $data     = $this->buildErrorMessage($exc->getMessage());
                $response = new JsonResponse();
                $response->setData($data);

                $resolver = new ResponseResolver($response);

                $resolver->resolve();
            }

        }
        else
        {
            if ($this->getRequestValue('action') === 'save')
            {

                if (!$this->isCorrectServerType())
                {
                    return [];
                }

                return [\ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions\ConfigOptions::class, 'runExecuteProcess'];
            }
        }

        return [];
    }

    public function getInvalidStoragePermitions()
    {
        $requiredPaths = [
            ModuleConstants::getFullPath('storage'),
            ModuleConstants::getFullPath('storage', 'app'),
            ModuleConstants::getFullPath('storage', 'crons'),
            ModuleConstants::getFullPath('storage', 'logs')
        ];

        $invalidPermissions = [];
        $lang               = ServiceLocator::call('lang');
        foreach ($requiredPaths as $path)
        {
            if (!is_writable($path))
            {
                $invalidPermissions[] = $lang->addReplacementConstant('storage_path', $path)->absoluteT('permissionsStorage');
            }
            if (!is_readable($path))
            {
                $invalidPermissions[] = $lang->addReplacementConstant('storage_path', $path)->absoluteT('permissionsStorageReadable');
            }
        }

        return $invalidPermissions;
    }

    public function buildFailedQueriesMessage($failedQueries = [])
    {
        $content = '';
        foreach ($failedQueries as $query)
        {
            $content .= '<div class="panel panel-danger"><div class="panel-heading">Installation Error</div><div class="panel-body" style="padding:0px;"><ul class="list-group" style="margin-bottom: -5px;margin-top: -5px;">';
            //$content .= '<li class="list-group-item ">Status: ' . $query['status'] . '</li>';
            $content .= '<li class="list-group-item ">File: ' . $query['file'] . '</li>';
            $content .= '<li class="list-group-item ">Error Message: ' . $query['errorMessage'] . '</li>';
            $content .= '<li class="list-group-item ">Raw Query: ' . $query['rawQuery'] . '</li>';
            $content .= '</ul></div></div>';
        }

        $data = [
            'content' =>
                '<tr><td class="fieldlabel" style="width:0%; display:none;"></td><td style="width=100%;" class="fieldarea">' . $content . '</td></tr>',
            'mode'    => 'advanced'
        ];

        return $this->returnAjaxResponse($data);
    }

    public function getInvalidStoragePermissionsError($permissions = [])
    {
        $data = $this->buildErrorMessage(implode('<br>', $permissions));

        return $this->returnAjaxResponse($data);
    }

    public function isCorrectServerType()
    {
        try
        {
            if (class_exists('\ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions\MetaData'))
            {
                $metaDataController = new \ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions\MetaData();
                $details            = $metaDataController->execute(null);
                if ($details['RequiresServer'] !== true)
                {
                    return true;
                }

                $serverGroupId = $this->getServerGroupId();

                $sModel = new Server();
                $server = $sModel
                    ->select(['tblservers.type'])
                    ->join('tblservergroupsrel', 'tblservergroupsrel.serverid', '=', 'tblservers.id')
                    ->where('tblservergroupsrel.groupid', $serverGroupId)->first();

                if (!$server)
                {
                    return false;
                }

                if ($server->type !== $this->getModuleName())
                {
                    return false;
                }
            }
        }
        catch (\Exception $exception)
        {
            //todo log me
            return false;
        }

        return true;
    }

    public function getServerGroupId()
    {
        $gid = $this->getRequestValue('servergroup', false);
        if (!$gid && $gid !== '0' && $gid !== 0)
        {
            $pid          = $this->getRequestValue('id', 0);
            $productModel = new Product();
            $product      = $productModel->where('id', $pid)->first();
            if (!$product)
            {
                //can add first product here if needed
                return 0;
            }

            return $product->servergroup;
        }

        return (int)$gid;
    }

    public function getInvalidServerTypeError()
    {
        $lang = ServiceLocator::call('lang');

        $messaage = $lang->addReplacementConstant('provisioning_name', $this->getModuleDisplayName())->absoluteT('invalidServerType');
        $data     = $this->buildErrorMessage($messaage);

        return $this->returnAjaxResponse($data);
    }

    public function buildErrorMessage($message)
    {
        $data = [];

        $alertDiv = '<div style="width=100%; margin: 2px;" class="alert alert-danger">' . $message . '</div>';
        if (WhmcsVersionComparator::isWhmcsVersionHigherOrEqual('8.3.0'))
        {
            $data['content'] = '
                <div style="border: 3px solid #e2e7e9; margin: 12px 0 12px 0; border-collapse: separate; border-radius: 4px;">
                    <div style="padding: 1px 3px 1px 3px; margin: 2px; background-color: #efefef;">
                    ' . $alertDiv . '
                    </div>
                </div>';
        }
        else
        {
            $data['content'] =
                '<tr><td class="fieldlabel" style="width:0%; display:none;"></td><td style="width=100%;" class="fieldarea"><div style="width=100%; margin-bottom: 0px;" class="alert alert-danger">' . $message . '</div></td></tr>';
        }
        $data['mode'] = 'advanced';

        return $data;
    }

    public function returnAjaxResponse($data = [])
    {
        $response = new JsonResponse();
        $response->setData($data);

        return $response;
    }

    public function updateProductType()
    {
        if ($this->getRequestValue('action') !== 'module-settings'
            || $this->getAppParam('moduleAppType') !== 'server')
        {
            return false;
        }

        $moduleName  = $this->getAppParam('systemName');
        $pid         = $this->getRequestValue('id', false);
        $servergroup = $this->getRequestValue('servergroup', 0);

        if ($pid && $servergroup > 0)
        {
            $product = new Product();
            $product->where('id', $pid)->update(['servertype' => $moduleName, 'servergroup' => $servergroup]);
        }
    }

    public function getModuleName()
    {
        return $this->getAppParam('systemName');
    }

    public function getModuleDisplayName()
    {
        return $this->getAppParam('name');
    }

    public function addRequiredCustomFields()
    {
        $pid = $this->getRequestValue('id', false);
        if ($pid === false)
        {
            return;
        }

        $product = new \ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Product($pid);

        $product->createCustomFieldsFromConfig();
    }
}
