<?php
namespace CloudHost247\CartRecovery;
final class CartSnapshot {
    public static function capture($cart, $currency='') {
        $allowed=array('pid','product','productname','billingcycle','domain','domainoption','domaintype','addons','configoptions','customfields','quantity','期間','regperiod','paymentmethod','promocode','promotype','promovalue','recurring','subtotal','total','rawpricing');
        $clean=self::clean(is_array($cart)?$cart:array(),$allowed,0);
        return array('cart'=>$clean,'currency'=>substr((string)$currency,0,8),'captured_at'=>gmdate('c'));
    }
    private static function clean($v,$allowed,$depth) {
        if($depth>6) return null;
        if(is_scalar($v) || $v===null) return is_string($v)?substr($v,0,2000):$v;
        if(!is_array($v)) return null; $out=array();
        foreach($v as $k=>$x) { $key=(string)$k; if(preg_match('/password|passwd|secret|token|cvv|card.?number|api.?key|credential/i',$key)) continue; if($depth===0 || in_array(strtolower($key),$allowed,true) || is_numeric($key)) $out[substr($key,0,80)]=self::clean($x,$allowed,$depth+1); }
        return $out;
    }
    public static function restore($snapshot) { $s=json_decode((string)$snapshot,true); return is_array($s)&&isset($s['cart'])&&is_array($s['cart'])?$s['cart']:array(); }
    public static function total($snapshot) { $s=json_decode((string)$snapshot,true); foreach(array('total','subtotal') as $k) if(isset($s['cart'][$k])&&is_numeric($s['cart'][$k])) return (float)$s['cart'][$k]; return null; }
    public static function label($snapshot) { $cart=self::restore($snapshot); $items=array(); $walk=function($v)use(&$walk,&$items){if(!is_array($v))return; if(isset($v['pid'])||isset($v['productname']))$items[]=isset($v['productname'])?$v['productname']:'Product '.(isset($v['pid'])?$v['pid']:''); foreach($v as $x)$walk($x);}; $walk($cart); return implode(', ',array_slice(array_unique($items),0,8)); }
}
