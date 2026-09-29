{*
 * CloudHost247 Domain Brokerage — "My Domain Brokerage Cases" list.
 * Data is prepared by ClientAreaController with ownership already enforced.
 *}
<h2>My Domain Brokerage Cases</h2>
{if $notice}<div class="alert alert-success">{$notice|escape:'html':'UTF-8'}</div>{/if}
{if $error}<div class="alert alert-danger">{$error|escape:'html':'UTF-8'}</div>{/if}
{if !$brokerage_enabled}
<div class="alert alert-warning">Domain brokerage requests are not currently being accepted. Please check back later or contact support.</div>
{/if}
<p><a class="btn btn-primary" href="index.php?m=cloudhost247_broker&amp;a=new">Request a domain broker</a></p>
{if $results.rows}
<div class="table-responsive">
<table class="table table-striped">
<thead><tr><th>Case #</th><th>Domain</th><th>Status</th><th>Budget</th><th>Payment</th><th>Transfer</th><th>Submitted</th><th></th></tr></thead>
<tbody>
{foreach from=$results.rows item=c}
<tr>
<td>{$c->case_number|escape:'html':'UTF-8'}</td>
<td>{$c->domain|escape:'html':'UTF-8'}</td>
<td>{$c->status_label|escape:'html':'UTF-8'}</td>
<td>{$c->currency|escape:'html':'UTF-8'} {$c->max_budget|string_format:"%.2f"}</td>
<td>{$c->payment_status_label|escape:'html':'UTF-8'}</td>
<td>{$c->transfer_status_label|escape:'html':'UTF-8'}</td>
<td>{$c->created_at|escape:'html':'UTF-8'}</td>
<td><a class="btn btn-xs btn-default" href="index.php?m=cloudhost247_broker&amp;a=detail&amp;id={$c->id|intval}">View</a></td>
</tr>
{/foreach}
</tbody>
</table>
</div>
{if $results.pages > 1}
<nav><ul class="pagination">
{section name=p start=1 loop=$results.pages+1}
<li{if $smarty.section.p.index eq $results.page} class="active"{/if}><a href="index.php?m=cloudhost247_broker&amp;a=list&amp;page={$smarty.section.p.index}">{$smarty.section.p.index}</a></li>
{/section}
</ul></nav>
{/if}
{else}
<div class="alert alert-info">You have no domain brokerage cases yet. Submit a request above to get started.</div>
{/if}
