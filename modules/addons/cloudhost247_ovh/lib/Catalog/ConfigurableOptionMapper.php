<?php
namespace CloudHost247\Ovh\Catalog;

use WHMCS\Database\Capsule;
use InvalidArgumentException;

final class ConfigurableOptionMapper
{
    public function suggestions($mappingId)
    {
        $mapping = Capsule::table('mod_cloudhost247_ovh_product_mappings')->where('id',(int)$mappingId)->first();
        if (!$mapping) throw new InvalidArgumentException('Product mapping does not exist.');
        $catalog = Capsule::table('mod_cloudhost247_ovh_catalog')->where('endpoint_id',$mapping->endpoint_id)->where('family',$mapping->family)->where('plan_code',$mapping->plan_code)->first();
        if (!$catalog) return array();
        $ovh = Capsule::table('mod_cloudhost247_ovh_options')->where('catalog_id',$catalog->id)->get();
        $whmcs = Capsule::table('tblproductconfigoptions as o')->join('tblproductconfiglinks as l','l.gid','=','o.gid')->where('l.pid',$mapping->whmcs_product_id)->select('o.id','o.optionname')->get();
        $result=array();
        foreach($ovh as$remote){$remoteName=$this->normalize($remote->label);$matches=array();foreach($whmcs as$local)if($this->normalize(explode('|',$local->optionname)[0])===$remoteName)$matches[]=array('id'=>$local->id,'name'=>$local->optionname);$result[]=array('ovh_option_id'=>$remote->id,'ovh_label'=>$remote->label,'matches'=>$matches,'unambiguous'=>count($matches)===1);}
        return$result;
    }
    public function confirm($mappingId,$ovhOptionId,$whmcsOptionId,$whmcsSuboptionId,$adminId,$confirmed)
    {
        if(!$confirmed)throw new InvalidArgumentException('Explicit configurable-option mapping confirmation is required.');
        $suggestions=$this->suggestions($mappingId);$allowed=false;foreach($suggestions as$s)if((int)$s['ovh_option_id']===(int)$ovhOptionId)foreach($s['matches']as$m)if((int)$m['id']===(int)$whmcsOptionId)$allowed=true;
        if(!$allowed)throw new InvalidArgumentException('The selected option is not an exact discovered match.');
        if($whmcsSuboptionId&&!Capsule::table('tblproductconfigoptionssub')->where('id',(int)$whmcsSuboptionId)->where('configid',(int)$whmcsOptionId)->exists())throw new InvalidArgumentException('WHMCS suboption does not belong to the selected option.');
        Capsule::table('mod_cloudhost247_ovh_option_mappings')->updateOrInsert(array('mapping_id'=>(int)$mappingId,'ovh_option_id'=>(int)$ovhOptionId),array('whmcs_option_id'=>(int)$whmcsOptionId,'whmcs_suboption_id'=>$whmcsSuboptionId?(int)$whmcsSuboptionId:null,'admin_id'=>(int)$adminId,'created_at'=>date('Y-m-d H:i:s')));
    }
    private function normalize($value){return preg_replace('/[^a-z0-9]/','',strtolower(trim((string)$value)));}
}
