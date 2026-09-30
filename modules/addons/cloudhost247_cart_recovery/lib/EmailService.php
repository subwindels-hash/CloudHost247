<?php
namespace CloudHost247\CartRecovery;
final class EmailService {
    public static function template($n) { return 'CloudHost247 Abandoned Cart Reminder '.$n; }
    public static function ensureTemplates() {
        if(!function_exists('localAPI')) return;
        for($i=1;$i<=3;$i++){ $name=self::template($i); $exists=\WHMCS\Database\Capsule::table('tblemailtemplates')->where('name',$name)->where('type','general')->first(); if(!$exists) \WHMCS\Database\Capsule::table('tblemailtemplates')->insert(array('type'=>'general','name'=>$name,'subject'=>'Your CloudHost247 cart is ready to recover','message'=>'Hello {$customer_first_name},<br><br>Your cart is still available to recover:<br>{$cart_items}<br><br><a href="{$recovery_url}">Recover My Cart</a><br><br>Cart total: {$cart_currency} {$cart_total}<br>This link expires {$recovery_expires}.<br><br><a href="{$unsubscribe_url}">Stop receiving abandoned-cart reminders</a>','custom'=>'1','language'=>'english')); }
    }
    public static function send($row,$number,$url,$unsubscribe) {
        if(!function_exists('localAPI')) throw new \RuntimeException('WHMCS Local API is unavailable');
        $vars=array('customer_name'=>trim(($row->first_name?:'').' '.($row->last_name?:'')),'customer_first_name'=>$row->first_name?:'Customer','customer_email'=>$row->email,'cart_items'=>CartSnapshot::label($row->cart_snapshot),'cart_total'=>$row->cart_total===null?'':number_format((float)$row->cart_total,2),'cart_currency'=>$row->currency,'recovery_url'=>$url,'recovery_expires'=>$row->token_expires_at,'unsubscribe_url'=>$unsubscribe,'company_name'=>defined('CONFIG_COMPANYNAME')?CONFIG_COMPANYNAME:'CloudHost247','company_domain'=>defined('CONFIG_SystemURL')?CONFIG_SystemURL:'');
        $data=array('messagename'=>self::template($number),'customtype'=>'email','customvalue'=>$row->email,'customvars'=>$vars);
        if($row->client_id) { unset($data['customtype'],$data['customvalue']); $data['id']=(int)$row->client_id; }
        $result=localAPI('SendEmail',$data); if(isset($result['result'])&&$result['result']==='success') return true; throw new \RuntimeException('WHMCS email delivery failed');
    }
}
