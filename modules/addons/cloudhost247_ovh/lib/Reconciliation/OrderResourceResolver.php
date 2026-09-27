<?php
namespace CloudHost247\Ovh\Reconciliation;

final class OrderResourceResolver
{
    public function resolve(array $details)
    {
        $values=array();
        foreach($details as$detail)foreach(array('domain','serviceName','serviceId')as$key)if(isset($detail[$key])&&is_string($detail[$key])&&preg_match('/^[A-Za-z0-9._:-]{2,191}$/',$detail[$key]))$values[]=$detail[$key];
        $values=array_values(array_unique($values));
        return count($values)===1?array('status'=>'resolved','service_name'=>$values[0]):array('status'=>count($values)>1?'ambiguous':'missing','candidates'=>$values);
    }
}
