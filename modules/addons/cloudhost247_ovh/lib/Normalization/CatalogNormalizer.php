<?php
namespace CloudHost247\Ovh\Normalization;

use CloudHost247\Ovh\Pricing\SourcePriceExtractor;

final class CatalogNormalizer
{
    public function plan(array $plan)
    {
        $details = $this->firstArray($plan,array('hardware','technicalDetails','specifications','details','blobs')) ?: $plan;
        return array(
            'plan_code'=>(string)$this->first($plan,array('planCode','plan_code','code')),
            'name'=>(string)($this->first($plan,array('invoiceName','displayName','name','planCode')) ?: ''),
            'product_family'=>(string)($this->first($plan,array('product','family','productFamily')) ?: ''),
            'availability'=>$this->availability($plan),
            'cpu'=>$this->firstRecursive($details,array('cpu','processor','cpuName','vcore','vcores')),
            'ram'=>$this->firstRecursive($details,array('memory','ram','memorySize')),
            'storage'=>$this->firstRecursive($details,array('storage','disk','disks','drives','diskSize')),
            'network'=>$this->firstRecursive($details,array('bandwidth','network','traffic','publicBandwidth')),
            'datacenters'=>$this->listRecursive($plan,array('datacenters','datacenter','regions','region','locations','localizations')),
            'operating_systems'=>$this->listRecursive($plan,array('operatingSystems','operatingSystem','os','images','templates')),
            'configurations'=>$this->configurations($plan),
            'source_price'=>(new SourcePriceExtractor())->extract($plan),
        );
    }
    private function first(array $data,array $keys){foreach($keys as$key)if(array_key_exists($key,$data)&&$data[$key]!==''&&$data[$key]!==null)return$data[$key];return null;}
    private function firstArray(array $data,array $keys){$value=$this->first($data,$keys);return is_array($value)?$value:null;}
    private function firstRecursive($data,array $keys){if(!is_array($data))return null;$direct=$this->first($data,$keys);if($direct!==null)return$direct;foreach($data as$value)if(is_array($value)){ $found=$this->firstRecursive($value,$keys);if($found!==null)return$found;}return null;}
    private function listRecursive(array $data,array $keys){$value=$this->firstRecursive($data,$keys);if($value===null)return array();if(!is_array($value))return array($value);$out=array();array_walk_recursive($value,function($item)use(&$out){if(is_scalar($item)&&$item!=='')$out[]=$item;});return array_values(array_unique($out,SORT_REGULAR));}
    private function availability(array $plan){$value=$this->firstRecursive($plan,array('available','availability','status','stock'));return$value===null?'unknown':$value;}
    private function configurations(array $plan){$out=array();foreach(array('configurations','options','addonFamilies','addons','choices')as$key){$groups=$this->firstRecursive($plan,array($key));if(!is_array($groups))continue;foreach($groups as$optionKey=>$value)$out[]=array('key'=>is_string($optionKey)?$optionKey:(string)($value['name']??$value['planCode']??$optionKey),'value'=>$value,'source_field'=>$key);}return$out;}
}
