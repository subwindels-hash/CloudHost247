<?php
require_once __DIR__.'/../../addons/cloudhost247_core/bootstrap.php';require_once __DIR__.'/migrations/V100.php';
spl_autoload_register(function($class){$prefix='CloudHost247\\Rdp\\';if(strpos($class,$prefix)!==0)return;$path=__DIR__.'/lib/'.str_replace('\\','/',substr($class,strlen($prefix))).'.php';if(is_file($path))require_once$path;});
