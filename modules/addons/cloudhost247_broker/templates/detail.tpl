{*
 * CloudHost247 Domain Brokerage — case detail (requirement #4).
 * All data is already scoped to the logged-in customer by ClientAreaController.
 *}
<h2>{$case->case_number|escape:'html':'UTF-8'} &mdash; {$case->domain|escape:'html':'UTF-8'}</h2>
{if $notice}<div class="alert alert-success">{$notice|escape:'html':'UTF-8'}</div>{/if}
{if $error}<div class="alert alert-danger">{$error|escape:'html':'UTF-8'}</div>{/if}
{if $case->disputed}<div class="alert alert-danger">This case is under dispute review. Some actions are temporarily unavailable while our team resolves it with you.</div>{/if}

<div class="row">
<div class="col-sm-4"><strong>Status:</strong> {$case->status_label|escape:'html':'UTF-8'}</div>
<div class="col-sm-4"><strong>Payment:</strong> {$case->payment_status_label|escape:'html':'UTF-8'}</div>
<div class="col-sm-4"><strong>Transfer:</strong> {$case->transfer_status_label|escape:'html':'UTF-8'}</div>
</div>
<div class="row" style="margin-top:8px;">
<div class="col-sm-4"><strong>Your maximum budget (confidential):</strong> {$case->currency|escape:'html':'UTF-8'} {$case->max_budget|string_format:"%.2f"}</div>
<div class="col-sm-4"><strong>Domain status:</strong> {$case->domain_status_label|escape:'html':'UTF-8'}</div>
<div class="col-sm-4"><strong>Submitted:</strong> {$case->created_at|escape:'html':'UTF-8'}</div>
</div>
<div class="row" style="margin-top:8px;">
<div class="col-sm-4"><strong>Broker:</strong> {$case->broker_label|escape:'html':'UTF-8'}</div>
<div class="col-sm-8"><strong>Next action:</strong> {$case->next_action|escape:'html':'UTF-8'}</div>
</div>

{if $accepted_offer}
<div class="alert alert-success" style="margin-top:12px;">
<strong>Agreement reached:</strong> {$accepted_offer->currency|escape:'html':'UTF-8'} {$accepted_offer->amount|string_format:"%.2f"} accepted on {$accepted_offer->created_at|escape:'html':'UTF-8'}.
This agreement is recorded on the immutable offer ledger below.
</div>
{/if}

<h3 style="margin-top:20px;">Offers &amp; Counteroffers</h3>
{if $offers}
<div class="table-responsive"><table class="table table-condensed">
<thead><tr><th>Kind</th><th>From</th><th>To</th><th>Amount</th><th>Status</th><th></th></tr></thead>
<tbody>
{foreach from=$offers item=o}
<tr>
<td>{$o->kind|escape:'html':'UTF-8'}</td><td>{$o->from_party|escape:'html':'UTF-8'}</td><td>{$o->to_party|escape:'html':'UTF-8'}</td>
<td>{$o->currency|escape:'html':'UTF-8'} {$o->amount|string_format:"%.2f"}</td>
<td>{$o->derived_status|escape:'html':'UTF-8'}</td>
<td>
{if $o->derived_status eq 'pending' && $o->to_party eq 'customer'}
<form method="post" action="index.php?m=cloudhost247_broker" style="display:inline;">
<input type="hidden" name="token" value="{$token|escape:'html':'UTF-8'}"><input type="hidden" name="operation" value="accept_offer"><input type="hidden" name="offer_id" value="{$o->id|intval}">
<button type="submit" class="btn btn-xs btn-success" onclick="return confirm('Accept this offer? This cannot be undone automatically.');">Accept</button>
</form>
<form method="post" action="index.php?m=cloudhost247_broker" style="display:inline;">
<input type="hidden" name="token" value="{$token|escape:'html':'UTF-8'}"><input type="hidden" name="operation" value="reject_offer"><input type="hidden" name="offer_id" value="{$o->id|intval}">
<button type="submit" class="btn btn-xs btn-danger">Reject</button>
</form>
{/if}
</td>
</tr>
{/foreach}
</tbody>
</table></div>
{else}
<p class="text-muted">No offers recorded yet.</p>
{/if}

{if !$case->disputed && $case->status neq 'completed' && $case->status neq 'cancelled' && $case->status neq 'failed'}
<h4>Submit a counteroffer</h4>
<form method="post" action="index.php?m=cloudhost247_broker" class="form-inline">
<input type="hidden" name="token" value="{$token|escape:'html':'UTF-8'}"><input type="hidden" name="operation" value="submit_counteroffer"><input type="hidden" name="case_id" value="{$case->id|intval}">
<input type="number" step="0.01" min="0" class="form-control" name="amount" placeholder="Amount" required>
<input type="text" class="form-control" name="currency" style="width:90px;" value="{$case->currency|escape:'html':'UTF-8'}">
<button type="submit" class="btn btn-default">Send counteroffer</button>
</form>
{/if}

<h3 style="margin-top:20px;">Timeline</h3>
<div class="table-responsive"><table class="table table-condensed">
{foreach from=$events item=e}
<tr><td>{$e->created_at|escape:'html':'UTF-8'}</td><td>{$e->summary|escape:'html':'UTF-8'}</td></tr>
{foreachelse}
<tr><td><em>No activity yet.</em></td></tr>
{/foreach}
</table></div>

<h3>Messages</h3>
<div class="table-responsive"><table class="table table-condensed">
{foreach from=$messages item=m}
<tr><td>{$m->created_at|escape:'html':'UTF-8'}</td><td>{if $m->author_type eq 'customer'}You{else}Your broker{/if}</td><td>{$m->body|escape:'html':'UTF-8'}</td></tr>
{foreachelse}
<tr><td colspan="3"><em>No messages yet.</em></td></tr>
{/foreach}
</table></div>
<form method="post" action="index.php?m=cloudhost247_broker" class="form-inline">
<input type="hidden" name="token" value="{$token|escape:'html':'UTF-8'}"><input type="hidden" name="operation" value="add_message"><input type="hidden" name="case_id" value="{$case->id|intval}">
<input type="text" class="form-control" style="width:60%;" name="body" placeholder="Message your broker" required>
<button type="submit" class="btn btn-default">Send</button>
</form>

{if $payments}
<h3 style="margin-top:20px;">Payments</h3>
<div class="table-responsive"><table class="table table-condensed">
<thead><tr><th>Acquisition price</th><th>Brokerage fee</th><th>Transfer fee</th><th>Service fee</th><th>Total</th><th>Status</th></tr></thead>
{foreach from=$payments item=p}
<tr><td>{$p->acquisition_price|string_format:"%.2f"}</td><td>{$p->brokerage_fee|string_format:"%.2f"}</td><td>{$p->transfer_fee|string_format:"%.2f"}</td>
<td>{$p->service_fee|string_format:"%.2f"}</td><td>{$p->amount_total|string_format:"%.2f"}</td><td>{$p->status|escape:'html':'UTF-8'}</td></tr>
{/foreach}
</table></div>
<p class="text-muted small">Pay this invoice from your <a href="clientarea.php?action=invoices">Invoices</a> page using any payment method already available on your account.</p>
{/if}

{if $transfer}
<h3>Transfer &amp; delivery</h3>
<p>Status: {$transfer->status|escape:'html':'UTF-8'}{if $transfer->completed_at} &mdash; completed {$transfer->completed_at|escape:'html':'UTF-8'}{/if}</p>
<p>Delivery: {$delivery_label|escape:'html':'UTF-8'}
{if $delivery_status eq 'associated'} &mdash; manage DNS, nameservers, renewal, transfer lock and contacts from your <a href="clientarea.php?action=domains">Client Area &raquo; Domains</a>.
{elseif $delivery_status eq 'pending_manual'} &mdash; CloudHost247 is manually linking the domain to your account; we will confirm when done.
{elseif $delivery_status eq 'failed'} &mdash; our team is resolving an issue linking the domain to your account and will contact you.{/if}</p>
{/if}

{if $documents}
<h3>Documents</h3>
<ul>{foreach from=$documents item=d}<li>{$d->label|escape:'html':'UTF-8'} ({$d->created_at|escape:'html':'UTF-8'})</li>{/foreach}</ul>
{/if}

{if !$case->disputed && $case->status neq 'completed' && $case->status neq 'cancelled' && $case->status neq 'failed'}
<form method="post" action="index.php?m=cloudhost247_broker" onsubmit="return confirm('Cancel this brokerage request?');">
<input type="hidden" name="token" value="{$token|escape:'html':'UTF-8'}"><input type="hidden" name="operation" value="cancel_case"><input type="hidden" name="case_id" value="{$case->id|intval}">
<input type="hidden" name="reason" value="Cancelled by customer from dashboard.">
<button type="submit" class="btn btn-danger btn-sm" style="margin-top:15px;">Cancel this request</button>
</form>
{/if}

<p style="margin-top:15px;"><a href="index.php?m=cloudhost247_broker&amp;a=list">&laquo; Back to all cases</a></p>
