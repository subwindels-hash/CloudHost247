<?php
namespace CloudHost247\Ovh\Products;

use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Ovh\Normalization\ProductSpecifications;
use WHMCS\Database\Capsule;
use InvalidArgumentException;

final class HostingProductManager
{
    /** The WHMCS product types a created product may carry. `hostingaccount` is
     *  what the vendor OVH automation this module replaces wrote. */
    const PRODUCT_TYPES = array('hostingaccount', 'reselleraccount', 'server', 'other');
    const PAY_TYPES = array('recurring', 'onetime', 'free');
    /** '' means no automatic provisioning, and is the default: a product whose
     *  price and mapping were created moments ago goes live on purpose, not by
     *  accident. */
    const AUTO_SETUP = array('', 'order', 'payment');
    /** The only provisioning module a created product may be pointed at: the one
     *  this repository ships and tests. */
    const SERVER_MODULE = 'cloudhost247_ovh';
    const KINDS = array('hosting', 'vps', 'dedicated');
    const FAMILIES = array('eco', 'vps', 'dedicated');
    const AVAILABILITY = array('available', 'limited', 'unavailable', 'unknown');
    const SPECIFICATION_FIELDS = array('cpu', 'ram', 'storage', 'network', 'ipv4', 'ipv6', 'datacenter', 'operating_system');
    /** WHMCS's own sentinel for a billing cycle that is not offered. The vendor
     *  OVH automation wrote '-1.00' for every cycle it did not price and rewrote a
     *  0 price to '-1.00', so a newly created product has no orderable cycle at
     *  any price - 0.00 would mean free, which is never written here. */
    const CYCLE_DISABLED = '-1.00';
    const PRICING_CYCLES = array('monthly', 'quarterly', 'semiannually', 'annually', 'biennially', 'triennially');
    const PRICING_SETUP_FEES = array('msetupfee', 'qsetupfee', 'ssetupfee', 'asetupfee', 'bsetupfee', 'tsetupfee');
    const MAX_NAME = 191;

    public function listProducts(array $filters=array())
    {
        $query=Capsule::table('tblproducts as p')->leftJoin('tblproductgroups as g','g.id','=','p.gid')->leftJoin('mod_cloudhost247_hosting_products as m','m.whmcs_product_id','=','p.id')->select('p.id','p.name','p.description','p.gid','p.hidden','p.order','p.paytype','g.name as category_name','m.product_kind','m.featured','m.availability_status','m.display_order','m.specifications_json','m.specification_sources_json');
        if(!empty($filters['kind'])&&in_array($filters['kind'],array('hosting','vps','dedicated'),true))$query->where('m.product_kind',$filters['kind']);if(isset($filters['active'])&&$filters['active']!=='')$query->where('p.hidden',$filters['active']==='1'?0:1);if(!empty($filters['availability'])&&in_array($filters['availability'],array('available','limited','unavailable','unknown'),true))$query->where('m.availability_status',$filters['availability']);if(!empty($filters['product_q'])){$term='%'.substr(strip_tags((string)$filters['product_q']),0,100).'%';$query->where(function($q)use($term){$q->where('p.name','like',$term)->orWhere('p.description','like',$term);});}$rows=$query->orderBy('m.display_order')->orderBy('p.order')->get()->all();foreach($rows as$row){$spec=json_decode($row->specifications_json?:'{}',true);$sources=json_decode($row->specification_sources_json?:'{}',true);foreach(array('cpu','ram','storage','network','ipv4','ipv6','datacenter','operating_system')as$key)$row->{$key}=is_array($spec)&&isset($spec[$key])?$spec[$key]:'';$row->specification_sources=is_array($sources)?$sources:array();$row->specification_unverified=array();foreach(array('cpu','ram','storage','network','ipv4','ipv6','datacenter','operating_system')as$key)if($row->{$key}==='')$row->specification_unverified[]=$key;}return$rows;
    }
    /**
     * The specifications the persisted OVH catalog proves for this product's
     * active mapping, plus the fields it does not prove.
     *
     * Read-only: it never writes. The product screen shows the result and the
     * operator saves it through the usual confirmed path, so an auto-fill cannot
     * silently change a live product.
     */
    public function specificationPrefill($productId)
    {
        $mapping = Capsule::table('mod_cloudhost247_ovh_product_mappings')->where('whmcs_product_id', (int) $productId)->where('active', 1)->first();
        if (!$mapping) {
            return array('status' => 'no_mapping', 'reason' => 'No active OVH mapping exists for this product.', 'specifications' => array(), 'unverified' => array(), 'sources' => array(), 'mapping_id' => null, 'plan_code' => '');
        }
        $catalog = Capsule::table('mod_cloudhost247_ovh_catalog')->where('endpoint_id', $mapping->endpoint_id)->where('family', $mapping->family)->where('plan_code', $mapping->plan_code)->first();
        if (!$catalog) {
            return array('status' => 'no_catalog_evidence', 'reason' => 'No persisted catalog evidence exists for this mapping; synchronize the catalog first.', 'specifications' => array(), 'unverified' => array(), 'sources' => array(), 'mapping_id' => (int) $mapping->id, 'plan_code' => (string) $mapping->plan_code);
        }
        $payload = json_decode((string) $catalog->catalog_json, true);
        $normalized = is_array($payload) && isset($payload['normalized']) && is_array($payload['normalized']) ? $payload['normalized'] : (is_array($payload) ? $payload : array());
        $derived = (new \CloudHost247\Ovh\Normalization\ProductSpecifications())->fromPlan($normalized);
        $derived['status'] = count($derived['unverified']) === 0 ? 'complete' : 'partial';
        $derived['reason'] = count($derived['unverified']) === 0
            ? 'Every specification field was proved by the persisted catalog payload.'
            : 'These fields are not present in the persisted catalog payload and are left empty: ' . implode(', ', $derived['unverified']) . '.';
        $derived['mapping_id'] = (int) $mapping->id;
        $derived['plan_code'] = (string) $mapping->plan_code;
        return $derived;
    }

    public function details($productId)
    {
        $product=Capsule::table('tblproducts')->where('id',(int)$productId)->first();if(!$product)throw new InvalidArgumentException('WHMCS product does not exist.');$metadata=Capsule::table('mod_cloudhost247_hosting_products')->where('whmcs_product_id',$product->id)->first();$prices=Capsule::table('tblpricing as p')->join('tblcurrencies as c','c.id','=','p.currency')->where('p.type','product')->where('p.relid',$product->id)->select('p.*','c.code')->get()->all();$mapping=Capsule::table('mod_cloudhost247_ovh_product_mappings')->where('whmcs_product_id',$product->id)->first();$options=Capsule::table('tblproductconfigoptions as o')->join('tblproductconfiglinks as l','l.gid','=','o.gid')->where('l.pid',$product->id)->select('o.id','o.optionname','o.optiontype')->get()->all();return array('product'=>$product,'metadata'=>$metadata,'prices'=>$prices,'mapping'=>$mapping,'options'=>$options);
    }
    public function save(array $input,$confirmed,$adminId)
    {
        if(!$confirmed)throw new InvalidArgumentException('Explicit product-change confirmation is required.');$id=(int)$input['whmcs_product_id'];$before=$this->details($id);$kind=(string)$input['product_kind'];if(!in_array($kind,array('hosting','vps','dedicated'),true))throw new InvalidArgumentException('Invalid hosting product kind.');$name=trim(strip_tags((string)$input['name']));if($name==='')throw new InvalidArgumentException('Product name is required.');$gid=(int)$input['gid'];if(!Capsule::table('tblproductgroups')->where('id',$gid)->exists())throw new InvalidArgumentException('Product category does not exist.');$spec=array();foreach(array('cpu','ram','storage','network','ipv4','ipv6','datacenter','operating_system')as$key)$spec[$key]=trim(strip_tags((string)($input[$key]??'')));$prefill=$this->specificationPrefill($id);$proved=is_array($prefill['sources'])?$prefill['sources']:array();$sources=array();foreach(array_keys($spec)as$key)$sources[$key]=isset($proved[$key])&&$proved[$key]==='catalog'?(!empty($input['spec_prefilled'])?'prefill':'manual'):'not_verified';Capsule::connection()->transaction(function()use($id,$input,$name,$gid,$kind,$spec,$sources){Capsule::table('tblproducts')->where('id',$id)->update(array('name'=>$name,'description'=>(string)$input['description'],'gid'=>$gid,'hidden'=>empty($input['active'])?1:0,'order'=>(int)$input['display_order']));Capsule::table('mod_cloudhost247_hosting_products')->updateOrInsert(array('whmcs_product_id'=>$id),array('product_kind'=>$kind,'featured'=>!empty($input['featured']),'availability_status'=>in_array($input['availability_status'],array('available','limited','unavailable','unknown'),true)?$input['availability_status']:'unknown','display_order'=>(int)$input['display_order'],'specifications_json'=>json_encode($spec),'specification_sources_json'=>json_encode($sources),'updated_at'=>date('Y-m-d H:i:s')));});$after=$this->details($id);AuditLogger::record('cloudhost247_ovh','product.update','product',$id,$this->auditShape($before),$this->auditShape($after),'success',null,$adminId);
    }
    public function linkAddon($productId,$addonId,$ovhKey,$adminId,$confirmed){if(!$confirmed)throw new InvalidArgumentException('Explicit addon-link confirmation is required.');if(!Capsule::table('tblproducts')->where('id',(int)$productId)->exists()||!Capsule::table('tbladdons')->where('id',(int)$addonId)->exists())throw new InvalidArgumentException('Product or addon does not exist.');Capsule::table('mod_cloudhost247_product_addons')->updateOrInsert(array('whmcs_product_id'=>(int)$productId,'whmcs_addon_id'=>(int)$addonId),array('ovh_option_key'=>substr(trim((string)$ovhKey),0,191),'enabled'=>1,'updated_at'=>date('Y-m-d H:i:s')));AuditLogger::record('cloudhost247_ovh','product.addon-link','product',$productId,array(),array('addon_id'=>(int)$addonId,'ovh_option_key'=>$ovhKey),'success',null,$adminId);}
    /**
     * Automatic product creation (inventory row A2) - the one capability the
     * module was missing against the vendor OVH automation it replaces.
     *
     * The vendor automation created products in bulk from the API and wrote
     * prices straight into `tblpricing`. This does the creation half only, and
     * deliberately narrower:
     *
     *  - one plan, one product, one confirmed click - never a bulk import;
     *  - every specification comes from persisted catalog evidence
     *    (`mod_cloudhost247_ovh_catalog`) through the same `ProductSpecifications`
     *    reader the prefill uses; a field the payload does not prove stays empty
     *    and is named in `unverified`, never inferred from the plan code or name;
     *  - the product is created **hidden** and every billing cycle is written as
     *    `CYCLE_DISABLED`, so it cannot be ordered at any price, including zero;
     *  - no price is invented. Pricing stays with the existing preview plus
     *    confirmed `price_apply` flow, which now finds the `tblpricing` rows it
     *    requires instead of refusing because they do not exist;
     *  - the OVH mapping is created **inactive**, because an active mapping is
     *    what the provisioning path acts on; activating it is the operator's
     *    separate, visible decision;
     *  - `servertype` may only be empty or this repository's own server module,
     *    and `autosetup` defaults to no automatic provisioning;
     *  - one transaction for all four writes: either the product, its metadata,
     *    its mapping and its disabled pricing rows all exist, or none of them do.
     *
     * Read-only companion: `previewCreate()` resolves exactly the same plan and
     * writes nothing, so the operator sees every value and every unproved field
     * before confirming.
     */
    public function previewCreate(array $input)
    {
        $plan = $this->resolveCreation($input);
        return array(
            'status' => 'preview',
            'reason' => $plan['reason'],
            'product' => $plan['product'],
            'metadata' => $plan['metadata'],
            'mapping' => $plan['mapping'],
            'pricing' => $plan['pricing'],
            'currencies' => count($plan['currency_ids']),
            'specifications' => $plan['specifications'],
            'unverified' => $plan['unverified'],
            'sources' => $plan['sources'],
            'created_hidden' => true,
            'orderable_cycles' => 0,
            'mapping_active' => false,
        );
    }

    public function create(array $input, $confirmed, $adminId)
    {
        if (!$confirmed) {
            throw new InvalidArgumentException('Explicit product-creation confirmation is required.');
        }
        $plan = $this->resolveCreation($input);
        $productId = Capsule::connection()->transaction(function () use ($plan) {
            // Re-checked inside the write: another request may have mapped this
            // plan or taken this name between the preview and the confirmation.
            $this->assertPlanUnmapped($plan['mapping']);
            $this->assertNameAvailable($plan['product']['name'], $plan['product']['gid']);
            $id = Capsule::table('tblproducts')->insertGetId($plan['product']);
            Capsule::table('mod_cloudhost247_hosting_products')->insert(array_merge(array('whmcs_product_id' => $id), $plan['metadata']));
            Capsule::table('mod_cloudhost247_ovh_product_mappings')->insert(array_merge(array('whmcs_product_id' => $id), $plan['mapping']));
            foreach ($plan['currency_ids'] as $currencyId) {
                $exists = Capsule::table('tblpricing')->where('type', 'product')->where('relid', $id)->where('currency', $currencyId)->exists();
                // A price that already exists is never overwritten by creation.
                if (!$exists) {
                    Capsule::table('tblpricing')->insert(array_merge(array('type' => 'product', 'relid' => $id, 'currency' => $currencyId), $plan['pricing']));
                }
            }
            return $id;
        });
        $after = $this->details($productId);
        AuditLogger::record('cloudhost247_ovh', 'product.create', 'product', $productId, array(), $this->auditShape($after), 'success', null, $adminId);
        return $productId;
    }

    /**
     * Validates the request and resolves the exact rows `create()` would write.
     * Shared with `previewCreate()` so a preview can never promise something the
     * write then refuses for a different reason.
     */
    private function resolveCreation(array $input)
    {
        $endpointId = (int) ($input['endpoint_id'] ?? 0);
        if ($endpointId <= 0 || !Capsule::table('mod_cloudhost247_ovh_endpoints')->where('id', $endpointId)->exists()) {
            throw new InvalidArgumentException('Endpoint does not exist.');
        }
        $family = (string) ($input['family'] ?? '');
        if (!in_array($family, self::FAMILIES, true)) {
            throw new InvalidArgumentException('Invalid OVH family: expected one of ' . implode(', ', self::FAMILIES) . '.');
        }
        $planCode = trim((string) ($input['plan_code'] ?? ''));
        if (!preg_match('/^[A-Za-z0-9._-]{2,191}$/', $planCode)) {
            throw new InvalidArgumentException('Invalid OVH plan code.');
        }
        $subsidiary = strtoupper(trim((string) ($input['subsidiary'] ?? '')));
        if (!preg_match('/^[A-Z]{2,8}$/', $subsidiary)) {
            throw new InvalidArgumentException('Invalid OVH subsidiary.');
        }
        $gid = (int) ($input['gid'] ?? 0);
        if (!Capsule::table('tblproductgroups')->where('id', $gid)->exists()) {
            throw new InvalidArgumentException('Product category does not exist.');
        }
        $name = trim(strip_tags((string) ($input['name'] ?? '')));
        if ($name === '') {
            throw new InvalidArgumentException('Product name is required.');
        }
        if (strlen($name) > self::MAX_NAME) {
            throw new InvalidArgumentException('Product name must be ' . self::MAX_NAME . ' characters or fewer.');
        }
        $kind = (string) ($input['product_kind'] ?? '');
        if (!in_array($kind, self::KINDS, true)) {
            throw new InvalidArgumentException('Invalid hosting product kind.');
        }
        $type = (string) ($input['type'] ?? 'hostingaccount');
        if (!in_array($type, self::PRODUCT_TYPES, true)) {
            throw new InvalidArgumentException('Invalid WHMCS product type: expected one of ' . implode(', ', self::PRODUCT_TYPES) . '.');
        }
        $paytype = (string) ($input['paytype'] ?? 'recurring');
        if (!in_array($paytype, self::PAY_TYPES, true)) {
            throw new InvalidArgumentException('Invalid WHMCS payment type: expected one of ' . implode(', ', self::PAY_TYPES) . '.');
        }
        $autosetup = (string) ($input['autosetup'] ?? '');
        if (!in_array($autosetup, self::AUTO_SETUP, true)) {
            throw new InvalidArgumentException('Invalid automatic-setup value: expected empty, order or payment.');
        }
        $servertype = (string) ($input['servertype'] ?? self::SERVER_MODULE);
        if ($servertype !== '' && $servertype !== self::SERVER_MODULE) {
            throw new InvalidArgumentException('A created product may be pointed at no provisioning module or at ' . self::SERVER_MODULE . ' only; another module is not verified by this repository.');
        }
        $availability = (string) ($input['availability_status'] ?? 'unknown');
        if (!in_array($availability, self::AVAILABILITY, true)) {
            $availability = 'unknown';
        }
        $order = (int) ($input['display_order'] ?? 0);
        $margin = (float) ($input['margin_percent'] ?? 0);

        $catalog = Capsule::table('mod_cloudhost247_ovh_catalog')
            ->where('endpoint_id', $endpointId)->where('family', $family)->where('plan_code', $planCode)->first();
        if (!$catalog) {
            throw new InvalidArgumentException('No persisted catalog evidence exists for ' . $family . '/' . $planCode . ' on endpoint #' . $endpointId . '; synchronize the catalog first. A product is never created from an invented specification.');
        }
        $payload = json_decode((string) $catalog->catalog_json, true);
        $normalized = is_array($payload) && isset($payload['normalized']) && is_array($payload['normalized'])
            ? $payload['normalized']
            : (is_array($payload) ? $payload : array());
        $derived = (new ProductSpecifications())->fromPlan($normalized);

        $mapping = array(
            'endpoint_id' => $endpointId,
            'family' => $family,
            'plan_code' => $planCode,
            'subsidiary' => $subsidiary,
            'configuration_json' => '{}',
            'active' => false,
            'margin_percent' => $margin,
            'updated_at' => date('Y-m-d H:i:s'),
        );
        $this->assertPlanUnmapped($mapping);
        $this->assertNameAvailable($name, $gid);

        $pricing = array();
        foreach (self::PRICING_SETUP_FEES as $column) { $pricing[$column] = self::CYCLE_DISABLED; }
        foreach (self::PRICING_CYCLES as $column) { $pricing[$column] = self::CYCLE_DISABLED; }
        $currencyIds = array();
        foreach (Capsule::table('tblcurrencies')->select('id')->get()->all() as $currency) { $currencyIds[] = (int) $currency->id; }

        return array(
            'product' => array(
                'type' => $type,
                'gid' => $gid,
                'name' => $name,
                'description' => (string) ($input['description'] ?? ''),
                'paytype' => $paytype,
                // Created hidden: WHMCS's equivalent of the disabled template the
                // Node platform creates. Unhiding is a separate, deliberate act.
                'hidden' => 1,
                'order' => $order,
                'autosetup' => $autosetup,
                'servertype' => $servertype,
            ),
            'metadata' => array(
                'product_kind' => $kind,
                'featured' => !empty($input['featured']),
                'availability_status' => $availability,
                'display_order' => $order,
                'specifications_json' => json_encode($derived['specifications']),
                'specification_sources_json' => json_encode($derived['sources']),
                'updated_at' => date('Y-m-d H:i:s'),
            ),
            'mapping' => $mapping,
            'pricing' => $pricing,
            'currency_ids' => $currencyIds,
            'specifications' => $derived['specifications'],
            'unverified' => $derived['unverified'],
            'sources' => $derived['sources'],
            'reason' => count($derived['unverified']) === 0
                ? 'Every specification field was proved by the persisted catalog payload.'
                : 'These fields are not present in the persisted catalog payload and stay empty: ' . implode(', ', $derived['unverified']) . '.',
        );
    }

    /** One OVH plan maps to one WHMCS product; the mapping table is unique on the
     *  product, so this guard is what stops two products claiming the same plan. */
    private function assertPlanUnmapped(array $mapping)
    {
        $existing = Capsule::table('mod_cloudhost247_ovh_product_mappings')
            ->where('endpoint_id', $mapping['endpoint_id'])
            ->where('family', $mapping['family'])
            ->where('plan_code', $mapping['plan_code'])->first();
        if ($existing) {
            throw new InvalidArgumentException('OVH plan ' . $mapping['family'] . '/' . $mapping['plan_code'] . ' is already mapped to WHMCS product #' . $existing->whmcs_product_id . '. Edit that product instead of creating a second one for the same plan.');
        }
    }

    private function assertNameAvailable($name, $gid)
    {
        $existing = Capsule::table('tblproducts')->where('gid', (int) $gid)->where('name', $name)->first();
        if ($existing) {
            throw new InvalidArgumentException('A product named "' . $name . '" already exists in this category (#' . $existing->id . '). Rename it or choose another category: two identical products are indistinguishable to customers.');
        }
    }

    private function auditShape(array$data){$p=$data['product'];$m=$data['metadata'];return array('name'=>$p->name,'gid'=>$p->gid,'hidden'=>$p->hidden,'order'=>$p->order,'product_kind'=>$m?$m->product_kind:null,'featured'=>$m?$m->featured:null,'availability'=>$m?$m->availability_status:null);}
}
