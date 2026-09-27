<?php
namespace CloudHost247\Foundation\Support;
final class SafeError
{
 public static function from(\Throwable$e,$module,$event,$customerMessage='The requested operation could not be completed safely.'){$id=Logger::correlationId();Logger::write($module,'error',$event,array('correlation_id'=>$id,'exception'=>get_class($e),'error_class'=>get_class($e),'error_code'=>(int)$e->getCode()));return array('message'=>$customerMessage,'correlation_id'=>$id,'display'=>$customerMessage.' Reference: '.$id);}
}
