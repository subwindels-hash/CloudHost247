<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Providers;


use ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions\ConfigOptions;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\ProductsListRequest;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Facades\Cache;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Product;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Lang;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ResponseTemplates\HtmlDataJsonResponse;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\DataProviders\BaseDataProvider;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\ActionsFileGenerator;

class Config extends BaseDataProvider implements AdminArea
{
    use Lang;

    protected $productId = null;
    private $productSettings = [];


    private $productsInfoList = [];
    private $apiCalled = false;

    public function read()
    {
        $this->loadProductConfig();
        $this->loadConfig();
        $this->generateActionsFile();
    }

    public function update()
    {
        $this->read();
        $formData = $this->getRequestValue('mgpci');

        $settingRepo = new Repository();
        $settingRepo->clearProductSettings($this->productId);
        $settingRepo->reloadModel();
        foreach ($formData as $name => $value)
        {
            if (isset($this->availableValues[$name]))
            {
                if (is_array($value))
                {
                    $corectValues = [];
                    foreach ($value as $option)
                    {
                        if (isset($this->availableValues[$name][$option]))
                        {
                            $corectValues[] = $option;
                        }
                    }
                    $value = json_encode($corectValues);
                }
                else
                {
                    if (!isset($this->availableValues[$name][$value]))
                    {
                        continue;
                    }
                }
            }

            if ($name === 'resellerProduct')
            {
                $data = explode('_', $value, 2);
                $settingRepo->reloadModel();

                $settingRepo->updateProductSetting($this->productId, 'resellerProductId', $data[0]);
                $settingRepo->reloadModel();

                $settingRepo->updateProductSetting($this->productId, 'resellerProductType', $data[1]);
            }
            $settingRepo->reloadModel();

            $settingRepo->updateProductSetting($this->productId, $name, $value);
        }
    }

    private function loadConfig()
    {
        if (!$this->apiCalled)
        {
            try
            {
                $this->loadResellerProductsList();
            }
            catch (\Exception $e)
            {
                $this->apiCalled = true;
                throw $e;
            }
        }
        $this->loadLang();
        $this->data['resellerProduct']            = $this->productSettings['resellerProduct'] ?: '';
        $this->availableValues['resellerProduct'] = $this->getResellerProducts();


        $this->data['billingCycle']            = $this->productSettings['billingCycle'] ?: '';
        $this->availableValues['billingCycle'] = $this->getBillingCycles($this->productSettings['resellerProductId']);
        foreach ($this->getActionsForResellerProduct() as $action)
        {
            $this->data['action_' . $action] = $this->productSettings['action_' . $action] ?: '';
        }
    }

    private function loadResellerProductsList(): void
    {
        if (!empty($this->productsInfoList))
        {
            return;
        }
        $pid     = $this->request->get('id');
        $product = Product::findOrFail($pid);


        $this->productsInfoList = Cache::get(ConfigOptions::PRODUCT_LIST_CACHE_KEY);
        if (!$this->productsInfoList)
        {
            $call                   = new  ProductsListRequest(Configuration::create($product->toArray()), []);
            $this->productsInfoList = $call->process();
            Cache::remember(ConfigOptions::PRODUCT_LIST_CACHE_KEY, $this->productsInfoList);
        }
    }


    private function getResellerProducts(): array
    {
        $resellerProducts = [];
        $actions          = [];

        foreach ($this->productsInfoList['data'] as $entity)
        {
            if ($entity['integration'])
            {
                $resellerProducts[$entity['id'] . "_" . $entity['integration']] = $entity['name'];
            }
            else
            {
                $resellerProducts[$entity['id'] . "_" . trim($entity['name'])] = $entity['name'];
            }

//            foreach ($entity['actions'] as $action)
//            {
//                $actions[$action][] = $entity['name'];
//            }
        }
        return $resellerProducts;
    }

    private function getBillingCycles(?int $id): array
    {
        $cycles = [];
        foreach ($this->productsInfoList['data'] as $entity)
        {
            if ($entity['id'] === $id)
            {
                $cycles = $entity['billingCycles'];
            }
        }
        $result = ['auto' => $this->lang->T('auto')];

        foreach ($cycles as $cycle)
        {
            $result[$cycle] = $this->lang->T($cycle);
        }
        return $result;
    }


    protected function loadProductConfig(): void
    {
        $this->productId = $this->getRequestValue('id');

        $settingRepo           = new Repository();
        $this->productSettings = $settingRepo->getProductSettings($this->productId);
    }

    public function getActionsForResellerProduct(string $resellerProduct = ''): array
    {
        if (empty($resellerProduct))
        {
            $resellerProduct = $this->getProductSettings()['resellerProduct'];
        }
        $this->loadResellerProductsList();
        foreach ($this->productsInfoList['data'] as $productInfo)
        {
            if ($productInfo['id'] == explode('_', $resellerProduct)[0])
            {
                return $productInfo['actions'];
            }
        }
        return [];
    }

    public function getCustomFieldsForResellerProduct(string $resellerProduct = ''): array
    {
        $this->loadProductConfig();
        $this->loadConfig();

        if (empty($resellerProduct))
        {
            $resellerProduct = $this->getData()['resellerProduct'];
        }
        $this->loadResellerProductsList();
        foreach ($this->productsInfoList['data'] as $productInfo)
        {
            if ($productInfo['id'] == explode('_', $resellerProduct)[0])
            {
                return $productInfo['customFields'];
            }
        }
        return [];
    }

    /**
     * @return array
     */
    public function getProductSettings(): array
    {
        return $this->productSettings;
    }

    protected function generateActionsFile(): void
    {
        $this->loadResellerProductsList();
        $actions = [];
        foreach ($this->productsInfoList['data'] as $productInfo)
        {
            $actions = array_merge($actions, $productInfo['actions']);
        }

        $afg = new ActionsFileGenerator();
        foreach (array_unique($actions) as $value)
        {
            $afg->addAction($value);
        }
        $afg->save();
    }
}
