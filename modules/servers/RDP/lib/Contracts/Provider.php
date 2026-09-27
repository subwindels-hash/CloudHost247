<?php
namespace CloudHost247\Rdp\Contracts;
interface Provider{public function create(array$request,$idempotencyKey);public function suspend($serviceRef,$idempotencyKey);public function unsuspend($serviceRef,$idempotencyKey);public function terminate($serviceRef,$idempotencyKey);public function service($serviceRef);public function test();}
