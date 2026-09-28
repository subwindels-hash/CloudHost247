<?php
namespace CloudHost247\Ovh\Services;

use CloudHost247\Foundation\Security\AdminGuard;
use CloudHost247\Ovh\Api\Endpoint;
use CloudHost247\Ovh\Catalog\CatalogService;
use CloudHost247\Ovh\Pricing\PriceCalculator;
use CloudHost247\Ovh\Pricing\PricingService;
use CloudHost247\Ovh\Reconciliation\ExistingServiceLinker;
use CloudHost247\Ovh\Reconciliation\OrderPoller;
use WHMCS\Database\Capsule;
use InvalidArgumentException;

final class AdminController
{
    public function handle()
    {
        AdminGuard::requireAdmin(); $notice=''; $error=''; $search=array(); $preview=null;
        try {
            if (($_SERVER['REQUEST_METHOD']??'GET')==='POST') {
                AdminGuard::requirePostToken(); $op=$_POST['operation']??'';
                $capability = in_array($op,array('price_apply','link_confirm','option_confirm','product_save','addon_link'),true) ? 'changes.apply' : (in_array($op,array('endpoint','mapping'),true) ? 'settings.manage' : 'operations.run');
                AdminGuard::requireCapability('cloudhost247_ovh',$capability); $resolver=new ConnectionResolver();
                if ($op==='endpoint') { $this->saveEndpoint($_POST); $notice='Endpoint configuration saved.'; }
                elseif ($op==='mapping') { (new MappingRepository())->save($_POST); $notice='Product mapping saved.'; }
                elseif ($op==='test') { $resolver->endpoint((int)$_POST['endpoint_id'])->get('/me'); $notice='OVH authentication and /me permission succeeded.'; }
                elseif ($op==='catalog') { $notice='Catalog synchronized: '.(new CatalogService($resolver))->sync((int)$_POST['endpoint_id'],$_POST['subsidiary'],$_POST['family']).' plans.'; }
                elseif ($op==='services') { $notice='Service synchronization: '.json_encode((new Synchronizer($resolver))->services((int)$_POST['endpoint_id'])); }
                elseif ($op==='poll') { $notice='Order polling: '.json_encode((new OrderPoller($resolver))->pollPending()); }
                elseif ($op==='search') { $search=(new ExistingServiceLinker($resolver))->search((int)$_POST['endpoint_id'],trim((string)$_POST['query'])); $notice='Search returned '.count($search).' services; no links were changed.'; }
                elseif ($op==='link_preview') { $preview=(new ExistingServiceLinker($resolver))->preview((int)$_POST['endpoint_id'],$_POST['remote_service_name'],$_POST['family'],(int)$_POST['whmcs_service_id']); }
                elseif ($op==='link_confirm') { (new ExistingServiceLinker($resolver))->link((int)$_POST['endpoint_id'],$_POST['remote_service_name'],$_POST['family'],(int)$_POST['whmcs_service_id'],!empty($_POST['confirm']),$_SESSION['adminid']); $notice='Existing service linked after explicit confirmation.'; }
                elseif ($op==='option_suggest') { $preview=(new \CloudHost247\Ovh\Catalog\ConfigurableOptionMapper())->suggestions((int)$_POST['mapping_id']); }
                elseif ($op==='option_confirm') { (new \CloudHost247\Ovh\Catalog\ConfigurableOptionMapper())->confirm((int)$_POST['mapping_id'],(int)$_POST['ovh_option_id'],(int)$_POST['whmcs_option_id'],(int)($_POST['whmcs_suboption_id']??0),$_SESSION['adminid'],!empty($_POST['confirm'])); $notice='Exact configurable-option mapping confirmed.'; }
                elseif ($op==='product_save') { (new \CloudHost247\Ovh\Products\HostingProductManager())->save($_POST,!empty($_POST['confirm']),$_SESSION['adminid']); $notice='Product metadata and explicitly selected WHMCS fields saved.'; }
                elseif ($op==='addon_link') { (new \CloudHost247\Ovh\Products\HostingProductManager())->linkAddon((int)$_POST['whmcs_product_id'],(int)$_POST['whmcs_addon_id'],$_POST['ovh_option_key']??'',$_SESSION['adminid'],!empty($_POST['confirm'])); $notice='Product addon relationship saved.'; }
                elseif ($op==='price_source') { $mapping=Capsule::table('mod_cloudhost247_ovh_product_mappings')->where('id',(int)$_POST['mapping_id'])->first();if(!$mapping)throw new InvalidArgumentException('Mapping is unavailable.');$catalog=Capsule::table('mod_cloudhost247_ovh_catalog')->where('endpoint_id',$mapping->endpoint_id)->where('family',$mapping->family)->where('plan_code',$mapping->plan_code)->first();if(!$catalog)throw new InvalidArgumentException('No persisted OVH catalog evidence exists for this mapping.');$payload=json_decode($catalog->catalog_json,true);$preview=(new \CloudHost247\Ovh\Pricing\SourcePriceExtractor())->extract(is_array($payload)?$payload:array(),$_POST['duration']??null);if($preview['status']!=='resolved')throw new InvalidArgumentException('Persisted source price is missing or ambiguous; no price was guessed.');$notice='Verified one unambiguous persisted source-price candidate.'; }
                elseif ($op==='price_preview') { $preview=(new PricingService(new PriceCalculator()))->preview((int)$_POST['mapping_id'],(int)$_POST['currency_id'],$_POST['billing_cycle'],(float)$_POST['source_price'],$_POST['source_currency'],$_POST['rounding_mode'],(int)$_POST['precision'],$_POST['price_component']??'recurring'); }
                elseif ($op==='price_apply') { $notice='Applied final product price '.$this->pricing()->apply((int)$_POST['preview_id'],!empty($_POST['confirm'])).'. Historical invoices were not changed.'; }
                else throw new InvalidArgumentException('Unknown operation.');
            }
        } catch (\Throwable $e) { $error=$e->getMessage(); }
        return array('notice'=>$notice,'error'=>$error,'search'=>$search,'preview'=>$preview,'token'=>function_exists('generate_token')?generate_token('plain'):'','endpoints'=>Capsule::table('mod_cloudhost247_ovh_endpoints')->get()->all(),'servers'=>Capsule::table('tblservers')->select('id','name','type')->get()->all(),'products'=>Capsule::table('tblproducts')->select('id','name')->orderBy('name')->get()->all(),'hosting'=>Capsule::table('tblhosting')->select('id','userid','packageid','domain','domainstatus')->orderBy('id','desc')->limit(500)->get()->all(),'currencies'=>Capsule::table('tblcurrencies')->get()->all(),'mappings'=>Capsule::table('mod_cloudhost247_ovh_product_mappings')->get()->all(),'operations'=>Capsule::table('mod_cloudhost247_ovh_operations')->orderBy('id','desc')->limit(50)->get()->all(),'syncs'=>Capsule::table('mod_cloudhost247_ovh_sync_runs')->orderBy('id','desc')->limit(30)->get()->all(),'price_previews'=>Capsule::table('mod_cloudhost247_ovh_price_previews')->orderBy('id','desc')->limit(30)->get()->all(),'managed_products'=>(new \CloudHost247\Ovh\Products\HostingProductManager())->listProducts($_GET),'product_groups'=>Capsule::table('tblproductgroups')->select('id','name')->orderBy('order')->get()->all(),'addons'=>Capsule::table('tbladdons')->select('id','name')->orderBy('name')->get()->all(),'product_addons'=>Capsule::table('mod_cloudhost247_product_addons')->get()->all(),'product_audits'=>Capsule::table('mod_cloudhost247_audit_events')->where('module','cloudhost247_ovh')->where('resource_type','product')->orderBy('id','desc')->limit(100)->get()->all(),'dashboard'=>(new \CloudHost247\Ovh\Operations\OperationsDashboard())->summary($_GET));
    }
    private function pricing() { return new PricingService(new PriceCalculator()); }
    private function saveEndpoint($i) { $region=strtolower($i['region']??''); if(!in_array($region,array('eu','ca','us'),true))throw new InvalidArgumentException('Invalid region.');$central=!empty($i['integration_key']);$sid=(int)($i['server_id']??0);if(!$central&&!Capsule::table('tblservers')->where('id',$sid)->exists())throw new InvalidArgumentException('Select a WHMCS server or the central OVH integration.');$row=array('region'=>$region,'api_endpoint'=>Endpoint::forRegion($region),'server_id'=>$sid?:null,'enabled'=>!empty($i['enabled']),'updated_at'=>date('Y-m-d H:i:s'));if(Capsule::schema()->hasColumn('mod_cloudhost247_ovh_endpoints','integration_key')){$row['integration_key']=$central?'ovh':null;$row['integration_environment']=null;}Capsule::table('mod_cloudhost247_ovh_endpoints')->updateOrInsert(array('name'=>trim($i['name'])),$row); }
}
