<?php
if(!defined('WHMCS'))die('Direct access denied');require_once __DIR__.'/../cloudhost247_core/bootstrap.php';spl_autoload_register(function($c){$p='CloudHost247\\Ovh\\';if(strncmp($c,$p,strlen($p))!==0)return;$f=__DIR__.'/lib/'.str_replace('\\','/',substr($c,strlen($p))).'.php';if(is_file($f))require_once $f;});
