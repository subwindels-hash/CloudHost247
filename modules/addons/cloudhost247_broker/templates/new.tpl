{*
 * CloudHost247 Domain Brokerage — new brokerage request form (requirement #3).
 *}
<h2>Request a Domain Broker</h2>
{if $error}<div class="alert alert-danger">{$error|escape:'html':'UTF-8'}</div>{/if}
{if !$brokerage_enabled}
<div class="alert alert-warning">Domain brokerage requests are not currently being accepted. Please contact support.</div>
{else}
<p class="text-muted">CloudHost247 will use only legitimate channels — public RDAP/WHOIS contact where available, registrar forwarding, public business contact information, or an approved marketplace/broker channel — to reach out about this domain on your behalf. We can never guarantee the owner will agree to sell, and a domain being registered does not mean it is for sale.</p>
<form method="post" action="index.php?m=cloudhost247_broker">
<input type="hidden" name="token" value="{$token|escape:'html':'UTF-8'}">
<input type="hidden" name="operation" value="create_case">
<input type="hidden" name="form_token" value="{$smarty.now}">
<div class="form-group">
<label>Domain you want to acquire</label>
<input type="text" class="form-control" name="domain" value="{$prefill_domain|escape:'html':'UTF-8'}" placeholder="example.com" required>
</div>
{if $domain_status}
<div class="alert alert-info">Current status: {$domain_status.state_label|escape:'html':'UTF-8'}{if $domain_status.registrar} &mdash; registrar on record: {$domain_status.registrar|escape:'html':'UTF-8'}{/if}{if $domain_status.privacy_protected} &mdash; registrant contact is protected by the registrar's privacy service{/if}</div>
{/if}
<div class="form-group">
<label>Maximum budget (kept confidential — never shared with the seller unless you authorize it)</label>
<div class="row">
<div class="col-sm-6"><input type="number" step="0.01" min="1" class="form-control" name="max_budget" placeholder="5000.00" required></div>
<div class="col-sm-6"><select class="form-control" name="currency">{foreach from=$currencies item=cur}<option value="{$cur|escape:'html':'UTF-8'}">{$cur|escape:'html':'UTF-8'}</option>{/foreach}</select></div>
</div>
</div>
<div class="form-group">
<label><input type="checkbox" name="disclose_budget_to_seller" value="1"> I authorize CloudHost247 to disclose my maximum budget to the seller if it helps close the deal</label>
</div>
<div class="form-group">
<label>Opening offer (optional)</label>
<input type="number" step="0.01" min="0" class="form-control" name="opening_offer" placeholder="Leave blank to let your broker recommend an opening offer">
</div>
<div class="form-group">
<label>Message to your broker (optional)</label>
<textarea class="form-control" name="customer_message" rows="3" placeholder="Any context about why you want this domain"></textarea>
</div>
<div class="form-group">
<label>Negotiation instructions (optional)</label>
<textarea class="form-control" name="negotiation_instructions" rows="3" placeholder="e.g. Please negotiate down as much as possible before accepting anything"></textarea>
</div>
<div class="form-group">
<label>Negotiation deadline (optional)</label>
<input type="date" class="form-control" name="deadline">
</div>
<div class="form-group">
<label><input type="checkbox" name="terms_accepted" value="1" required> I agree to the <a href="domain-brokerage-terms.php" target="_blank">Domain Brokerage Terms</a></label>
</div>
<button type="submit" class="btn btn-primary">Submit brokerage request</button>
</form>
{/if}
