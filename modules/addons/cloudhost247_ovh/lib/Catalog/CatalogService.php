<?php
namespace CloudHost247\Ovh\Catalog;

use CloudHost247\Ovh\Normalization\CatalogNormalizer;
use CloudHost247\Ovh\Services\ConnectionResolver;
use WHMCS\Database\Capsule;
use RuntimeException;

final class CatalogService
{
    private $resolver;
    private $normalizer;
    public function __construct(ConnectionResolver $resolver, CatalogNormalizer $normalizer = null) { $this->resolver=$resolver; $this->normalizer=$normalizer ?: new CatalogNormalizer(); }

    public function sync($endpointId, $subsidiary='US', $family='eco')
    {
        if (!in_array($family, array('eco','vps'), true)) throw new RuntimeException('Unsupported catalog family.');
        $data=$this->resolver->endpoint($endpointId)->get('/order/catalog/public/'.rawurlencode($family).'?ovhSubsidiary='.rawurlencode(strtoupper($subsidiary)));
        if (!isset($data['plans']) || !is_array($data['plans'])) throw new RuntimeException('Catalog response contains no plans.');
        $seen=array();
        foreach ($data['plans'] as $plan) {
            if (empty($plan['planCode'])) continue;
            $normalized=$this->normalizer->plan($plan); $code=$normalized['plan_code']; $seen[]=$code;
            Capsule::table('mod_cloudhost247_ovh_catalog')->updateOrInsert(array('endpoint_id'=>$endpointId,'family'=>$family,'plan_code'=>$code),array('invoice_name'=>substr($normalized['name'],0,255),'currency'=>$data['locale']['currencyCode']??null,'catalog_json'=>json_encode(array('raw'=>$plan,'normalized'=>$normalized)),'available'=>$normalized['availability']===false?0:1,'last_seen_at'=>date('Y-m-d H:i:s')));
            $catalog=Capsule::table('mod_cloudhost247_ovh_catalog')->where('endpoint_id',$endpointId)->where('family',$family)->where('plan_code',$code)->first();
            foreach ($normalized['configurations'] as $option) {
                $key=substr(preg_replace('/[^A-Za-z0-9._-]/','-',(string)$option['key']),0,191);
                Capsule::table('mod_cloudhost247_ovh_options')->updateOrInsert(array('catalog_id'=>$catalog->id,'option_type'=>substr($option['source_field'],0,32),'option_key'=>$key),array('label'=>substr((string)$option['key'],0,255),'value_json'=>json_encode($option['value']),'updated_at'=>date('Y-m-d H:i:s')));
            }
        }
        Capsule::table('mod_cloudhost247_ovh_catalog')->where('endpoint_id',$endpointId)->where('family',$family)->whereNotIn('plan_code',$seen?:array(''))->update(array('available'=>0));
        return count($seen);
    }
}
