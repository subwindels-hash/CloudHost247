<?php
if (!defined('WHMCS')) die('Direct access denied');
require_once __DIR__.'/../cloudhost247_core/bootstrap.php';
spl_autoload_register(function($class){$prefix='CloudHost247\\Currency\\';if(strncmp($class,$prefix,strlen($prefix))!==0)return;$file=__DIR__.'/lib/'.str_replace('\\','/',substr($class,strlen($prefix))).'.php';if(is_file($file))require_once $file;});
