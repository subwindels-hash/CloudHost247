<div class="pricing_section">
    <div class="container">
        <div class="tab-content">
          <div class="tab-pane container active" id="pricing">
              <div class="price_group">
                <div id="productList">
        		      {foreach from=$secondHomePageProductData item=homePageSData}
                      <div class="price_sect">            
                          <h2>{$homePageSData.pHomeServiceName}</h2>
                      <div class="priceSecondBox">
                      <p>{$homePageSData.pHomeHeadSortDesc}</p>
                      <h5 class="blpr monthly d" style="display: block;" >{$homePageSData.pHomePrice}</h5>
                      </div>
                      <div class="descSecondBox">
                        {$homePageSData.pHomeDescription}
                      </div>
                      <div class="bottom_sect">
              					<div class="captionSecondBox">
              						<h4>{$homePageSData.pHomeFootCaption}</h4>
              					</div>
              					<div class="sortDescSecondBox">
              						<p>{$homePageSData.pHomeFootSortDesc}</p>
              					</div>
              						<a href="{$homePageSData.pHomeLink}" class="button03 blpr monthly" style="display: block;">{$homePageSData.pHomeButtonName}</a>  
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