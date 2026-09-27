<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Facades\Cache;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use WHMCS\Product\Product;


class ClientAreaCustomButtonArray implements AbstractAction
{
    protected $params;

    public function __construct($params)
    {
        $this->params = $params;
    }

    /**
     * @return array
     * @throws \Exception
     */
    public function process(): array
    {
        $product = Product::findOrFail($this->params['pid']);

        $response = Cache::get(ConfigOptions::PRODUCT_LIST_CACHE_KEY);
        if (!$response)
        {
            $call     = new  Calls\ProductsListRequest(Configuration::create($product->toArray()), []);
            $response = $call->process();
            Cache::remember(ConfigOptions::PRODUCT_LIST_CACHE_KEY, $response);
        }

        $actions         = [];
        $productSettings = (new Repository())->getProductSettings($this->params['pid']);
        $resellerPid     = $productSettings['resellerProductId'];
        foreach ($response['data'] as $entity)
        {
            if ($entity['id'] == $resellerPid)
            {
                $actions = $entity['actions'];
            }
        }
        //Load and require available actions
        $this->params['availableActions'] = $actions;
        $buttons                          = [];
        foreach ($actions as $action)
        {
            $buttons[$action] = lcfirst($action);
        }
        foreach ($actions as $action)
        {
            if ($productSettings["action_" . $action] !== 'on' || strpos($action, 'getInfo') !== false || strpos($action, 'details') !== false)
            {
                unset($buttons[$action]);
            }
        }

        return $buttons;
    }
}
