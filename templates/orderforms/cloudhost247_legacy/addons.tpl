{include file="orderforms/{$carttpl}/common.tpl"}
<div id="order-standard_cart">
    <div class="row">
        <div class="col-md-12">
            {include file="orderforms/{$carttpl}/sidebar-categories.tpl"}
        </div>
        <div class="col-md-12">            
            <h1>{$LANG.cartproductaddons}</h1>            
        </div>
        <div class="col-md-12 pull-md-right">
            {include file="orderforms/{$carttpl}/sidebar-categories-collapsed.tpl"}
            {if count($addons) == 0}
                <div class="alert alert-warning text-center" role="alert">
                    {$LANG.cartproductaddonsnone}
                </div>
                <p class="text-center">
                    <a href="{$WEB_ROOT}/clientarea.php" class="btn btn-default">
                        <i class="fas fa-arrow-circle-left"></i>
                        {$LANG.orderForm.returnToClientArea}
                    </a>
                </p>
            {/if}
            <div class="products">
                <div class="row row-eq-height">
                    {foreach $addons as $num => $addon}
                        <div class="col-md-6">
                            <div class="product clearfix" id="product{$num}">
                                <form method="post" action="{$smarty.server.PHP_SELF}?a=add" class="form-inline">
                                    <input type="hidden" name="aid" value="{$addon.id}" />
                                    <header class="col-12">
                                        <span>{$addon.name}</span>
                                    </header>
                                    <div class="product-desc product-desc-full-width">
										<div class="addDecprpAddon"> 
											<p>{$addon.description|nl2br}</p>
										</div>
                                        <div class="form-group">
                                            <select name="productid" id="inputProductId{$num}" class="field form-control">
                                                {foreach $addon.productids as $product}
                                                    <option value="{$product.id}">
                                                        {$product.product}{if $product.domain} - {$product.domain}{/if}
                                                    </option>
                                                {/foreach}
                                            </select>
                                        </div>
                                    </div>
                                    <footer class="col-12 text-right">
                                        <div class="product-pricing">
                                            {if $addon.free}
                                                {$LANG.orderfree}
                                            {else}
                                                <span class="price">{$addon.recurringamount} {$addon.billingcycle}</span>
                                                {if $addon.setupfee}<br />+ {$addon.setupfee} {$LANG.ordersetupfee}{/if}
                                            {/if}
                                        </div>
                                        <button type="submit" class="btn btn-success btn-sm">
                                            <i class="fas fa-shopping-cart"></i>
                                            {$LANG.ordernowbutton}
                                        </button>
                                    </footer>
                                </form>
                            </div>
                        </div>
                        {if $num % 2 != 0}
                            </div>
                            <div class="row row-eq-height">
                        {/if}
                    {/foreach}
                </div>
            </div>
        </div>
    </div>
</div>
<script>
jQuery(document).ready(function(){
	if(jQuery(".addDecprpAddon").length > 0){
		jQuery(".addDecprpAddon").addClass('sb-container');
		jQuery(".sb-container").scrollBox();
	}
});
</script>