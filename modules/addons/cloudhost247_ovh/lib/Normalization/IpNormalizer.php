<?php
namespace CloudHost247\Ovh\Normalization;
final class IpNormalizer
{public function normalize($input){$items=is_array($input)?$input:array($input);$out=array();array_walk_recursive($items,function($v,$k)use(&$out){if(!is_string($v))return;$candidate=trim(explode('/',$v)[0]);if(filter_var($candidate,FILTER_VALIDATE_IP))$out[$candidate]=array('address'=>$candidate,'version'=>strpos($candidate,':')!==false?6:4,'source_key'=>(string)$k);});return array_values($out);}}
