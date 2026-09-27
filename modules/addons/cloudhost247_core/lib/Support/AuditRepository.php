<?php
namespace CloudHost247\Foundation\Support;
use WHMCS\Database\Capsule;
final class AuditRepository
{
 public function search(array $filters=array(),$page=1,$perPage=25){$page=max(1,(int)$page);$perPage=max(10,min(100,(int)$perPage));$q=Capsule::table('mod_cloudhost247_audit_events as e')->leftJoin('tbladmins as a','a.id','=','e.admin_id')->select('e.*','a.username as administrator');foreach(array('module','action','resource_type','result','correlation_id')as$f)if(!empty($filters[$f]))$q->where('e.'.$f,'=',substr((string)$filters[$f],0,$f==='correlation_id'?64:96));if(!empty($filters['admin_id']))$q->where('e.admin_id',(int)$filters['admin_id']);if(!empty($filters['resource']))$q->where('e.resource_id','like','%'.substr((string)$filters['resource'],0,100).'%');if(!empty($filters['from']))$q->where('e.created_at','>=',$this->date($filters['from']).' 00:00:00');if(!empty($filters['to']))$q->where('e.created_at','<=',$this->date($filters['to']).' 23:59:59');if(!empty($filters['q'])){$term='%'.substr(strip_tags((string)$filters['q']),0,100).'%';$q->where(function($x)use($term){$x->where('e.action','like',$term)->orWhere('e.resource_id','like',$term)->orWhere('e.correlation_id','like',$term);});}$count=(clone$q)->count();$rows=$q->orderBy('e.id','desc')->offset(($page-1)*$perPage)->limit($perPage)->get()->all();return array('rows'=>$rows,'total'=>$count,'page'=>$page,'pages'=>max(1,(int)ceil($count/$perPage)),'per_page'=>$perPage);}
 public function event($id){return Capsule::table('mod_cloudhost247_audit_events')->where('id',(int)$id)->first();}
 private function date($value){$value=(string)$value;if(!preg_match('/^\d{4}-\d{2}-\d{2}$/',$value))throw new \InvalidArgumentException('Invalid audit date filter.');return$value;}
}
