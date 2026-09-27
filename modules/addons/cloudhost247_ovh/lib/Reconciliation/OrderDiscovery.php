<?php
namespace CloudHost247\Ovh\Reconciliation;

use CloudHost247\Ovh\Services\ConnectionResolver;
use WHMCS\Database\Capsule;

final class OrderDiscovery
{
    private $resolver;
    public function __construct(ConnectionResolver $resolver) { $this->resolver=$resolver; }

    public function discoverMissing($limit=25)
    {
        $rows=Capsule::table('mod_cloudhost247_ovh_services')->where('status','reconciliation_required')->whereNull('remote_order_id')->limit((int)$limit)->get();
        $result=array('resolved'=>0,'ambiguous'=>0,'none'=>0);
        foreach($rows as$service){$details=json_decode($service->details_json?:'{}',true)?:array();if(empty($details['cart_id'])){$result['none']++;continue;}$matches=$this->findByCart($service->endpoint_id,$details['cart_id']);if(count($matches)!==1){$result[count($matches)>1?'ambiguous':'none']++;continue;}$orderId=(string)$matches[0];Capsule::table('mod_cloudhost247_ovh_services')->where('id',$service->id)->update(array('remote_order_id'=>$orderId,'status'=>'pending','updated_at'=>date('Y-m-d H:i:s')));Capsule::table('mod_cloudhost247_ovh_operations')->where('whmcs_service_id',$service->whmcs_service_id)->where('operation','provision')->update(array('status'=>'success','remote_id'=>$orderId,'updated_at'=>date('Y-m-d H:i:s')));$result['resolved']++;}
        return$result;
    }

    public function findByCart($endpointId,$cartId)
    {
        if(!preg_match('/^[A-Za-z0-9._-]{3,191}$/',(string)$cartId))return array();
        $client=$this->resolver->endpoint($endpointId);$from=rawurlencode(gmdate('Y-m-d',time()-7*86400));$ids=(array)$client->get('/me/order?date.from='.$from);$matches=array();
        foreach(array_slice($ids,0,200)as$id){if(!is_scalar($id))continue;$order=$client->get('/me/order/'.rawurlencode((string)$id));$returned=(string)($order['cartId']??$order['cart_id']??'');if(hash_equals((string)$cartId,$returned))$matches[]=(string)$id;}
        return array_values(array_unique($matches));
    }
}
