{*
 * CloudHost247 SMM — "My SMM Orders" client area page.
 * Data is prepared by ClientAreaService with ownership already enforced;
 * this template only renders the whitelisted fields, escaped.
 *}
<h2>My SMM Orders</h2>
{if $orders}
<div class="table-responsive">
    <table class="table table-striped">
        <thead>
            <tr>
                <th>Service</th>
                <th>Target</th>
                <th>Quantity</th>
                <th>Remaining</th>
                <th>Status</th>
                <th>Updated</th>
            </tr>
        </thead>
        <tbody>
        {foreach from=$orders item=order}
            <tr>
                <td>{$order.service_name|escape:'html':'UTF-8'}</td>
                <td>{$order.target_url|escape:'html':'UTF-8'}</td>
                <td>{$order.quantity|escape:'html':'UTF-8'}</td>
                <td>{if $order.remains !== null}{$order.remains|escape:'html':'UTF-8'}{else}&mdash;{/if}</td>
                <td>{$order.status_label|escape:'html':'UTF-8'}</td>
                <td>{if $order.last_status_at}{$order.last_status_at|escape:'html':'UTF-8'}{else}{$order.created_at|escape:'html':'UTF-8'}{/if}</td>
            </tr>
        {/foreach}
        </tbody>
    </table>
</div>
<p class="text-muted small">Refill and cancellation requests are available on each service's details page when the provider supports them. If something looks wrong, contact support and mention the service you ordered.</p>
{else}
<div class="alert alert-info">
    You have no SMM orders yet. Orders you purchase will appear here with live status.
</div>
{/if}
