<?php
if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }
if (getenv('CH247_STAGING_CONFIRM') !== 'YES') { fwrite(STDERR,"Set CH247_STAGING_CONFIRM=YES only after independently proving this is non-production.\n"); exit(2); }
$root = isset($argv[1]) ? realpath($argv[1]) : dirname(__DIR__);
if (!$root || !is_file($root . '/init.php')) { fwrite(STDERR,"Pass the WHMCS staging document root.\n"); exit(2); }
require $root . '/init.php';
use WHMCS\Database\Capsule;
$extensions=array('curl','json','openssl','pdo_mysql','mbstring','dom','fileinfo','filter');$ext=array();foreach($extensions as$name)$ext[$name]=extension_loaded($name);
$requiredTables=array('mod_cloudhost247_migrations','mod_cloudhost247_logs','mod_cloudhost247_theme_content','mod_cloudhost247_currency_runs','mod_cloudhost247_ovh_operations');$tables=array();foreach($requiredTables as$table)$tables[$table]=Capsule::schema()->hasTable($table);
$result=array('staging_confirmation'=>'operator-confirmed','system_url'=>(string)Capsule::table('tblconfiguration')->where('setting','SystemURL')->value('value'),'whmcs_version'=>(string)Capsule::table('tblconfiguration')->where('setting','Version')->value('value'),'php_version'=>PHP_VERSION,'database_version'=>(string)Capsule::selectOne('select version() as version')->version,'extensions'=>$ext,'tables'=>$tables,'commit'=>getenv('CH247_BUILD_COMMIT')?:'RECORD_EXACT_COMMIT','utc'=>gmdate('c'));
echo json_encode($result,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES)."\n";
exit(in_array(false,$ext,true)||in_array(false,$tables,true)?1:0);
