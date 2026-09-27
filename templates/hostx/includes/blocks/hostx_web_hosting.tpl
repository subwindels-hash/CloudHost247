<div class="price_list">
  <div class="container">
    <h2>{$companyNameWhmcs}</h2>
    <p>{$LANG.homehostxwebhosttext}</p>
    <div class="row">
		{$turnsCount = 1}
		{foreach from=$defaultHomePageProductData item=homePageDeData}
		  <div class="col-sm-3">
			<div class="price_grid">
			  <h2>{$homePageDeData.pHomeServiceName}</h2>
			  <div class="price_box pricehfirstbox">
				{if $turnsCount eq '4'}
					<div class="tag custom_paln">{$homePageDeData.pHomeHeadSortDesc}</div>
				{else}
				  <div class="tag"><img src="{$WEB_ROOT}/templates/{$template}/images/tag.svg" class="svg" alt="tag">{$homePageDeData.pHomeHeadSortDesc}</div>
				{/if}

		        {if $homePageDeData.pHomePrice eq 'Free'}
						<h4>{$homePageDeData.pHomePrice}</h4>
		        {else}
		        <h4>{$homePageDeData.pHomePrice}</h4>
		        {/if}
			  </div>
			  <div class="deschfirstbox">
				{$homePageDeData.pHomeDescription}
			  </div>
			  <div class="footcaptionhfirstbox">
				<h6>{$homePageDeData.pHomeFootCaption}</h6>
			  </div>
			  <div class="footsorthfirstbox">
				<p>{$homePageDeData.pHomeFootSortDesc}</p>
			  </div>
			  <a href="{$homePageDeData.pHomeLink}" class="button03">{$homePageDeData.pHomeButtonName}</a> 
			</div>
		  </div>
		  {$turnsCount = $turnsCount+1}
		{/foreach}
      </div>      
    </div>
  </div> 
</div>