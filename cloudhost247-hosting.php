<?php
require __DIR__.'/init.php';require_once __DIR__.'/modules/addons/cloudhost247_ovh/bootstrap.php';
$ca=new WHMCS\ClientArea();$ca->setPageTitle('Cloud Hosting');$ca->addToBreadCrumb('index.php','Home');$ca->addToBreadCrumb('cloudhost247-hosting.php','Hosting');$ca->initPage();
$kind=isset($_GET['type'])?(string)$_GET['type']:'';$currency=isset($_SESSION['currency'])?(int)$_SESSION['currency']:0;try{$products=(new \CloudHost247\Ovh\Products\PublicCatalog())->products($kind,$currency);$error='';}catch(\Throwable$e){$products=array();$safe=\CloudHost247\Foundation\Support\SafeError::from($e,'cloudhost247_ovh','catalog.public','Product information is temporarily unavailable.');$error=$safe['display'];}
$ca->assign('ch247Products',$products);$ca->assign('ch247ProductKind',$kind);$ca->assign('ch247CatalogError',$error);$ca->setTemplate('cloudhost247-product-catalog');$ca->output();
