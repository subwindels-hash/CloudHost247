<?php
namespace CloudHost247\Ovh\Reconciliation;

final class ProvisioningDecision
{
    public function actionForStatus($status)
    {
        if ($status === null || $status === '' || $status === 'failed') return 'resume';
        if (in_array($status,array('running','remote_mutation','reconciliation_required','success','completed'),true)) return 'stop';
        return 'intervention';
    }
    public function failureStatus($httpStatus)
    {
        return (int)$httpStatus === 0 ? 'reconciliation_required' : 'failed';
    }
}
