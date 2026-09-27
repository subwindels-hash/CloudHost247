<div class="client_mass_payment_page">
	<div class="shared-hosting">
		<form method="post" action="clientarea.php?action=masspay" class="form-horizontal">
		<input type="hidden" name="geninvoice" value="true" />
			<div class="manage_payments">
				<div class="view_manage_pays">
					<div class="top-bars manage_pay_top_bar">{$LANG.invoicesdescription} <strong>{$LANG.invoicesamount}</strong></div>
						{foreach from=$invoiceitems key=invid item=invoiceitem}
							<div class="invoice-dis">
							  <div class="invoice-title">{$LANG.invoicenumber} {if $invoiceitem.0.invoicenum}{$invoiceitem.0.invoicenum}{else}{$invid}{/if}</div>
							  <input type="hidden" name="invoiceids[]" value="{$invid}" />
							  <table cellspacing="0" cellpadding="0" width="100%" border="0" class="invoice-table">
								{foreach from=$invoiceitem item=item}
									<tr>
									  <td>{$item.description}</td>
									  <td class="price-col">{$item.amount}</td>
									</tr> 
								{/foreach}
								</table>
							</div>
							{foreachelse}
							<div class="invoice-dis">
								<div class="invoice-title">{$LANG.invoicenumber} {$invid}</div>
								<table cellspacing="0" cellpadding="0" width="100%" border="0" class="invoice-table">
									<tr>
										<td colspan="2" align="center">{$LANG.norecordsfound}</td>
									</tr>
								</table>
							</div>							
						{/foreach}
					</div>
				</div>
			</div>
			<div class="subtotalTableDiv">
			  <table cellspacing="0" cellpadding="0" width="100%" border="0" class="invoice-total-tb">
				<tr>
				  <td align="right" width="75%"><span>{$LANG.invoicessubtotal}:</span></td>
				  <td class="rightPriceWgs">{$subtotal}</td>
				</tr>
				{if $tax}
					<tr>
					  <td align="right"  width="75%"><span>{$taxrate1}% {$taxname1}:</span></td>
					  <td class="rightPriceWgs">{$tax}</td>
					</tr>
				{/if}
				{if $tax2}
					<tr>
					  <td align="right"  width="75%"><span>{$taxrate2}% {$taxname2}:</span></td>
					  <td class="rightPriceWgs">{$tax2}</td>
					</tr>
				{/if}
				{if $credit}
					<tr>
					  <td align="right"  width="75%"><span>{$LANG.invoicescredit}:</span></td>
					  <td class="rightPriceWgs">{$credit}</td>
					</tr>
				{/if}
				{if $partialpayments}
					<tr>
					  <td align="right"  width="75%"><span>{$LANG.invoicespartialpayments}:</span></td>
					  <td class="rightPriceWgs">{$partialpayments}</td>
					</tr>
				{/if}
				<tr>
				  <td align="right"  width="75%"><span>{$LANG.invoicestotaldue}</span></td>
				  <td class="rightPriceWgs">{$total}</td>
				</tr>
			  </table>
			</div>
			<div class="inner-bottom_tb">
				<div class="row">
					<div class="col-md-5">
						<h3 class="payment-heading">{$LANG.masspaymentselectgateway}</h3>
					</div>
					<div class="col-md-4">
						<div class="form-group outer_control">
							<select name="paymentmethod" id="paymentmethod" class="form-control">
								{foreach from=$gateways item=gateway}
									<option value="{$gateway.sysname}">{$gateway.name}</option>
								{/foreach}
							</select>
						</div>
					</div>
					<div class="col-md-3">
						<div class="form-group">
							<input type="submit" value="{$LANG.masspaymakepayment}" class="btn btn-primary btn-block" id="btnMassPayMakePayment" />
						</div>
					</div>
				</div>
			</div>
	    </form>
	</div>
</div>