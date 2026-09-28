<div class="main-sate">
	<div class="container">
		<div class="upper-sec-satelite">
			<h2 class="main-head-price-block">{$LANG.cpanelwhychoosehd}</h2>
			<p class="sub-head-price-block">{$LANG.cpanelwhychoosetext}</p>
			<div class="satelitetop-detail" id="billingcycle-tabs-block">
              {if $productsDataCycles.monthly}
                <p class="active" onclick="toggleBillingTabsVpsLatest(this,'monthly');">{$LANG.orderpaymenttermmonthly}</p>
              {/if}
              {if $productsDataCycles.quarterly}
                <p {if !$productsDataCycles.monthly}class="active"{/if}onclick="toggleBillingTabsVpsLatest(this,'quarterly');">{$LANG.orderpaymenttermquarterly}</p>
              {/if}
              {if $productsDataCycles.semiannually}
                <p {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly}class="active"{/if} onclick="toggleBillingTabsVpsLatest(this,'semiannually');">{$LANG.orderpaymenttermsemiannually}</p>
              {/if}
              {if $productsDataCycles.annually}
                <p {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually}class="active"{/if} onclick="toggleBillingTabsVpsLatest(this,'annually');">{$LANG.orderpaymenttermannually}</p>
              {/if}
              {if $productsDataCycles.biennially}
                <p {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && !$productsDataCycles.annually}class="active"{/if} onclick="toggleBillingTabsVpsLatest(this,'biennially');">{$LANG.orderpaymenttermbiennially}</p>
              {/if}
              {if $productsDataCycles.triennially}
                <p {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && !$productsDataCycles.annually && !$productsDataCycles.biennially}class="active"{/if} onclick="toggleBillingTabsVpsLatest(this,'triennially');">{$LANG.orderpaymenttermtriennially}</p>
              {/if}
			</div>
		</div>
		<div class="sate-bottom-sec">
            {foreach from=$productsData item=productData}
                <div class="sate detail-inner-sec">
                    <div class="col1 common-bottom">
                        <div class="country-sec">
                            <h3>{$productData.name}</h3>
                        </div>
                    </div>
                    <div class="col3 common-bottom">
                        {$productData.customDescription.pDescription}
                    </div>
                    <div class="col4 common-bottom">
                        <div class="timeduration-sec">
                            {if $productsDataCycles.onetime}
                            <h3 class="btn-cnfgr monthly" {if $productsDataCycles.onetime}style="display: block;"{/if}>{$LANG.orderpaymenttermonetime}</h3>
                          {/if}
                          {if $productsDataCycles.free}
                            <h3 class="btn-cnfgr monthly" {if $productsDataCycles.free}style="display: block;"{/if}>{$LANG.orderpaymenttermfreeaccount}</h3>
                          {/if}
                          {if !$productsDataCycles.onetime || !$productsDataCycles.free}
                            <h3 class="btn-cnfgr monthly" {if $productsDataCycles.monthly}style="display: block;"{/if}>{$LANG.orderpaymenttermmonthly}</h3>
                            <h3 class="btn-cnfgr quarterly" {if !$productsDataCycles.monthly && $productsDataCycles.quarterly}style="display: block;"{/if}>{$LANG.orderpaymenttermquarterly}</h3>
                            <h3 class="btn-cnfgr semiannually" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && $productsDataCycles.semiannually}style="display: block;"{/if}>{$LANG.orderpaymenttermsemiannually}</h3>
                            <h3 class="btn-cnfgr annually" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && $productsDataCycles.annually}style="display: block;"{/if}>{$LANG.orderpaymenttermannually}</h3>
                            <h3 class="btn-cnfgr biennially" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && !$productsDataCycles.annually && $productsDataCycles.biennially}style="display: block;"{/if}>{$LANG.orderpaymenttermbiennially}</h3>
                            <h3 class="btn-cnfgr triennially" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && !$productsDataCycles.annually && !$productsDataCycles.biennially && $productsDataCycles.triennially}style="display: block;"{/if}>{$LANG.orderpaymenttermtriennially}</h3>
                          {/if}
                        </div>
                    </div>
                    <div class="col5">
                        <div class="offer-sec">
                            <div class="left-sec price-section-vps-blk">
                              {if $productsDataCycles.onetime}
                                <h5 class="btn-cnfgr monthly" {if $productsDataCycles.onetime}style="display: block;"{/if}><strong>{$productData.pricing.monthly}</strong></h5>
                              {/if}
                              {if $productsDataCycles.free}
                                <h5 class="btn-cnfgr monthly" {if $productsDataCycles.free}style="display: block;"{/if}><strong>{$productData.pricing.free}</strong></h5>
                              {/if}
                              {if !$productsDataCycles.onetime || !$productsDataCycles.free}
                                <h5 class="btn-cnfgr monthly" {if $productsDataCycles.monthly}style="display: block;"{/if}><strong>{$productData.pricing.monthly}</strong></h5>
                                <h5 class="btn-cnfgr quarterly" {if !$productsDataCycles.monthly && $productsDataCycles.quarterly}style="display: block;"{/if}><strong>{$productData.pricing.quarterly}</strong></h5>
                                <h5 class="btn-cnfgr semiannually" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && $productsDataCycles.semiannually}style="display: block;"{/if}><strong>{$productData.pricing.semiannually}</strong></h5>
                                <h5 class="btn-cnfgr annually" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && $productsDataCycles.annually}style="display: block;"{/if}><strong>{$productData.pricing.annually}</strong></h5>
                                <h5 class="btn-cnfgr biennially" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && !$productsDataCycles.annually && $productsDataCycles.biennially}style="display: block;"{/if}><strong>{$productData.pricing.biennially}</strong> </h5>
                                <h5 class="btn-cnfgr triennially" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && !$productsDataCycles.annually && !$productsDataCycles.biennially && $productsDataCycles.triennially}style="display: block;"{/if}><strong>{$productData.pricing.triennially}</strong></h5>
                              {/if}
                            </div>
                            <div class="right-sec">
                                <ul class="buy-btn-vps-blocks">
                                    <li class="buy-btn">
                                    {if $productsDataCycles.onetime}
                                        <a href="cart.php?a=add&pid={$productData.pid}" class="btn-cnfgr" {if $productsDataCycles.onetime}style="display: block;"{/if}>{$LANG.homeordernow}</a>
                                    {/if}
                                    {if $productsDataCycles.free}
                                    <a href="cart.php?a=add&pid={$productData.pid}" class="btn-cnfgr" {if $productsDataCycles.free}style="display: block;"{/if}>{$LANG.homeordernow}</a>
                                    {/if}
                                    {if !$productsDataCycles.onetime || !$productsDataCycles.free}
                                    <a href="cart.php?a=add&pid={$productData.pid}&billingcycle=monthly" class="btn-cnfgr monthly" {if $productsDataCycles.monthly}style="display: block;"{/if}>{$LANG.homeordernow}</a>  
                                    <a href="cart.php?a=add&pid={$productData.pid}&billingcycle=quarterly" class="btn-cnfgr quarterly" {if !$productsDataCycles.monthly && $productsDataCycles.quarterly}style="display: block;"{/if}>{$LANG.homeordernow}</a>  
                                    <a href="cart.php?a=add&pid={$productData.pid}&billingcycle=semiannually" class="btn-cnfgr semiannually" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && $productsDataCycles.semiannually}style="display: block;"{/if}>{$LANG.homeordernow}</a>  
                                    <a href="cart.php?a=add&pid={$productData.pid}&billingcycle=annually" class="btn-cnfgr annually" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && $productsDataCycles.annually}style="display: block;"{/if}>{$LANG.homeordernow}</a>
                                    <a href="cart.php?a=add&pid={$productData.pid}&billingcycle=biennially" class="btn-cnfgr biennially" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && !$productsDataCycles.annually && $productsDataCycles.biennially}style="display: block;"{/if}>{$LANG.homeordernow}</a>
                                    <a href="cart.php?a=add&pid={$productData.pid}&billingcycle=triennially" class="btn-cnfgr triennially" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && !$productsDataCycles.annually && !$productsDataCycles.biennially && $productsDataCycles.triennially}style="display: block;"{/if}>{$LANG.homeordernow}</a>

                                    {/if} 
                                    </li>                               
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            {/foreach}
		</div>
	</div>
</div>