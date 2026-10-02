<?php
$root=dirname(__DIR__,2);require_once $root.'/tests/ovh/fakes.php';ch247_ovh_fresh();require_once $root.'/modules/addons/cloudhost247_core/lib/Security/SecretPolicy.php';require_once $root.'/modules/addons/cloudhost247_core/lib/Support/Logger.php';foreach(array('Api/Credentials','Api/Endpoint','Api/ApiException','Api/Transport','Api/Client','Normalization/CatalogNormalizer','Normalization/IpNormalizer','Normalization/OptionValueExtractor','Normalization/ProductSpecifications','Pricing/PriceCalculator','Pricing/SourcePriceExtractor','Reconciliation/ServiceMatcher','Reconciliation/ProvisioningDecision','Reconciliation/OrderResourceResolver','Reconciliation/ExistingServiceLinker','Catalog/DiscoveredOptionMatcher','Catalog/ConfigurableOptionMapper','Products/HostingProductManager','Services/ProvisioningStatePresenter','Services/ConnectionResolver')as$f)require_once $root.'/modules/addons/cloudhost247_ovh/lib/'.$f.'.php';
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
$tests['advanced writes audited']=count(ch247_ovh_rows('mod_cloudhost247_audit_events'))>=1&&strpos(json_encode(ch247_ovh_rows('mod_cloudhost247_audit_events')),'application-secret')===false;
$destructive=array_filter(\CloudHost247\Ovh\Services\AdvancedOperations::catalog(),function($d){return $d['kind']==='write'&&!empty($d['destructive']);});$tests['destructive set is exactly reinstall/revert/delete']=array_keys($destructive)===array('vps_snapshot_revert','vps_snapshot_delete','vps_reinstall','dedicated_reinstall');

// ---- SESSION A2: discovery, normalization and reconciliation ------------------------------
// The fake DB and the classes under test (loaded at the top with the rest of the suite).
ch247_ovh_fresh();

// --- OptionValueExtractor: recognised shapes resolve, everything else is refused.
$extractor = new \CloudHost247\Ovh\Normalization\OptionValueExtractor();
$flat = $extractor->values(array('linux','windows'));
$objects = $extractor->values(array(array('name'=>'Debian 12','planCode'=>'debian12'),array('label'=>'Ubuntu 22','code'=>'ubuntu22')));
$map = $extractor->values(array('linux'=>'Linux','windows'=>'Windows'));
$tests['option values: flat list'] = $flat['status']==='resolved'&&count($flat['values'])===2;
$tests['option values: object list uses codes as identity'] = $objects['status']==='resolved'&&$objects['values'][0]['key']==='debian12'&&$objects['values'][1]['key']==='ubuntu22';
$tests['option values: key/label map'] = $map['status']==='resolved'&&$map['values'][0]['key']==='linux'&&$map['values'][0]['label']==='Linux';
$tests['option values: unrecognised shape refused'] = $extractor->values(array(array('nested'=>array('x'=>1))))['status']==='unverified';
$tests['option values: empty and scalar distinguished'] = $extractor->values(array())['status']==='empty'&&$extractor->values('')['status']==='empty'&&$extractor->values('linux')['status']==='resolved';
$tests['option values: duplicates collapse'] = count($extractor->values(array('Linux','linux','LINUX'))['values'])===1;
$tests['option values: markup stripped from labels'] = $extractor->values(array('<b>Linux</b>'))['values'][0]['label']==='Linux';

// --- DiscoveredOptionMatcher: exact matching, ambiguity reported, never guessed.
$matcher = new \CloudHost247\Ovh\Catalog\DiscoveredOptionMatcher();
$suggestions = $matcher->match(
    array(array('id'=>3,'label'=>'Operating System','option_type'=>'operatingSystems','status'=>'resolved','values'=>array(array('key'=>'debian12','label'=>'Debian 12'),array('key'=>'ubuntu22','label'=>'Ubuntu 22')))),
    array(array('id'=>11,'name'=>'operating_system'),array('id'=>12,'name'=>'Operating System (legacy)')),
    array(array('id'=>101,'configid'=>11,'name'=>'debian_12'),array('id'=>102,'configid'=>11,'name'=>'ubuntu_22'))
);
$tests['option match: normalization finds the WHMCS option'] = count($suggestions)===1&&count($suggestions[0]['matches'])===1&&$suggestions[0]['matches'][0]['id']===11&&$suggestions[0]['unambiguous'];
$ambiguous = $matcher->match(
    array(array('id'=>3,'label'=>'Operating System','option_type'=>'operatingSystems','status'=>'resolved','values'=>array(array('key'=>'debian12','label'=>'Debian 12')))),
    array(array('id'=>11,'name'=>'operating_system'),array('id'=>14,'name'=>'Operating-System')),
    array(array('id'=>101,'configid'=>11,'name'=>'debian_12'))
);
$tests['option match: an ambiguous option name is reported, not guessed'] = count($ambiguous[0]['matches'])===2&&$ambiguous[0]['unambiguous']===false&&$ambiguous[0]['value_mapping_possible']===false;
$tests['option match: value-level exact suboption'] = $suggestions[0]['values'][0]['unambiguous']&&$suggestions[0]['values'][0]['matches'][0]['id']===101;
$tests['option match: multi-value option needs a value mapping'] = $suggestions[0]['suboption_required']===true&&$suggestions[0]['value_mapping_possible']===true;
$unmatched = $matcher->match(array(array('id'=>4,'label'=>'Datacenter','option_type'=>'regions','status'=>'unverified','values'=>array())), array(array('id'=>11,'name'=>'operating_system')), array());
$tests['option match: no exact name means no suggestion'] = $unmatched[0]['matches']===array()&&$unmatched[0]['unambiguous']===false;
$tests['option match: non-exact value refused'] = $matcher->admits($suggestions,3,11,101)&&!$matcher->admits($suggestions,3,11,999)&&!$matcher->admits($suggestions,3,12,101);
$tests['option match: provenance only when proved'] = $matcher->valueWasProven($suggestions,3,101)&&!$matcher->valueWasProven($suggestions,3,0);
$unverifiedList = $matcher->match(
    array(array('id'=>5,'label'=>'Operating System','option_type'=>'operatingSystems','status'=>'unverified','values'=>array())),
    array(array('id'=>11,'name'=>'operating_system')),
    array(array('id'=>101,'configid'=>11,'name'=>'debian_12'))
);
$tests['option match: unverified list still admits a manual value, marked unproven'] = $matcher->admits($unverifiedList,5,11,101)&&!$matcher->valueWasProven($unverifiedList,5,101);

// --- ProductSpecifications: evidence only, and the unverified list is explicit.
$specs = new \CloudHost247\Ovh\Normalization\ProductSpecifications();
$full = $specs->fromPlan(array('plan_code'=>'vps-1','cpu'=>'4 cores','ram'=>'8 GB','storage'=>'160 GB','network'=>'1 Gbps','datacenters'=>array('GRA','BHS'),'operating_systems'=>array('linux'),'ips'=>array('203.0.113.5','2001:db8::1')));
$partial = $specs->fromPlan(array('plan_code'=>'eco-1','cpu'=>'2 cores'));
$tests['specifications: catalog fields mapped'] = $full['specifications']['cpu']==='4 cores'&&$full['specifications']['datacenter']==='GRA, BHS'&&$full['specifications']['operating_system']==='linux';
$tests['specifications: addresses split by version'] = $full['specifications']['ipv4']==='203.0.113.5'&&$full['specifications']['ipv6']==='2001:db8::1';
$tests['specifications: complete set verifies every field'] = $full['unverified']===array()&&$full['verified']['storage']===true;
$tests['specifications: absent fields stay empty and unverified'] = $partial['specifications']['storage']===''&&in_array('storage',$partial['unverified'],true)&&in_array('ipv4',$partial['unverified'],true)&&$partial['sources']['cpu']==='catalog'&&$partial['sources']['storage']==='not_verified';
$longList = $specs->fromPlan(array('datacenters'=>array('GRA','BHS','SBG','DE1','UK1','WAW','RBX','LON','FRA','AMS')));
$tests['specifications: summary list cut between entries'] = strlen($longList['specifications']['datacenter'])<=191&&substr($longList['specifications']['datacenter'],-1)!==',';

// --- ConfigurableOptionMapper through the fake DB: discovery and verified confirmation.
$mapper = new \CloudHost247\Ovh\Catalog\ConfigurableOptionMapper();
\WHMCS\Database\Capsule::table('mod_cloudhost247_ovh_product_mappings')->insert(array('id'=>1,'whmcs_product_id'=>77,'endpoint_id'=>2,'family'=>'vps','plan_code'=>'vps-1','subsidiary'=>'US','active'=>1));
\WHMCS\Database\Capsule::table('mod_cloudhost247_ovh_catalog')->insert(array('id'=>5,'endpoint_id'=>2,'family'=>'vps','plan_code'=>'vps-1','catalog_json'=>'{}'));
\WHMCS\Database\Capsule::table('mod_cloudhost247_ovh_options')->insert(array('id'=>3,'catalog_id'=>5,'option_type'=>'operatingSystems','option_key'=>'os','label'=>'Operating System','value_json'=>json_encode(array(array('name'=>'Debian 12','planCode'=>'debian12'),array('name'=>'Ubuntu 22','planCode'=>'ubuntu22')))));
\WHMCS\Database\Capsule::table('tblproductconfigoptions')->insert(array('id'=>11,'gid'=>4,'optionname'=>'operating_system'));
\WHMCS\Database\Capsule::table('tblproductconfigoptions')->insert(array('id'=>12,'gid'=>4,'optionname'=>'other_option'));
\WHMCS\Database\Capsule::table('tblproductconfiglinks')->insert(array('gid'=>4,'pid'=>77));
\WHMCS\Database\Capsule::table('tblproductconfigoptionssub')->insert(array('id'=>101,'configid'=>11,'optionname'=>'debian_12'));
\WHMCS\Database\Capsule::table('tblproductconfigoptionssub')->insert(array('id'=>102,'configid'=>11,'optionname'=>'ubuntu_22'));
$found = $mapper->suggestions(1);
$tests['mapper discovers values from the stored catalog payload'] = count($found)===1&&$found[0]['value_status']==='resolved'&&count($found[0]['values'])===2&&$found[0]['mapping_id']===1;
$tests['mapper suggestions are read-only'] = count(ch247_ovh_rows('mod_cloudhost247_ovh_option_mappings'))===0;
$confirmed = $mapper->confirm(1,3,11,101,9,true);
$mappingRow = ch247_ovh_rows('mod_cloudhost247_ovh_option_mappings')[0];
$tests['mapper confirm stores the exact pair and the derived provenance'] = $confirmed['verified']===true&&(int)$mappingRow->whmcs_option_id===11&&(int)$mappingRow->whmcs_suboption_id===101&&(int)$mappingRow->verified===1;
try { $mapper->confirm(1,3,11,102,9,false); $tests['mapper confirm requires explicit confirmation']=false; } catch (Throwable $e) { $tests['mapper confirm requires explicit confirmation']=true; }
try { $mapper->confirm(1,3,12,101,9,true); $tests['mapper confirm rejects an option that did not match']=false; } catch (Throwable $e) { $tests['mapper confirm rejects an option that did not match']=true; }
try { $mapper->confirm(1,3,11,999,9,true); $tests['mapper confirm rejects a foreign suboption']=false; } catch (Throwable $e) { $tests['mapper confirm rejects a foreign suboption']=true; }
$tests['mapper confirmed() reports the stored mapping'] = count($mapper->confirmed(1))===1&&$mapper->confirmed(1)[0]['whmcs_suboption_name']==='debian_12'&&$mapper->confirmed(1)[0]['verified']===true;

// --- HostingProductManager prefill: reads catalog evidence, writes nothing.
$manager = new \CloudHost247\Ovh\Products\HostingProductManager();
\WHMCS\Database\Capsule::table('mod_cloudhost247_ovh_catalog')->where('id',5)->update(array('catalog_json'=>json_encode(array('normalized'=>array('plan_code'=>'vps-1','cpu'=>'4 cores','ram'=>'8 GB','storage'=>'160 GB','datacenters'=>array('GRA'),'operating_systems'=>array('linux'))))));
$prefill = $manager->specificationPrefill(77);
$tests['prefill reads the mapped plan and marks unproved fields'] = $prefill['status']==='partial'&&$prefill['specifications']['cpu']==='4 cores'&&in_array('ipv4',$prefill['unverified'],true)&&$prefill['plan_code']==='vps-1';
$tests['prefill changes nothing'] = count(ch247_ovh_rows('mod_cloudhost247_hosting_products'))===0;
$noModel = $manager->specificationPrefill(999);
$tests['prefill without a mapping says so'] = $noModel['status']==='no_mapping'&&$noModel['specifications']===array();

// A read-only stand-in for the OVH client: the directory only ever GETs listings
// and one service path, so the double implements exactly that.
class CH247OvhFakeClient
{
    public function get($path)
    {
        if ($path === '/dedicated/server') { return array('ns1.eu', 'ns2.eu'); }
        if ($path === '/vps') { return array('vps-abc.ovh.net'); }
        return array('serviceName' => trim((string) $path, '/'));
    }
}

// --- ExistingServiceLinker: bounded directory, ranked suggestions, confirmed binding.
$linker = new \CloudHost247\Ovh\Reconciliation\ExistingServiceLinker(new \CloudHost247\Ovh\Services\ConnectionResolver(), function ($endpointId) { return new CH247OvhFakeClient(); });
\WHMCS\Database\Capsule::table('tblhosting')->insert(array('id'=>41,'userid'=>7,'packageid'=>3,'domain'=>'vps-abc.ovh.net','dedicatedip'=>'203.0.113.9','domainstatus'=>'Active'));
\WHMCS\Database\Capsule::table('tblhosting')->insert(array('id'=>42,'userid'=>8,'packageid'=>3,'domain'=>'unrelated.example','dedicatedip'=>'','domainstatus'=>'Active'));
\WHMCS\Database\Capsule::table('mod_cloudhost247_ovh_services')->insert(array('id'=>80,'endpoint_id'=>2,'whmcs_service_id'=>41,'family'=>'vps','remote_service_name'=>'ns1.eu','status'=>'active'));
$directory = $linker->directory(2, array('family'=>'all'));
$vpsRow = null;
foreach ($directory['rows'] as $row) { if ($row['remote_service_name']==='vps-abc.ovh.net') { $vpsRow=$row; } }
$linkedRow = null;
foreach ($directory['rows'] as $row) { if ($row['remote_service_name']==='ns1.eu') { $linkedRow=$row; } }
$tests['directory lists both families read-only'] = $directory['total']===3&&$directory['pages']===1&&$directory['truncated']===false;
$tests['directory ranks an exact domain match first'] = $vpsRow!==null&&$vpsRow['suggestions'][0]['whmcs_service_id']===41&&$vpsRow['suggestions'][0]['reasons']===array('exact-domain');
$tests['directory labels existing bindings'] = $linkedRow!==null&&$linkedRow['already_linked']===true&&$linkedRow['linked_whmcs_service_id']===41;
$tests['directory filters by binding state'] = $linker->directory(2, array('link_state'=>'unlinked'))['total']===2&&$linker->directory(2, array('link_state'=>'linked'))['total']===1;
$tests['directory filters by name'] = $linker->directory(2, array('query'=>'vps-abc'))['total']===1;
$tests['directory paginates'] = $linker->directory(2, array('family'=>'dedicated'))['total']===2;
$tests['directory writes nothing'] = count(ch247_ovh_rows('mod_cloudhost247_ovh_audit'))===0;
try { $linker->link(2,'vps-abc.ovh.net','vps',42,false,9); $tests['link needs explicit confirmation']=false; } catch (Throwable $e) { $tests['link needs explicit confirmation']=true; }
try { $linker->link(2,'ns1.eu','dedicated',42,true,9); $tests['link refuses a service bound elsewhere']=false; } catch (Throwable $e) { $tests['link refuses a service bound elsewhere']=true; }
try { $linker->link(2,'vps-abc.ovh.net','vps',41,true,9); $tests['rebinding needs its own confirmation']=false; } catch (Throwable $e) { $tests['rebinding needs its own confirmation']=strpos($e->getMessage(),'Confirm the replacement')!==false; }
$linker->link(2,'vps-abc.ovh.net','vps',42,true,9);
$bound = ch247_ovh_rows('mod_cloudhost247_ovh_services');
$audit = ch247_ovh_rows('mod_cloudhost247_ovh_audit');
$tests['link binds and audits the new identity'] = count($bound)===2&&(int)$bound[1]->whmcs_service_id===42&&(string)$bound[1]->status==='active'&&(string)$audit[count($audit)-1]->action==='service.link';
// Rebinding service 41 from ns1.eu to the free ns2.eu: the exact action an operator
// takes after discovering the wrong remote service was attached.
$linker->link(2,'ns2.eu','dedicated',41,true,9,true);
$relink = ch247_ovh_rows('mod_cloudhost247_ovh_audit');
$rebound = null;
foreach (ch247_ovh_rows('mod_cloudhost247_ovh_services') as $row) { if ((int)$row->id===80) { $rebound=$row; } }
$tests['rebind with confirmation records the previous identity'] = (string)$relink[count($relink)-1]->action==='service.relink'&&strpos((string)$relink[count($relink)-1]->before_json,'ns1.eu')!==false&&(string)$rebound->remote_service_name==='ns2.eu';

// --- Intervention reconciliation: manual binding of a delivered order, with evidence.
\WHMCS\Database\Capsule::table('mod_cloudhost247_ovh_services')->insert(array('id'=>90,'endpoint_id'=>2,'whmcs_service_id'=>43,'family'=>'dedicated','remote_service_name'=>'','remote_order_id'=>'ord-77','status'=>'intervention_required'));
\WHMCS\Database\Capsule::table('mod_cloudhost247_ovh_operations')->insert(array('id'=>1,'whmcs_service_id'=>43,'operation'=>'provision','status'=>'reconciliation_required','remote_id'=>''));
try { $linker->resolveIntervention(90,'ns2.eu','dedicated',false,9); $tests['reconciliation needs confirmation']=false; } catch (Throwable $e) { $tests['reconciliation needs confirmation']=true; }
// ns2.eu is bound to WHMCS service 41 by the rebind above, so it must be refused;
// ns1.eu is free and is the name this delivered order actually produced.
try { $linker->resolveIntervention(90,'ns2.eu','dedicated',true,9); $tests['reconciliation refuses a name another binding owns']=false; } catch (Throwable $e) { $tests['reconciliation refuses a name another binding owns']=true; }
$resolved = $linker->resolveIntervention(90,'ns1.eu','dedicated',true,9);
$reconciled = null;
foreach (ch247_ovh_rows('mod_cloudhost247_ovh_services') as $row) { if ((int)$row->id===90) { $reconciled=$row; } }
$operation = ch247_ovh_rows('mod_cloudhost247_ovh_operations')[0];
$reconcileAudit = ch247_ovh_rows('mod_cloudhost247_ovh_audit');
$tests['reconciliation binds, completes the operation and audits the order'] = (string)$reconciled->status==='active'&&(string)$reconciled->remote_service_name==='ns1.eu'&&(string)$operation->status==='completed'&&(string)$operation->remote_id==='ns1.eu';
$tests['reconciliation audit keeps the order reference'] = (string)$reconcileAudit[count($reconcileAudit)-1]->action==='service.reconcile'&&strpos((string)$reconcileAudit[count($reconcileAudit)-1]->after_json,'ord-77')!==false;

restore_error_handler();
$tests['no php diagnostics raised']=($phpDiagnostics===array());
foreach(array_slice(array_unique($phpDiagnostics),0,5)as$d)echo "# diagnostic: $d\n";

$fail=0;foreach($tests as$n=>$ok){echo($ok?'ok':'not ok')." - $n\n";if(!$ok)$fail++;}exit($fail?1:0);
