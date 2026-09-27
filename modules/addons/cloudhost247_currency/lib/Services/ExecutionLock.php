<?php
namespace CloudHost247\Currency\Services;
use WHMCS\Database\Capsule;
final class ExecutionLock
{
 private $name,$owner; public function __construct($name){$this->name=$name;$this->owner=bin2hex(random_bytes(16));}
 public function acquire($seconds=300){$now=date('Y-m-d H:i:s');$until=date('Y-m-d H:i:s',time()+(int)$seconds);try{Capsule::table('mod_cloudhost247_currency_locks')->insert(array('lock_name'=>$this->name,'owner'=>$this->owner,'locked_until'=>$until,'updated_at'=>$now));return true;}catch(\Throwable $e){}$updated=Capsule::table('mod_cloudhost247_currency_locks')->where('lock_name',$this->name)->where('locked_until','<',$now)->update(array('owner'=>$this->owner,'locked_until'=>$until,'updated_at'=>$now));return $updated===1;}
 public function release(){Capsule::table('mod_cloudhost247_currency_locks')->where('lock_name',$this->name)->where('owner',$this->owner)->delete();}
}
