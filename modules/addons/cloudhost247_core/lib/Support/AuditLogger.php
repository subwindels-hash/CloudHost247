<?php
namespace CloudHost247\Foundation\Support;

use CloudHost247\Foundation\Security\SecretPolicy;
use WHMCS\Database\Capsule;

final class AuditLogger
{
    public static function record($module,$action,$resourceType,$resourceId,$before,$after,$result='success',$failureReason=null,$adminId=null)
    {
        $correlation=Logger::correlationId();
        Capsule::table('mod_cloudhost247_audit_events')->insert(array(
            'module'=>substr((string)$module,0,64),'admin_id'=>$adminId?:((int)($_SESSION['adminid']??0)?:null),'action'=>substr((string)$action,0,96),
            'resource_type'=>substr((string)$resourceType,0,48),'resource_id'=>substr((string)$resourceId,0,191),'before_json'=>json_encode(SecretPolicy::redact((array)$before)),
            'after_json'=>json_encode(SecretPolicy::redact((array)$after)),'result'=>in_array($result,array('success','failed','denied'),true)?$result:'failed',
            'failure_reason'=>$failureReason?substr(strip_tags((string)$failureReason),0,1000):null,'correlation_id'=>$correlation,'created_at'=>date('Y-m-d H:i:s'),
        ));
        return $correlation;
    }
}
