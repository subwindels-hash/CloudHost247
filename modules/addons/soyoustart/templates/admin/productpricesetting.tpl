{include file=$tplVar.header}

{* style for loader *}
<style> 
	#cover-spin {
    position: fixed;
    width: 100%;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    background-color: rgba(255, 255, 255, 0.7);
    z-index: 9999;
    display: block;
}
@-webkit-keyframes spin {
    from {
        -webkit-transform: rotate(0deg);
    }
    to {
        -webkit-transform: rotate(360deg);
    }
}
@keyframes spin {
    from {
        transform: rotate(0deg);
    }
    to {
        transform: rotate(360deg);
    }
}
#cover-spin::after {
    content: "";
    display: block;
    position: absolute;
    left: 48%;
    top: 40%;
    width: 40px;
    height: 40px;
    border-style: solid;
    border-color: black;
    border-top-color: transparent;
    border-width: 4px;
    border-radius: 50%;
    -webkit-animation: spin 0.8s linear infinite;
    animation: spin 0.8s linear infinite;
}
</style>


<div class="innerContent">
 {* loader *}
 <div id="cover-spin"></div>
 	<div class="alert alert-secondary" role="alert">{$tplVar['_lang']['product_pricesetting_note']}</div>
    <a href="{$tplVar["moduleLink"]}&action=productsetting"  class='btn btn-primary' style="float: right; margin-bottom:20px;">Back</a>

    <form method="POST">
        <table class="form" width="100%" border="0" cellspacing="0" cellpadding="0">
			<tbody>
				<tr>
					<td colspan="6" class="fieldarea" style="text-align:center;"><strong>{$tplVar['_lang']['product_price']}</strong></td>
				</tr>
				<tr bgcolor="#efefef" style="text-align:center;font-weight:bold;">
					<td>{$tplVar['_lang']['product_name']}</td>
					<td width="95">&nbsp;</td>
					<td width="162">{$tplVar['_lang']['monthly']}</td>
					<td width="162">{$tplVar['_lang']['annually']}</td>
					<td width="162">{$tplVar['_lang']['biennially']}</td>
				</tr>
				<tr style="text-align:center;">
					<td rowspan="{$tplVar["totalcurrency"]+1}"><input type="text" name="productname" value="{$tplVar["productdetail"]->name}" class="form-control" style="min-width:180px;"></td>
						{foreach from=$tplVar["productprices"] key=currencyCode item=price}
							<tr>
								<td bgcolor="#efefef">{$price->code}</td>
								<td><input type="text" name="price[{$price->id}][]" value="{$price->prices->monthly}" class="form-control" style="width:80px;"></td>
								<td><input type="text" name="price[{$price->id}][]" value="{$price->prices->annually}" class="form-control" style="width:80px;"></td>
								<td><input type="text" name="price[{$price->id}][]" value="{$price->prices->biennially}" class="form-control" style="width:80px;"></td>
							</tr>
						{/foreach}
				</tr>
			</tbody>
		</table>
    	</br>

		{* showing configuration options *}

		<h1 style="text-align: center;">{$tplVar['_lang']['configoptionh1']}</h1>
		<table class="form" width="100%" border="0" cellspacing="2" cellpadding="3">
			<tbody>
				{foreach from=$tplVar["productconfigDetails"] key=key item=configoptions}
					<tr>
						<td colspan="{$tplVar["totalcurrency"]}" class="fieldarea" style="text-align:center;background:#dddddd;padding:10px;font-size:16px;"><strong>{$key}</strong></td>
					</tr>
					<tr bgcolor="#efefef" style="text-align:center;font-weight:bold;">
						<td>{$tplVar['_lang']['option']}</td>
						<td width="95">&nbsp;</td>
						<td width="162">{$tplVar['_lang']['monthly']}</td>
						<td width="162">{$tplVar['_lang']['annually']}</td>
						<td width="162">{$tplVar['_lang']['biennially']}</td>
					</tr>
						{foreach from=$configoptions->productconfigoptionssub key=productconfigoptionssubkey item=configoption}
							<tr style="text-align:center;">
									<td rowspan="{$tplVar["totalcurrency"]+1}"><input type="text" name="optionname[{$configoption->id}]" value="{$configoption->optionname}" class="form-control" style="min-width:180px;"></td>

									{foreach from=$configoption->prices key=configoptionkeys item=configoptionvalue }
										<tr>
											<td bgcolor="#efefef">{$configoptionkeys}</td>
											<td><input type="text" name="configprice[{$configoptionvalue->currency}][{$configoption->id}][]" value="{$configoptionvalue->monthly}"class="form-control" style="width:80px;"></td>
											<td><input type="text" name="configprice[{$configoptionvalue->currency}][{$configoption->id}][]" value="{$configoptionvalue->annually}" class="form-control" style="width:80px;"></td>
											<td><input type="text" name="configprice[{$configoptionvalue->currency}][{$configoption->id}][]" value="{$configoptionvalue->biennially}" class="form-control" style="width:80px;"></td>
										{* <hr> *}
										</tr>
									{/foreach}
										<tr><td colspan="5"><hr style="margin: 0px;"></td></tr>
							</tr>
						{/foreach}
				{/foreach}		
			</tbody>
		</table>
		
		<br>
		<div class="btn-container">
			<input type="submit" value="Save Setting" class="btn btn-primary" name="soyouStartproductpriceSetup" >
			<input type="button" value="Cancel Setting" onclick="window.location='{$tplVar['moduleLink']}&action=productsetting'" class="btn btn-default">

		</div>	
    </form>

</div>



{include file=$tplVar.footer}