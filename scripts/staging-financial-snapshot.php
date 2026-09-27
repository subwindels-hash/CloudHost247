<?php
if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }
if (getenv('CH247_STAGING_CONFIRM') !== 'YES') { fwrite(STDERR,"Staging confirmation is required.\n"); exit(2); }
$root=isset($argv[1])?realpath($argv[1]):dirname(__DIR__);if(!$root||!is_file($root.'/init.php')){fwrite(STDERR,"Pass WHMCS root.\n");exit(2);}require $root.'/init.php';
use WHMCS\Database\Capsule;
$definitions=array('tblinvoices'=>array('id','userid','status','total','balance','date','datepaid'),'tblinvoiceitems'=>array('id','invoiceid','userid','type','relid','amount','taxed'),'tblaccounts'=>array('id','userid','invoiceid','amountin','fees','amountout','transid'),'tblpricing'=>array('id','type','currency','relid','monthly','quarterly','semiannually','annually','biennially','triennially'));
$output=array('commit'=>getenv('CH247_BUILD_COMMIT')?:'RECORD_EXACT_COMMIT','utc'=>gmdate('c'),'tables'=>array());
foreach($definitions as$table=>$wanted){if(!Capsule::schema()->hasTable($table)){ $output['tables'][$table]=array('missing'=>true);continue;}$columns=array_values(array_filter($wanted,function($column)use($table){return Capsule::schema()->hasColumn($table,$column);}));$hash=hash_init('sha256');$count=0;Capsule::table($table)->select($columns)->orderBy('id')->chunk(500,function($rows)use(&$count,$hash,$columns){foreach($rows as$row){$record=array();foreach($columns as$column)$record[$column]=$row->{$column};hash_update($hash,json_encode($record,JSON_UNESCAPED_SLASHES)."\n");$count++;}});$output['tables'][$table]=array('rows'=>$count,'columns'=>$columns,'sha256'=>hash_final($hash));}
echo json_encode($output,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES)."\n";
