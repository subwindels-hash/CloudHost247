<?php
namespace CloudHost247\Currency\Services;
use CloudHost247\Foundation\Security\AdminGuard; use CloudHost247\Currency\Support\HttpClient;
final class AdminController
{
 private $repo; public function __construct(CurrencyRepository $r){$this->repo=$r;}
 public function handle(){AdminGuard::requireAdmin();$notice='';$error='';try{if(($_SERVER['REQUEST_METHOD']??'GET')==='POST'){AdminGuard::requirePostToken();$op=$_POST['operation']??'';if($op==='settings'){$this->repo->saveSettings($_POST);$notice='Settings saved.';}elseif($op==='currency'){$this->repo->saveCurrency($_POST);$notice='Currency policy saved.';}elseif($op==='provider'){$this->repo->toggleProvider((string)$_POST['provider_key'],!empty($_POST['enabled']));$notice='Provider status saved.';}elseif($op==='update'){$result=(new UpdateEngine($this->repo,new HttpClient()))->run('manual');$notice='Updated '.$result['count'].' currencies in run '.$result['run_id'].'.';}else throw new \InvalidArgumentException('Unknown operation.');}}catch(\Throwable $e){$error=$e->getMessage();}$token=function_exists('generate_token')?generate_token('plain'):'';return array('settings'=>$this->repo->settings(),'currencies'=>$this->repo->currencies(),'providers'=>$this->repo->providers(),'history'=>$this->repo->history(),'rates'=>$this->repo->latestRates(),'comparison'=>$this->repo->comparison(),'notice'=>$notice,'error'=>$error,'token'=>$token);}
}
