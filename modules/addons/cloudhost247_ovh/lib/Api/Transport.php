<?php
namespace CloudHost247\Ovh\Api;
interface Transport{public function send($method,$url,array $headers,$body,$connectTimeout,$timeout,$maxBytes);}
