{*
 * CloudHost247 SMM — client area service details.
 * Shows only customer-meaningful fields; provider API URLs, keys and raw
 * responses never reach this template. All values escaped.
 *}
{if $smmOrder}
<div class="panel panel-default">
    <div class="panel-heading"><h3 class="panel-title">{$smmOrder.service_name|escape:'html':'UTF-8'}</h3></div>
    <div class="panel-body">
        <table class="table table-striped">
            <tr><th>Status</th><td>{$smmOrder.status_label|escape:'html':'UTF-8'}</td></tr>
            <tr><th>Target</th><td>{$smmOrder.target_url|escape:'html':'UTF-8'}</td></tr>
            <tr><th>Quantity</th><td>{$smmOrder.quantity|escape:'html':'UTF-8'}</td></tr>
            {if $smmOrder.start_count !== null}<tr><th>Start count</th><td>{$smmOrder.start_count|escape:'html':'UTF-8'}</td></tr>{/if}
            {if $smmOrder.remains !== null}<tr><th>Remaining</th><td>{$smmOrder.remains|escape:'html':'UTF-8'}</td></tr>{/if}
            <tr><th>Ordered</th><td>{$smmOrder.created_at|escape:'html':'UTF-8'}</td></tr>
            {if $smmOrder.last_status_at}<tr><th>Last updated</th><td>{$smmOrder.last_status_at|escape:'html':'UTF-8'}</td></tr>{/if}
        </table>
        {if $smmOrder.refill_allowed || $smmOrder.cancel_allowed}
            <p class="text-muted small">Use the buttons above to request a refill or a cancellation when available.</p>
        {/if}
    </div>
</div>
{else}
<div class="alert alert-info">
    Your order is being prepared. Status will appear here once processing begins.
</div>
{/if}
