<?php
$root=dirname(__DIR__,2);require_once $root.'/modules/addons/cloudhost247_core/lib/Security/SecretPolicy.php';require_once $root.'/modules/addons/cloudhost247_core/lib/Support/Logger.php';foreach(array('Api/Credentials','Api/Endpoint','Api/ApiException','Api/Transport','Api/Client','Normalization/CatalogNormalizer','Normalization/IpNormalizer','Pricing/PriceCalculator','Pricing/SourcePriceExtractor','Reconciliation/ServiceMatcher','Reconciliation/ProvisioningDecision','Reconciliation/OrderResourceResolver','Services/ProvisioningStatePresenter')as$f)require_once $root.'/modules/addons/cloudhost247_ovh/lib/'.$f.'.php';
// A drained queue means the client made a call the test did not anticipate.
// Returning array_shift() of an empty array handed back null, which Client
// then read as $r['status'] and $r['body'] -- so the real signal (an
// unexpected request) surfaced only as a pile of PHP warnings. Fail loudly.
class MockTransport implements \CloudHost247\Ovh\Api\Transport{
    public$calls=array();private$responses;
    function __construct($r){$this->responses=$r;}
    function send($m,$u,array$h,$b,$ct,$t,$max){
        $this->calls[]=compact('m','u','h','b');
        if(!$this->responses)throw new RuntimeException('MockTransport queue drained: unexpected call #'.count($this->calls).' '.$m.' '.$u);
        return array_shift($this->responses);
    }
}

// Collect PHP diagnostics rather than letting them scroll past the assertions.
// Asserted empty at the end of the suite, so a warning fails the run instead
// of becoming background noise that masks the next one.
$phpDiagnostics=array();
set_error_handler(function($no,$str,$file,$line)use(&$phpDiagnostics){$phpDiagnostics[]=basename($file).':'.$line.' '.$str;return true;});
$tests=array();$c=new \CloudHost247\Ovh\Api\Credentials('application-key','application-secret','consumer-key');$expected='$1$'.sha1('application-secret+consumer-key+GET+https://eu.api.ovh.com/1.0/me++100');$tests['signature']=$c->signature('GET','https://eu.api.ovh.com/1.0/me','',100)===$expected;$tests['endpoint allowlist']=\CloudHost247\Ovh\Api\Endpoint::forRegion('us')==='https://api.us.ovhcloud.com/1.0';try{\CloudHost247\Ovh\Api\Endpoint::path('/../secret');$tests['path traversal']=false;}catch(Throwable$e){$tests['path traversal']=true;}
$t=new MockTransport(array(array('status'=>200,'body'=>(string)time(),'retry_after'=>0),array('status'=>200,'body'=>'{"nichandle":"ab123"}','retry_after'=>0)));$client=new \CloudHost247\Ovh\Api\Client('eu',$c,$t);$tests['authenticated json']=$client->get('/me')['nichandle']==='ab123';$headers=implode("\n",$t->calls[1]['h']);$tests['auth headers']=strpos($headers,'X-Ovh-Signature: $1$')!==false&&strpos($headers,'application-secret')===false;
// A GET is retried three times, so the queue needs a response per attempt.
// With only two entries this drained after the first retry and the exception
// that finally escaped was the generic "request failed" built from a null
// response -- not the malformed-JSON one the test is named for. Assert the
// specific exception, not merely that something was thrown.
$notJson=array('status'=>200,'body'=>'not-json','retry_after'=>0);
$t=new MockTransport(array(array('status'=>200,'body'=>(string)time(),'retry_after'=>0),$notJson,$notJson,$notJson));
try{(new \CloudHost247\Ovh\Api\Client('eu',$c,$t))->get('/me');$tests['malformed response']=false;}
catch(\CloudHost247\Ovh\Api\ApiException$e){$tests['malformed response']=strpos($e->getMessage(),'malformed JSON')!==false&&count($t->calls)===4;}
catch(Throwable$e){$tests['malformed response']=false;}
$t=new MockTransport(array(array('status'=>200,'body'=>(string)time(),'retry_after'=>0),array('status'=>429,'body'=>'{}','retry_after'=>0),array('status'=>200,'body'=>'[]','retry_after'=>0)));try{(new \CloudHost247\Ovh\Api\Client('eu',$c,$t))->get('/vps');$tests['rate limit retry']=count($t->calls)===3;}catch(Throwable$e){$tests['rate limit retry']=false;}

$n=(new \CloudHost247\Ovh\Normalization\CatalogNormalizer())->plan(array('planCode'=>'vps-1','availability'=>true,'technicalDetails'=>array('cpu'=>'4 cores','memory'=>'8 GB','storage'=>'160 GB','bandwidth'=>'1 Gbps'),'regions'=>array('gra','bhs'),'operatingSystems'=>array('linux')));$tests['catalog normalization']=$n['cpu']==='4 cores'&&$n['ram']==='8 GB'&&$n['datacenters']===array('gra','bhs');
$ips=(new \CloudHost247\Ovh\Normalization\IpNormalizer())->normalize(array('ips'=>array('192.0.2.1','2001:db8::1'),'noise'=>'x'));$tests['ip normalization']=count($ips)===2&&$ips[1]['version']===6;
$price=(new \CloudHost247\Ovh\Pricing\PriceCalculator())->calculate(100,1.25,1.5,10,2,'nearest');$tests['catalog currency margin']=abs($price-132.0)<0.0001;


$extractor=new \CloudHost247\Ovh\Pricing\SourcePriceExtractor();$resolved=$extractor->extract(array('prices'=>array(array('duration'=>'P1M','price'=>array('value'=>12.5,'currencyCode'=>'EUR')))),'P1M');$tests['unambiguous source price']=$resolved['status']==='resolved'&&$resolved['price']===12.5&&$resolved['currency']==='EUR';
$ambiguous=$extractor->extract(array('prices'=>array(array('value'=>10,'currency'=>'USD'),array('value'=>11,'currency'=>'USD'))));$tests['ambiguous price rejected']=$ambiguous['status']==='ambiguous'&&count($ambiguous['candidates'])===2;
$variant=(new \CloudHost247\Ovh\Normalization\CatalogNormalizer())->plan(array('code'=>'regional-1','details'=>array('processor'=>'EPYC','memorySize'=>'32 GB','diskSize'=>'2 TB','publicBandwidth'=>'1 Gbps'),'localizations'=>array(array('region'=>'GRA'),array('region'=>'BHS'))));$tests['regional catalog variation']=$variant['cpu']==='EPYC'&&$variant['ram']==='32 GB'&&in_array('GRA',$variant['datacenters'],true);
$matcher=new \CloudHost247\Ovh\Reconciliation\ServiceMatcher();$ranked=$matcher->rank('vps.example.test',array(array('id'=>9,'domain'=>'vps.example.test','dedicatedip'=>''),array('id'=>10,'domain'=>'other.test','dedicatedip'=>'')));$tests['service exact match']=$matcher->unambiguous($ranked)['whmcs_service_id']===9;
$decision=new \CloudHost247\Ovh\Reconciliation\ProvisioningDecision();$tests['uncertain provisioning stops']=$decision->actionForStatus('reconciliation_required')==='stop'&&$decision->failureStatus(0)==='reconciliation_required'&&$decision->actionForStatus('failed')==='resume';
$states=new \CloudHost247\Ovh\Services\ProvisioningStatePresenter();$tests['customer active state safe']=$states->present('active')['message']==='The service is active.';$tests['unknown state not verified']=$states->present('unexpected')['key']==='not_verified'&&$states->present('unexpected')['label']==='Not Verified';
try{(new \CloudHost247\Ovh\Pricing\PriceCalculator())->calculate(10,0,1,0,2,'nearest');$tests['zero conversion rejected']=false;}catch(Throwable$e){$tests['zero conversion rejected']=true;}
$resolver=new \CloudHost247\Ovh\Reconciliation\OrderResourceResolver();$tests['order binding unique']=$resolver->resolve(array(array('serviceName'=>'vps-1')))['service_name']==='vps-1';$tests['order binding ambiguity']=$resolver->resolve(array(array('serviceName'=>'vps-1'),array('domain'=>'vps-2')))['status']==='ambiguous';

$drained=new MockTransport(array());
try{$drained->send('GET','https://eu.api.ovh.com/1.0/me',array(),'',5,30,5000000);$tests['mock transport fails loudly when drained']=false;}
catch(RuntimeException$e){$tests['mock transport fails loudly when drained']=strpos($e->getMessage(),'queue drained')!==false&&count($drained->calls)===1;}

// ---- Advanced operations (snapshots, rescue, IPMI, reinstall, monitoring) -------------------
// A minimal audit sink stands in for WHMCS's Capsule so AuditLogger can run without a database.
if(!class_exists('WHMCS\\Database\\Capsule',false)){eval('namespace WHMCS\\Database; class Capsule{public static $rows=array();static function table($t){return new self;}function insert($r){self::$rows[]=$r;return true;}}');}
require_once $root.'/modules/addons/cloudhost247_core/lib/Security/SecretPolicy.php';
require_once $root.'/modules/addons/cloudhost247_core/lib/Support/AuditLogger.php';
require_once $root.'/modules/addons/cloudhost247_ovh/lib/Services/AdvancedOperations.php';
class AdvManagerStub{public $reads=array();public $writes=array();public $family;public $name='vps-ab12.ovh.net';
 function __construct($family){$this->family=$family;}
 function identity($id){return array('family'=>$this->family,'service_name'=>$this->name,'endpoint_id'=>1);}
 function readSub($id,$suffix){$this->reads[]=$suffix;return array('ok'=>true);}
 function performSub($id,$action,$method,$suffix,array $body=array()){$this->writes[]=compact('action','method','suffix','body');return array('taskId'=>7);}}
$adv=function($family){$m=new AdvManagerStub($family);return array(new \CloudHost247\Ovh\Services\AdvancedOperations($m),$m);};
$throws=function($fn){try{$fn();return false;}catch(Throwable$e){return true;}};
list($a,$m)=$adv('vps');$a->read(5,'vps_snapshot_status');$tests['advanced read uses allowlisted path']=$m->reads===array('/snapshot')&&$m->writes===array();
list($a,$m)=$adv('vps');$tests['advanced read rejects wrong family']=$throws(function()use($a){$a->read(5,'dedicated_tasks');});
list($a,$m)=$adv('vps');$tests['advanced unknown action rejected']=$throws(function()use($a){$a->run(5,'vps_format_disk',array(),true);});
list($a,$m)=$adv('vps');$tests['advanced write cannot go through read()']=$throws(function()use($a){$a->read(5,'vps_reinstall');});
list($a,$m)=$adv('vps');$tests['advanced write needs confirmation']=$throws(function()use($a){$a->run(5,'vps_snapshot_create',array('description'=>'pre-upgrade'),false);})&&$m->writes===array();
list($a,$m)=$adv('vps');$a->run(5,'vps_snapshot_create',array('description'=>'pre-upgrade 1'),true);$tests['snapshot create request shape']=$m->writes[0]['method']==='POST'&&$m->writes[0]['suffix']==='/createSnapshot'&&$m->writes[0]['body']===array('description'=>'pre-upgrade 1')&&$m->writes[0]['action']==='adv_vps_snapshot_create';
list($a,$m)=$adv('vps');$tests['snapshot description validated']=$throws(function()use($a){$a->run(5,'vps_snapshot_create',array('description'=>"x<script>"),true);})&&$throws(function()use($a){$a->run(5,'vps_snapshot_create',array('description'=>''),true);});
list($a,$m)=$adv('vps');$tests['destructive needs typed service name']=$throws(function()use($a){$a->run(5,'vps_reinstall',array('template_id'=>'123'),true,'');})&&$throws(function()use($a){$a->run(5,'vps_reinstall',array('template_id'=>'123'),true,'wrong.ovh.net');})&&$m->writes===array();
list($a,$m)=$adv('vps');$a->run(5,'vps_reinstall',array('template_id'=>'123'),true,'vps-ab12.ovh.net');$tests['vps reinstall request shape']=$m->writes[0]['suffix']==='/reinstall'&&$m->writes[0]['body']===array('templateId'=>123);
list($a,$m)=$adv('vps');$tests['reinstall template id strict']=$throws(function()use($a){$a->run(5,'vps_reinstall',array('template_id'=>'12;DROP'),true,'vps-ab12.ovh.net');})&&$throws(function()use($a){$a->run(5,'vps_reinstall',array('template_id'=>'0'),true,'vps-ab12.ovh.net');});
list($a,$m)=$adv('vps');$a->run(5,'vps_snapshot_delete',array(),true,'vps-ab12.ovh.net');$tests['snapshot delete uses DELETE']=$m->writes[0]['method']==='DELETE'&&$m->writes[0]['suffix']==='/snapshot';
list($a,$m)=$adv('dedicated');$m->name='ns123.ip-1-2-3.eu';$a->run(6,'dedicated_ipmi_access',array('ip_to_allow'=>'203.0.113.9','ttl'=>'15','type'=>'kvmipHtml5URL'),true);$tests['ipmi access request shape']=$m->writes[0]['suffix']==='/features/ipmi/access'&&$m->writes[0]['body']===array('ipToAllow'=>'203.0.113.9','ttl'=>15,'type'=>'kvmipHtml5URL');
list($a,$m)=$adv('dedicated');$tests['ipmi inputs validated']=$throws(function()use($a){$a->run(6,'dedicated_ipmi_access',array('ip_to_allow'=>'nope','ttl'=>'15','type'=>'kvmipHtml5URL'),true);})&&$throws(function()use($a){$a->run(6,'dedicated_ipmi_access',array('ip_to_allow'=>'203.0.113.9','ttl'=>'999','type'=>'kvmipHtml5URL'),true);})&&$throws(function()use($a){$a->run(6,'dedicated_ipmi_access',array('ip_to_allow'=>'203.0.113.9','ttl'=>'5','type'=>'shell'),true);});
list($a,$m)=$adv('dedicated');$a->run(6,'dedicated_monitoring',array('monitoring'=>'0'),true);$a->run(6,'dedicated_set_boot',array('boot_id'=>'1122'),true);$tests['dedicated PUT operations']=$m->writes[0]['method']==='PUT'&&$m->writes[0]['suffix']===''&&$m->writes[0]['body']===array('monitoring'=>false)&&$m->writes[1]['body']===array('bootId'=>1122);
list($a,$m)=$adv('dedicated');$m->name='ns1.eu';$a->run(6,'dedicated_reinstall',array('template_name'=>'debian12_64','hostname'=>'srv-1.example.test'),true,'ns1.eu');$tests['dedicated reinstall request shape']=$m->writes[0]['suffix']==='/install/start'&&$m->writes[0]['body']===array('templateName'=>'debian12_64','details'=>array('customHostname'=>'srv-1.example.test'));
list($a,$m)=$adv('dedicated');$m->name='ns1.eu';$tests['dedicated reinstall template strict']=$throws(function()use($a){$a->run(6,'dedicated_reinstall',array('template_name'=>'../etc','hostname'=>''),true,'ns1.eu');});
list($a,$m)=$adv('dedicated');$tests['advanced op blocked on wrong family']=$throws(function()use($a){$a->run(6,'vps_snapshot_create',array('description'=>'x'),true);});
$tests['advanced writes audited']=count(\WHMCS\Database\Capsule::$rows)>=1&&strpos(json_encode(\WHMCS\Database\Capsule::$rows),'application-secret')===false;
$destructive=array_filter(\CloudHost247\Ovh\Services\AdvancedOperations::catalog(),function($d){return $d['kind']==='write'&&!empty($d['destructive']);});$tests['destructive set is exactly reinstall/revert/delete']=array_keys($destructive)===array('vps_snapshot_revert','vps_snapshot_delete','vps_reinstall','dedicated_reinstall');

restore_error_handler();
$tests['no php diagnostics raised']=($phpDiagnostics===array());
foreach(array_slice(array_unique($phpDiagnostics),0,5)as$d)echo "# diagnostic: $d\n";

$fail=0;foreach($tests as$n=>$ok){echo($ok?'ok':'not ok')." - $n\n";if(!$ok)$fail++;}exit($fail?1:0);
