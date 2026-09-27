<?php
namespace CloudHost247\Ovh\Api;
class ApiException extends \RuntimeException {private $status,$retryAfter;public function __construct($message,$status=0,$retryAfter=0){parent::__construct($message);$this->status=(int)$status;$this->retryAfter=(int)$retryAfter;}public function status(){return$this->status;}public function retryAfter(){return$this->retryAfter;}}
