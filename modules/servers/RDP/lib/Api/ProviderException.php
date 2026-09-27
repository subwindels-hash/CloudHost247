<?php
namespace CloudHost247\Rdp\Api;
final class ProviderException extends \RuntimeException{private$kind;private$uncertain;public function __construct($kind,$message,$uncertain=false){parent::__construct($message);$this->kind=$kind;$this->uncertain=(bool)$uncertain;}public function kind(){return$this->kind;}public function uncertain(){return$this->uncertain;}}
