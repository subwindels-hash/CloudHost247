<?php
namespace CloudHost247\Ovh\Reconciliation;

final class ServiceMatcher
{
    public function rank($remoteName, array $whmcsServices)
    {
        $remote=$this->normalize($remoteName);$results=array();
        foreach($whmcsServices as$service){$domain=$this->normalize(isset($service['domain'])?$service['domain']:'');$score=0;$reasons=array();if($domain!==''&&hash_equals($remote,$domain)){$score=100;$reasons[]='exact-domain';}elseif($domain!==''&&(strpos($remote,$domain)!==false||strpos($domain,$remote)!==false)){$score=60;$reasons[]='domain-substring';}if(isset($service['dedicatedip'])&&filter_var($service['dedicatedip'],FILTER_VALIDATE_IP)&&strpos((string)$remoteName,(string)$service['dedicatedip'])!==false){$score=max($score,80);$reasons[]='ip-present';}if($score)$results[]=array('whmcs_service_id'=>(int)$service['id'],'score'=>$score,'reasons'=>$reasons);}
        usort($results,function($a,$b){return$b['score']-$a['score'];});return$results;
    }
    public function unambiguous(array $ranked){return count($ranked)===1&&$ranked[0]['score']===100?$ranked[0]:null;}
    private function normalize($value){return strtolower(rtrim(trim((string)$value),'.'));}
}
