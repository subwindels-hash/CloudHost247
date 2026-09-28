{* Phone Services service overview *}
<div class="phoneservices-service-overview">

    <div class="row">
        <div class="col-md-6">
            <p>
                <strong>{$LANG.status|default:"Status"}:</strong>
                <span class="label label-{if $status eq 'active'}success{elseif $status eq 'suspended'}warning{else}default{/if}">
                    {$status|escape}
                </span>
            </p>
            {if $planCode}<p><strong>Plan:</strong> {$planCode|escape}</p>{/if}
            {if $nextDueDate}<p><strong>Next due:</strong> {$nextDueDate|escape}</p>{/if}
        </div>
        <div class="col-md-6 text-right">
            <a href="{$portalUrl}" class="btn btn-primary">Open Phone Services portal</a>
        </div>
    </div>

    {if isset($numbers) && $numbers}
        <h3>Your numbers</h3>
        <table class="table table-striped">
            <thead><tr><th>Number</th><th>Country</th><th>Type</th><th>Status</th><th>Renews</th></tr></thead>
            <tbody>
            {foreach $numbers as $number}
                <tr>
                    <td>{$number.number|escape}</td>
                    <td>{$number.country|escape}</td>
                    <td>{$number.type|escape}</td>
                    <td>{$number.status|escape}</td>
                    <td>{$number.next_renewal|default:"—"|escape}</td>
                </tr>
            {/foreach}
            </tbody>
        </table>
    {/if}

    {if isset($esims) && $esims}
        <h3>Your eSIM profiles</h3>
        <table class="table table-striped">
            <thead><tr><th>Plan</th><th>ICCID</th><th>Status</th><th>Data used</th><th>Expires</th></tr></thead>
            <tbody>
            {foreach $esims as $esim}
                <tr>
                    <td>{$esim.friendly_name|default:$esim.plan_id|escape}</td>
                    <td>{$esim.iccid|default:"—"|escape}</td>
                    <td>{$esim.status|escape}</td>
                    <td>{$esim.data_used_mb|escape} MB{if $esim.data_total_mb} / {$esim.data_total_mb|escape} MB{/if}</td>
                    <td>{$esim.expires_at|default:"—"|escape}</td>
                </tr>
            {/foreach}
            </tbody>
        </table>
    {/if}
</div>
