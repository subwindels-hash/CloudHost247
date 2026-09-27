<div class="client_affiliate_view_page">
	<div class="shared-hosting">
		{if $inactive}
			{include file="$template/includes/alert.tpl" type="danger" msg=$LANG.affiliatesdisabled textcenter=true}
		{else}
			{include file="$template/includes/flashmessage.tpl"}
			<div class="row">
				<div class="col-sm-12 col-md-4">
					<div class="affilates_div_box">
						<i class="fas fa-users"></i>
						<h3>{$visitors}</h3>
						<span>{$LANG.affiliatesclicks}</span>
					</div>
				</div>
				<div class="col-sm-12 col-md-4">
					<div class="affilates_div_box affiSecond">
						<i class="fas fa-shopping-cart"></i>
						<h3>{$signups}</h3>
						<span>{$LANG.affiliatessignups}</span>
					</div>
				</div>
				<div class="col-sm-12 col-md-4">
					<div class="affilates_div_box affiThird">
						<i class="far fa-chart-bar"></i>
						<h3>{$conversionrate}%</h3>
						<span>{$LANG.affiliatesconversionrate}</span>
					</div>
				</div>
			</div>
			<div class="row">
				<div class="col-sm-12">
					<div class="affiliate-referral-link text-left">
						<h3>{$LANG.affiliatesreferallink}</h3> <br />
						<span>{$referrallink}</span>
					</div>
				</div>
			</div>
			<div class="row">
				<div class="col-md-6">
					<table class="table affilate_data_tbl">
						<tr>
							<td class="text-right"><span>{$LANG.affiliatescommissionspending}:</span></td>
							<td>{$pendingcommissions}</td>
						</tr>
						<tr>
							<td class="text-right"><span>{$LANG.affiliatescommissionsavailable}:</span></td>
							<td>{$balance}</td>
						</tr>
						<tr>
							<td class="text-right"><span>{$LANG.affiliateswithdrawn}:</span></td>
							<td>{$withdrawn}</td>
						</tr>
					</table>
				</div>
			</div>		
			{if $withdrawrequestsent}
				<div class="row">
					<div class="col-sm-12 wgs_success_cls">
						<div class="alert alert-success">
							<p>{$LANG.affiliateswithdrawalrequestsuccessful}</p>
						</div>
					</div>
				</div>
			{else}
				<p class="text-left">
					<a href="{$smarty.server.PHP_SELF}?action=withdrawrequest" class="btn btn-lg btn-danger{if !$withdrawlevel}disabled" disabled="disabled{/if}">
						<i class="fas fa-university"></i> {$LANG.affiliatesrequestwithdrawal}
					</a>
				</p>
				{if !$withdrawlevel}
					<p class="text-muted text-left">{lang key="affiliateWithdrawalSummary" amountForWithdrawal=$affiliatePayoutMinimum}</p>
				{/if}
			{/if}
			<div class="row">
				<div class="col-sm-12 affl_sub_hedr">
					{include file="$template/includes/subheader.tpl" title=$LANG.affiliatesreferals}
				</div>
			</div>
			{include file="$template/includes/tablelist.tpl" tableName="AffiliatesList"}
			<script type="text/javascript">
				jQuery(document).ready( function ()
				{
					var table = jQuery('#tableAffiliatesList').removeClass('hidden').DataTable();
					{if $orderby == 'regdate'}
						table.order(0, '{$sort}');
					{elseif $orderby == 'product'}
						table.order(1, '{$sort}');
					{elseif $orderby == 'amount'}
						table.order(2, '{$sort}');
					{elseif $orderby == 'status'}
						table.order(4, '{$sort}');
					{/if}
					table.draw();
					jQuery('#tableLoading').addClass('hidden');
				});
			</script>
			<div class="table-container clearfix">
				<table id="tableAffiliatesList" class="table table-list hidden">
					<thead>
						<tr>
							<th>{$LANG.affiliatessignupdate}</th>
							<th>{$LANG.orderproduct}</th>
							<th>{$LANG.affiliatesamount}</th>
							<th>{$LANG.affiliatescommission}</th>
							<th>{$LANG.affiliatesstatus}</th>
						</tr>
					</thead>
					<tbody>
					{foreach from=$referrals item=referral}
						<tr class="text-center">
							<td><span class="hidden">{$referral.datets}</span>{$referral.date}</td>
							<td>{$referral.service}</td>
							<td data-order="{$referral.amountnum}">{$referral.amountdesc}</td>
							<td data-order="{$referral.commissionnum}">{$referral.commission}</td>
							<td><span class='label status status-{$referral.rawstatus|strtolower}'>{$referral.status}</span></td>
						</tr>
					{/foreach}
					</tbody>
				</table>
				<div class="text-center" id="tableLoading">
					<p><i class="fas fa-spinner fa-spin"></i> {$LANG.loading}</p>
				</div>
			</div>
			{if $affiliatelinkscode}
				{include file="$template/includes/subheader.tpl" title=$LANG.affiliateslinktous}
				<div class="margin-bottom text-center">
					{$affiliatelinkscode}
				</div>
			{/if}

		{/if}
	</div>
</div>
