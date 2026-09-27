<?php
namespace CloudHost247\Currency\Contracts;
interface RateProvider { public function key(); public function fetch($baseCurrency, array $symbols); }
