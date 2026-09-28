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

restore_error_handler();
$tests['no php diagnostics raised']=($phpDiagnostics===array());
foreach(array_slice(array_unique($phpDiagnostics),0,5)as$d)echo "# diagnostic: $d\n";

$fail=0;foreach($tests as$n=>$ok){echo($ok?'ok':'not ok')." - $n\n";if(!$ok)$fail++;}exit($fail?1:0);
