<div class="dedicated_servers">
  <div class="container">
    <div class="dedicated_servers_top"> 
      <h2>{$LANG.dedicatedserver}</h2>
      <p>{$LANG.dedicatedservertext} </p>
    </div>
    <div class="clearfix"></div>
    <div class="row" >
      <div class="col-sm-3" id="filters-row" >
        <div class="left" >
          <div class="filters_box">
            <h2>{$LANG.cpanelserverlocation}</h2> 
             <div class="dropdown">
                  <button type="button" class="btn btn-primary dropdown-toggle" data-toggle="dropdown">
                    <span id="sLocation"> {$LANG.dedicatedSideBarRegions} </span>
                  </button>
                  <div class="dropdown-menu dedicateelocation" id="locationList">
                    <a class="dropdown-item" href="javascript:;" data-value="" > {$LANG.dedicatedSideBarRegionsMenu} </a>
                    {foreach from=$location_options key=locale_code item=location}
                      <a class="dropdown-item" href="javascript:;" data-value="{$locale_code}" ><img src="{$WEB_ROOT}/templates/{$template}/flags/blank.gif" class="flag flag-{$locale_code}" alt="{$LANG.cpanelcountry1}" /> {$location}</a>
                    {/foreach}
                </div>
            </div> 
          </div>
     
          {if count($product_groups) > 0}
            <div class="filters_box">
              <h2>{$LANG.dedicatedSideBarServices}</h2>
              {foreach from=$product_groups item=group}
                {if $currentPage eq $group->pageTitle }
                <label class="custom_checkbox">
                  <input type="checkbox" class="groups default" value="{$group->id}" checked="true" > <span></span>{$group->name}
                </label>
                {else}
                 <label class="custom_checkbox">
                  <input type="checkbox" class="groups" value="{$group->id}" > <span></span>{$group->name}
                </label>
                {/if}
              {/foreach}
            </div>
          {/if}

          <div class="filters_box">
            <h2>{$LANG.dedicatedSideBarPriceRange} {$hxselectedcurrency.prefix}</h2> 
            <div class="range_slider">
              <input id="price_filter" /> 
            </div>
          </div> 

          <div class="filters_box"> 
            <h2>{$LANG.dedicatedSideBarRam}</h2>  
            <div class="range_slider">
              <input id="ram_filter" /> 
            </div>
          </div>

          <div class="filters_box" id="disk_filter"> 
            <h2>{$LANG.dedicatedSideBarDisk}</h2>
      			{foreach from=$harddisk_options item=hddoption}
                  <label class="custom_checkbox">
                  <input value="{$hddoption}" type="checkbox"> <span></span> {$hddoption|Upper}</label>
      			{/foreach}
          </div>
        </div>
      </div>
      <div class="col-sm-9">
        <div class="right">
          <div class="results">
           
          </div>
          <div id="result-container">
            
          </div>
        </div>
      </div>
    </div>
  </div> 
</div> 