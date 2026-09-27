<?php
if (PHP_SAPI!=='cli') { http_response_code(403); exit('CLI only'); }
$root=dirname(__DIR__);require $root.'/init.php';require_once $root.'/modules/addons/cloudhost247_currency/bootstrap.php';
try{$repo=new \CloudHost247\Currency\Services\CurrencyRepository();$result=(new \CloudHost247\Currency\Services\UpdateEngine($repo,new \CloudHost247\Currency\Support\HttpClient()))->run('cli');fwrite(STDOUT,'Currency update completed: '.json_encode($result).PHP_EOL);exit(0);}catch(\Throwable $e){fwrite(STDERR,'Currency update failed: '.$e->getMessage().PHP_EOL);exit(1);}
