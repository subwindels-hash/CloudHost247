<?php
use WHMCS\ClientArea;
use WHMCS\Database\Capsule;
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new ClientArea();
$ca->setPageTitle('Vps Private Cloud');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('vpsprivatecloud.php', 'Vps Private Cloud');
$ca->initPage();
$pageName = basename($_SERVER['PHP_SELF']);
$pageData = Capsule::table("mod_hostx_pages")->where('pageTitle',$pageName)->first();
$getLocalLang = Capsule::table('tblconfiguration')->where('setting','Language')->first();
$gid = $pageData->productGroup;
function get_currency(){
    $clientCurrency = '';
    if (isset($_SESSION['uid']) && !empty($_SESSION['uid'])) {
        $clientCurrency = Capsule::table('tblclients')->select('currency')->where('id', $_SESSION['uid'])->get();
    }
    if (isset($clientCurrency) && !empty($clientCurrency) && $clientCurrency[0]->currency != '0') {
        $currency = Capsule::table('tblcurrencies')->where('id', $clientCurrency[0]->currency)->first();
    } else if (isset($_SESSION['currency']) && !empty($_SESSION['currency'])) {
        $currency = Capsule::table('tblcurrencies')->where('id', $_SESSION['currency'])->first();
    } else {
        $currency = Capsule::table('tblcurrencies')->where('default', '1')->first();
    }
    return $currency;
}
function wgs_fetch_product_detail_according_to_language_hostx($language,$relid,$for){
	if($for == 'pname'){
		$dataReturn = Capsule::table('tbldynamic_translations')->where('related_type','product.{id}.name')->where('related_id',$relid)->where('language',$language)->first();
	}else if($for == 'pdescp'){
		$dataReturn = Capsule::table('tbldynamic_translations')->where('related_type','product.{id}.description')->where('related_id',$relid)->where('language',$language)->first();			
	}else if($for == 'pgroupname'){
		$dataReturn = Capsule::table('tbldynamic_translations')->where('related_type','product_group.{id}.name')->where('related_id',$relid)->where('language',$language)->first();			
	}
	return $dataReturn;
}
function wgs_get_dynmic_translation_page($related_type,$related_id,$language){
	return Capsule::table('mod_hostx_dynmic_translation')->where('related_type',$related_type)->where('related_id',$related_id)->where('language',$language)->first();
}
function wgs_pricing_format_data($priceProduct,$currencyId){
	$currencySettingGet = Capsule::table('mod_hostx_setting')->where('setting','currency_setting')->first();
	$currencySettingGetCount = Capsule::table('mod_hostx_setting')->where('setting','currency_setting')->count();
	if($currencySettingGetCount > 0){
		if($currencySettingGet->value == 'prefix'){
			return formatCurrency($priceProduct,$currencyId)->toPrefixed();
		}elseif($currencySettingGet->value == 'suffix'){
			return formatCurrency($priceProduct,$currencyId)->toSuffixed();
		}elseif($currencySettingGet->value == 'both'){
			return formatCurrency($priceProduct,$currencyId)->toFull();
		}
	}else{
		return formatCurrency($priceProduct,$currencyId)->toPrefixed();
	}
}
if(!empty($gid)){
	global $_LANG;
    $command = 'GetProducts';
    $postData = array('gid' => $gid);
    $adminUsername = ''; // Optional for WHMCS 7.2 and later
    $results = localAPI($command, $postData, $adminUsername);
    $currency = get_currency();
    $currenciCode = $currency->code;
	$checkForTranslationGroup = Capsule::table('tblconfiguration')->where('setting','EnableTranslations')->first();
	$languageVars = $_LANG;
    $productsData = [];
	$arrayCycles = [];
    foreach($results['products']['product'] as $pData){
    	$chkHidden = Capsule::table('tblproducts')->where('id', $pData['pid'])->where('hidden', 'on')->count();    
    	if($chkHidden!='0'){
			$dataPrices = $pData['pricing'][$currenciCode];
			$pData['pricing'] = $pData['pricing'][$currenciCode];
			if($pData['paytype'] == 'onetime'){
				$pData['pricing']['monthly'] = wgs_pricing_format_data($pData['pricing']['monthly'],$currency->id);
			}elseif($pData['paytype'] == 'free'){
				$pData['pricing']['free'] = wgs_pricing_format_data(0,$currency->id);
			}elseif($pData['paytype'] == 'recurring'){
				$pData['pricing']['monthly'] = wgs_pricing_format_data($pData['pricing']['monthly'],$currency->id);
				$pData['pricing']['quarterly'] = wgs_pricing_format_data($pData['pricing']['quarterly'],$currency->id);
				$pData['pricing']['semiannually'] = wgs_pricing_format_data($pData['pricing']['semiannually'],$currency->id);
				$pData['pricing']['annually'] = wgs_pricing_format_data($pData['pricing']['annually'],$currency->id);
				$pData['pricing']['biennially'] = wgs_pricing_format_data($pData['pricing']['biennially'],$currency->id);
				$pData['pricing']['triennially'] = wgs_pricing_format_data($pData['pricing']['triennially'],$currency->id);
			}
            $pDesc = Capsule::table('mod_hostx_page_products')->select('pHeadSortDesc','pDescription','pFootCaption','pFootSortDesc')->where('productId', $pData['pid'])->where('pageId', $pageData->id)->first();
			if($checkForTranslationGroup->value == 1){
				if(isset($_SESSION['Language'])){
					$getPname = wgs_fetch_product_detail_according_to_language_hostx($_SESSION['Language'],$pData['pid'],'pname');
					$getPdescp = wgs_fetch_product_detail_according_to_language_hostx($_SESSION['Language'],$pData['pid'],'pdescp');
					$productName = ($getPname->translation != '' ? $getPname->translation : $pData['name']);
					if($getLocalLang->value != $_SESSION['Language']){
						$productDescp = ($getPdescp->translation != '' ? $getPdescp->translation : $pData['description']);
					}else{
						$productDescp = $pData['description'];
					}
				}else{
					$productName = $pData['name'];
					$productDescp = $pData['description'];
				}
				$pData['name'] = $productName;
				$pDesc->pDescription = $productDescp;
			}
			if(isset($_SESSION['Language'])){
				$pHeadSortCol = 'pHeadSortDesc-'.$pData['pid'].'-'.$pageData->id;
				$headSortDesc = wgs_get_dynmic_translation_page('vpspage.{id}.pHeadSortDesc',$pHeadSortCol,$_SESSION['Language']);
				if($headSortDesc->value != ''){
					$pDesc->pHeadSortDesc = $headSortDesc->value;
				}
				$pFootSortCol = 'pFootSortDesc-'.$pData['pid'].'-'.$pageData->id;
				$footSortDesc = wgs_get_dynmic_translation_page('vpspage.{id}.pFootSortDesc',$pFootSortCol,$_SESSION['Language']);
				if($footSortDesc->value != ''){
					$pDesc->pFootSortDesc = $footSortDesc->value;
				}
				$pFootCaptionCol = 'pFootCaption-'.$pData['pid'].'-'.$pageData->id;
				$footSortCaptio = wgs_get_dynmic_translation_page('vpspage.{id}.pFootCaption',$pFootCaptionCol,$_SESSION['Language']);
				if($footSortCaptio->value != ''){
					$pDesc->pFootCaption = $footSortCaptio->value;
				}
			}
            if(!empty($pDesc)){
                $pDesc = (array) $pDesc;
            }else{            
                require_once __DIR__ . '/modules/addons/hostx/defaultmenu.php';
                $pDesc = $defaultPData;
            }
			$pDesc['pHeadSortDesc'] = html_entity_decode($pDesc['pHeadSortDesc']);
            $pDesc['pDescription'] = html_entity_decode($pDesc['pDescription']);
			$pDesc['pFootCaption'] = html_entity_decode($pDesc['pFootCaption']);
			$pDesc['pFootSortDesc'] = html_entity_decode($pDesc['pFootSortDesc']);
            $pData['customDescription'] = $pDesc;           
    		$productsData[] = $pData;
			if($pData['paytype'] == 'onetime'){
				$arrayCycles['onetime'] = 'onetime';
			}elseif($pData['paytype'] == 'free'){
				$arrayCycles['free'] = 'free';
			}elseif($pData['paytype'] == 'recurring'){
				if($dataPrices['monthly'] >= 0 ){
					$arrayCycles['monthly'] = 'monthly';
				}
				if($dataPrices['quarterly'] >= 0 ){
					$arrayCycles['quarterly'] = 'quarterly';
				}
				if($dataPrices['semiannually'] >= 0 ){
					$arrayCycles['semiannually'] = 'semiannually';
				}
				if($dataPrices['annually'] >= 0 ){
					$arrayCycles['annually'] = 'annually';
				}
				if($dataPrices['biennially'] >= 0 ){
					$arrayCycles['biennially'] = 'biennially';
				}
				if($dataPrices['triennially'] >= 0 ){
					$arrayCycles['triennially'] = 'triennially';
				}
			}
    	}	
    }
}
$ca->assign('productsDataCycles', $arrayCycles);
$ca->assign('productsData', $productsData);
$ca->assign('productsDataCount', count((array)$productsData));
$ca->assign('sidebarHostxRemove', 'true');
$ca->setTemplate('hostx');
$ca->output();