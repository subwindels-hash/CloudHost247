<div class="pricing_section">
    <div class="container">
    <div class="tab-content">
      <div class="tab-pane container active" id="pricing">
          <div class="price_top">
              <h2>{$LANG.cpanelwhychoosehd}</h2>
              <p>{$LANG.cpanelwhychoosetext}</p>
              {if !$productsDataCycles.onetime  || !$productsDataCycles.free}
                <ul class="months-ul" id="changeBillingCycle">
                      {if $productsDataCycles.monthly}
                        <li><a href="javascript:;" class="active" onclick="toggleBillingTabsVps(this,'monthly');">{$LANG.orderpaymenttermmonthly}</a></li>
                      {/if}
                      {if $productsDataCycles.quarterly}
                        <li><a href="javascript:;" {if !$productsDataCycles.monthly}class="active"{/if}onclick="toggleBillingTabsVps(this,'quarterly');">{$LANG.orderpaymenttermquarterly}</a></li>
                      {/if}
                      {if $productsDataCycles.semiannually}
                        <li><a href="javascript:;" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly}class="active"{/if} onclick="toggleBillingTabsVps(this,'semiannually');">{$LANG.orderpaymenttermsemiannually}</a></li>
                      {/if}
                      {if $productsDataCycles.annually}
                        <li><a href="javascript:;" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually}class="active"{/if} onclick="toggleBillingTabsVps(this,'annually');">{$LANG.orderpaymenttermannually}</a></li>
                      {/if}
                      {if $productsDataCycles.biennially}
                        <li><a href="javascript:;" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && !$productsDataCycles.annually}class="active"{/if} onclick="toggleBillingTabsVps(this,'biennially');">{$LANG.orderpaymenttermbiennially}</a></li>
                      {/if}
                      {if $productsDataCycles.triennially}
                        <li><a href="javascript:;" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && !$productsDataCycles.annually && !$productsDataCycles.biennially}class="active"{/if} onclick="toggleBillingTabsVps(this,'triennially');">{$LANG.orderpaymenttermtriennially}</a></li>
                      {/if}
                </ul>
              {/if}
          </div>
          <div class="price_group {if $productsDataCount eq '1'}single-product-slider{elseif $productsDataCount eq '2'}double-product-slider{/if}">
            <div id="productList">
                {foreach from=$productsData item=productData}              
                    <div class="price_sect {if $productsDataCount eq '1' || $productsDataCount eq '2'}price-select-single-double{/if}">
                      {if $productsDataCount eq '1' || $productsDataCount eq '2'}
                        <div class="single-double-product-block">
                        <div>
                      {/if}
                      <h2>{$productData.name}</h2>
                      <p>{$productData.customDescription.pHeadSortDesc|unescape:'html'}</p>
                      {if $productsDataCycles.onetime}
                        <h5 class="blpr monthly" {if $productsDataCycles.onetime}style="display: block;"{/if}><strong>{$productData.pricing.monthly} </strong><span>{$LANG.orderpaymenttermonetime}</span></h5>
                      {/if}
                      {if $productsDataCycles.free}
                        <h5 class="blpr monthly" {if $productsDataCycles.free}style="display: block;"{/if}><strong>{$productData.pricing.free} </strong><span>{$LANG.orderpaymenttermfreeaccount}</span></h5>
                      {/if}
                      {if !$productsDataCycles.onetime || !$productsDataCycles.free}
                        <h5 class="blpr monthly" {if $productsDataCycles.monthly}style="display: block;"{/if}><strong>{$productData.pricing.monthly} </strong><span>{$LANG.orderpaymenttermmonthly}</span></h5>
                        <h5 class="blpr quarterly" {if !$productsDataCycles.monthly && $productsDataCycles.quarterly}style="display: block;"{/if}><strong>{$productData.pricing.quarterly}</strong> <span>{$LANG.orderpaymenttermquarterly}</span></h5>
                        <h5 class="blpr semiannually" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && $productsDataCycles.semiannually}style="display: block;"{/if}><strong>{$productData.pricing.semiannually}</strong> <span>{$LANG.orderpaymenttermsemiannually}</span></h5>
                        <h5 class="blpr annually" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && $productsDataCycles.annually}style="display: block;"{/if}><strong>{$productData.pricing.annually}</strong> <span>{$LANG.orderpaymenttermannually}</span></h5>
                        <h5 class="blpr biennially" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && !$productsDataCycles.annually && $productsDataCycles.biennially}style="display: block;"{/if}><strong>{$productData.pricing.biennially}</strong> <span>{$LANG.orderpaymenttermbiennially}</span></h5>
                        <h5 class="blpr triennially" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && !$productsDataCycles.annually && !$productsDataCycles.biennially && $productsDataCycles.triennially}style="display: block;"{/if}><strong>{$productData.pricing.triennially}</strong> <span>{$LANG.orderpaymenttermtriennially}</span></h5>
                      {/if}
                        {if $productsDataCount eq '1' || $productsDataCount eq '2'}
                          </div>
                          {$productData.customDescription.pDescription}
                          </div>
                        {else}
                          {$productData.customDescription.pDescription}
                        {/if}
                          <div class="bottom_sect">
                          {if $productsDataCount eq '1' || $productsDataCount eq '2'}
                            <div>
                          {/if}
                          <h4>{$productData.customDescription.pFootCaption|unescape:'html'}</h4>
                          <p>{$productData.customDescription.pFootSortDesc|unescape:'html'}</p>
                          {if $productsDataCount eq '1' || $productsDataCount eq '2'}
                            </div>
                          {/if}
                        {if $productsDataCycles.onetime}
                          <a href="cart.php?a=add&pid={$productData.pid}" class="button03 blpr monthly" {if $productsDataCycles.onetime}style="display: block;"{/if}>{$LANG.homeordernow}</a>
                        {/if}
                        {if $productsDataCycles.free}
                          <a href="cart.php?a=add&pid={$productData.pid}" class="button03 blpr monthly" {if $productsDataCycles.free}style="display: block;"{/if}>{$LANG.homeordernow}</a>
                        {/if}
                        {if !$productsDataCycles.onetime || !$productsDataCycles.free}
                          <a href="cart.php?a=add&pid={$productData.pid}&billingcycle=monthly" class="button03 blpr monthly" {if $productsDataCycles.monthly}style="display: block;"{/if}>{$LANG.homeordernow}</a>  
                          <a href="cart.php?a=add&pid={$productData.pid}&billingcycle=quarterly" class="button03 blpr quarterly" {if !$productsDataCycles.monthly && $productsDataCycles.quarterly}style="display: block;"{/if}>{$LANG.homeordernow}</a>  
                          <a href="cart.php?a=add&pid={$productData.pid}&billingcycle=semiannually" class="button03 blpr semiannually" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && $productsDataCycles.semiannually}style="display: block;"{/if}>{$LANG.homeordernow}</a>  
                          <a href="cart.php?a=add&pid={$productData.pid}&billingcycle=annually" class="button03 blpr annually" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && $productsDataCycles.annually}style="display: block;"{/if}>{$LANG.homeordernow}</a>
                          <a href="cart.php?a=add&pid={$productData.pid}&billingcycle=biennially" class="button03 blpr biennially"{if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && !$productsDataCycles.annually && $productsDataCycles.biennially}style="display: block;"{/if}>{$LANG.homeordernow}</a>
                          <a href="cart.php?a=add&pid={$productData.pid}&billingcycle=triennially" class="button03 blpr triennially" {if !$productsDataCycles.monthly && !$productsDataCycles.quarterly && !$productsDataCycles.semiannually && !$productsDataCycles.annually && !$productsDataCycles.biennially && $productsDataCycles.triennially}style="display: block;"{/if}>{$LANG.homeordernow}</a>
                        {/if} 						
                      </div>
                    </div>              
                {/foreach}
            </div>
          </div>
      </div>
    </div>
  </div>
  <div class="vat_col">{$LANG.cpanelvat}</div>
</div>