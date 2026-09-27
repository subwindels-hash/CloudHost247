<?php
namespace CloudHost247\Rdp\Operations;
use CloudHost247\Rdp\Contracts\Ledger;use WHMCS\Database\Capsule;
final class DatabaseLedger implements Ledger
{
 public function ensureSchema(){(new \CloudHost247\Foundation\Database\MigrationRunner())->run('cloudhost247_rdp',array(new \CloudHost247\Rdp\Migrations\RdpInitialMigration()));}
 public function operation($key){return Capsule::table('mod_cloudhost247_rdp_operations')->where('idempotency_key',$key)->first();}
 public function begin(array$o){$now=date('Y-m-d H:i:s');Capsule::table('mod_cloudhost247_rdp_operations')->insert(array('whmcs_service_id'=>(int)$o['service_id'],'client_id'=>(int)$o['client_id'],'operation'=>$o['operation'],'operation_id'=>$o['operation_id'],'idempotency_key'=>$o['idempotency_key'],'status'=>'running','evidence_json'=>'{}','attempts'=>1,'started_at'=>$now,'updated_at'=>$now));}
 public function retry($key){Capsule::table('mod_cloudhost247_rdp_operations')->where('idempotency_key',$key)->where('status','failed')->increment('attempts',1,array('status'=>'running','error_code'=>null,'finished_at'=>null,'updated_at'=>date('Y-m-d H:i:s')));}
 public function finish($key,$status,array$evidence=array(),$errorCode=null){$safe=array_intersect_key($evidence,array_flip(array('provider_operation_id','provider_status','provider_service_id','correlation_id')));Capsule::table('mod_cloudhost247_rdp_operations')->where('idempotency_key',$key)->update(array('provider_operation_id'=>$safe['provider_operation_id']??null,'status'=>$status,'error_code'=>$errorCode?substr($errorCode,0,64):null,'evidence_json'=>json_encode($safe),'finished_at'=>in_array($status,array('completed','failed'),true)?date('Y-m-d H:i:s'):null,'updated_at'=>date('Y-m-d H:i:s')));}
 public function binding($serviceId){return Capsule::table('mod_cloudhost247_rdp_services')->where('whmcs_service_id',(int)$serviceId)->first();}
 public function bind(array$b){Capsule::table('mod_cloudhost247_rdp_services')->insert(array('whmcs_service_id'=>(int)$b['service_id'],'client_id'=>(int)$b['client_id'],'provider_service_id'=>$b['provider_service_id'],'status'=>$b['status'],'safe_details_json'=>json_encode($this->safeDetails($b['details']??array())),'last_verified_at'=>date('Y-m-d H:i:s'),'updated_at'=>date('Y-m-d H:i:s')));}
 public function updateBinding($serviceId,$status,array$details=array()){$values=array('status'=>$status,'last_verified_at'=>date('Y-m-d H:i:s'),'updated_at'=>date('Y-m-d H:i:s'));if($details)$values['safe_details_json']=json_encode($this->safeDetails($details));Capsule::table('mod_cloudhost247_rdp_services')->where('whmcs_service_id',(int)$serviceId)->update($values);}
 public function recent($serviceId,$limit=25){return Capsule::table('mod_cloudhost247_rdp_operations')->where('whmcs_service_id',(int)$serviceId)->orderBy('id','desc')->limit(max(1,min(100,(int)$limit)))->get()->all();}
 private function safeDetails(array$d){return array_intersect_key($d,array_flip(array('hostname','username','ip','location','product','status')));}
}
