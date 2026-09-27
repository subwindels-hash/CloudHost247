<?php
namespace CloudHost247\Rdp\Contracts;
interface Ledger{public function operation($key);public function begin(array$operation);public function retry($key);public function finish($key,$status,array$evidence=array(),$errorCode=null);public function binding($serviceId);public function bind(array$binding);public function updateBinding($serviceId,$status,array$details=array());public function recent($serviceId,$limit=25);}
