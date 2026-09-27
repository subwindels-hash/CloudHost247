<?php
namespace CloudHost247\Ovh\Services;

use CloudHost247\Ovh\Api\ApiException;
use WHMCS\Database\Capsule;
use RuntimeException;

final class Provisioner
{
    private $resolver;
    public function __construct(ConnectionResolver $resolver) { $this->resolver = $resolver; }

    public function provision($serviceId, $productId, array $options = array())
    {
        $mapping = (new MappingRepository())->forProduct($productId);
        if (!$mapping) throw new RuntimeException('No active OVH mapping for this product.');
        $key = hash('sha256', 'provision:' . (int) $serviceId . ':' . $mapping->id);
        $operation = Capsule::table('mod_cloudhost247_ovh_operations')->where('idempotency_key', $key)->first();
        if ($operation && in_array($operation->status, array('running', 'remote_mutation', 'reconciliation_required', 'success', 'completed'), true)) {
            return array('status' => $operation->status, 'remote_id' => $operation->remote_id, 'idempotent' => true);
        }
        if ($operation) {
            Capsule::table('mod_cloudhost247_ovh_operations')->where('id', $operation->id)->update(array('status'=>'running','attempts'=>$operation->attempts+1,'error_message'=>null,'updated_at'=>date('Y-m-d H:i:s')));
        } else {
            Capsule::table('mod_cloudhost247_ovh_operations')->insert(array('whmcs_service_id'=>$serviceId,'operation'=>'provision','idempotency_key'=>$key,'status'=>'running','request_json'=>json_encode(array('mapping_id'=>$mapping->id)),'attempts'=>1,'created_at'=>date('Y-m-d H:i:s'),'updated_at'=>date('Y-m-d H:i:s')));
        }
        Capsule::table('mod_cloudhost247_ovh_services')->updateOrInsert(array('whmcs_service_id'=>$serviceId), array('endpoint_id'=>$mapping->endpoint_id,'family'=>$mapping->family,'status'=>'ordering','updated_at'=>date('Y-m-d H:i:s')));
        $client = $this->resolver->endpoint($mapping->endpoint_id);
        try {
            $config = json_decode($mapping->configuration_json, true) ?: array();
            $service = Capsule::table('mod_cloudhost247_ovh_services')->where('whmcs_service_id', $serviceId)->first();
            $details = json_decode($service->details_json ?: '{}', true) ?: array();
            if (empty($details['cart_id'])) {
                $this->beforeMutation($key, 'create_cart');
                $cart = $client->post('/order/cart', array('ovhSubsidiary'=>$mapping->subsidiary));
                if (empty($cart['cartId'])) throw new RuntimeException('OVH did not return a cart ID.');
                $details['cart_id'] = $cart['cartId'];
                $this->checkpoint($service->id, $key, $details);
                $client->post('/order/cart/' . rawurlencode($details['cart_id']) . '/assign', array());
            }
            $route = isset($config['order_route']) ? $config['order_route'] : ($mapping->family === 'vps' ? 'vps' : 'eco');
            if (!in_array($route, array('eco','vps','baremetalServers'), true)) throw new RuntimeException('Unsupported OVH order route.');
            if (empty($details['item_id'])) {
                $this->beforeMutation($key, 'create_item');
                $item = $client->post('/order/cart/' . rawurlencode($details['cart_id']) . '/' . $route, array('duration'=>$config['duration']??'P1M','planCode'=>$mapping->plan_code,'pricingMode'=>$config['pricing_mode']??'default','quantity'=>1));
                if (empty($item['itemId'])) throw new RuntimeException('OVH did not return a cart item ID.');
                $details['item_id'] = $item['itemId'];
                $this->checkpoint($service->id, $key, $details);
                foreach (($config['configurations'] ?? array()) as $configuration) {
                    if (!isset($configuration['label'], $configuration['value'])) continue;
                    $client->post('/order/cart/' . rawurlencode($details['cart_id']) . '/item/' . rawurlencode($details['item_id']) . '/configuration', array('label'=>$configuration['label'],'value'=>$configuration['value']));
                }
            }
            $this->beforeMutation($key, 'checkout');
            $checkout = $client->post('/order/cart/' . rawurlencode($details['cart_id']) . '/checkout', array('autoPayWithPreferredPaymentMethod'=>false), false);
            $orderId = (string) ($checkout['orderId'] ?? '');
            if ($orderId === '') throw new RuntimeException('OVH checkout did not return an order ID.');
            Capsule::table('mod_cloudhost247_ovh_services')->where('id',$service->id)->update(array('remote_order_id'=>$orderId,'status'=>'pending','details_json'=>json_encode($details),'updated_at'=>date('Y-m-d H:i:s')));
            Capsule::table('mod_cloudhost247_ovh_operations')->where('idempotency_key',$key)->update(array('status'=>'success','remote_id'=>$orderId,'response_json'=>json_encode($checkout),'updated_at'=>date('Y-m-d H:i:s')));
            return array('status'=>'pending','order_id'=>$orderId,'idempotent'=>false);
        } catch (\Throwable $e) {
            $uncertain = $e instanceof ApiException && $e->status() === 0;
            Capsule::table('mod_cloudhost247_ovh_operations')->where('idempotency_key',$key)->update(array('status'=>$uncertain?'reconciliation_required':'failed','error_message'=>substr($e->getMessage(),0,1000),'updated_at'=>date('Y-m-d H:i:s')));
            Capsule::table('mod_cloudhost247_ovh_services')->where('whmcs_service_id',$serviceId)->update(array('status'=>$uncertain?'reconciliation_required':'failed','updated_at'=>date('Y-m-d H:i:s')));
            throw $e;
        }
    }

    private function beforeMutation($key, $step)
    {
        Capsule::table('mod_cloudhost247_ovh_operations')->where('idempotency_key',$key)->update(array('status'=>'remote_mutation','response_json'=>json_encode(array('pending_step'=>$step)),'updated_at'=>date('Y-m-d H:i:s')));
    }
    private function checkpoint($serviceId, $key, array $details)
    {
        Capsule::table('mod_cloudhost247_ovh_services')->where('id',$serviceId)->update(array('details_json'=>json_encode($details),'updated_at'=>date('Y-m-d H:i:s')));
        Capsule::table('mod_cloudhost247_ovh_operations')->where('idempotency_key',$key)->update(array('status'=>'running','response_json'=>json_encode(array('checkpoint'=>$details)),'updated_at'=>date('Y-m-d H:i:s')));
    }
}
