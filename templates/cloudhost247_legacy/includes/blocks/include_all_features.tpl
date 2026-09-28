{if $hostx_blocks[$block_slug]}
{assign var=imageArrays value=['1'=>'ddos-icon.svg','2'=>'rpn.svg','3'=>'icon05.svg','4'=>'kvm-over-ip.svg','5'=>'rpn1.svg','6'=>'support.svg','7'=>'certified-datacenter.svg','8'=>'premium-network.svg']}
{assign var=altArrays value=['1'=>'ddos icon','2'=>'lock icon','3'=>'svg icons','4'=>'user settings','5'=>'raid icon','6'=>'24*7 Support','7'=>'datacenter','8'=>'network']}
<div class="features-option2">
    <div class="container">
	    <div class="top">
	      <h2>{eval var=$hostx_blocks[$block_slug]->title}</h2>
	          {eval var=$hostx_blocks[$block_slug]->description}
	    </div>
	    <div class="clearfix"></div>
	    <div class="row">
		 {$turnsImg = 1}
	     {foreach $hostx_blocks[$block_slug]->widgets as $widget}
	      <div class="col-sm-3">
	        <div class="features-col">
	          <div class="img-box">
	            <img class="svg {if $turnsImg eq '3'}box-svg{elseif $turnsImg eq '5'}raid{/if}" src="{$WEB_ROOT}/templates/{$template}/images/{$imageArrays.{$turnsImg}}" alt="{$altArrays.{$turnsImg}}"></div>
	            <h3>{eval var=$widget->widget_title}</h3>
	             {eval var=$widget->widget_description|html_entity_decode}
	        </div>
	      </div>
		  {$turnsImg = $turnsImg+1}
          {/foreach}
	    </div> 
    </div> 
</div>
{else}
<div class="features-option2">
    <div class="container">
	    <div class="top">
	      <h2>{$LANG.dedicatedfeature}</h2>
	      <p>{$LANG.dedicatedfeaturetext}</p>
	    </div>
	    <div class="clearfix"></div>
	    <div class="row">
	      <div class="col-sm-3">
	        <div class="features-col">
	          <div class="img-box">
	            <img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/ddos-icon.svg" alt="ddos icon"></div>
	            <h3>{$LANG.dedicatedddosprotect}</h3>
	            <p>{$LANG.dedicatedddosprotecttext}</p>
	        </div>
	      </div>
	      <div class="col-sm-3">
	        <div class="features-col">
	          <div class="img-box">
	            <img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/rpn.svg" alt="lock icon"></div>
	            <h3>{$LANG.dedicatedrpn} </h3>
	            <p>{$LANG.dedicatedrpntext}</p>
	        </div>
	      </div>
	      <div class="col-sm-3">
	        <div class="features-col">
	          <div class="img-box">
	            <img class="svg box-svg" src="{$WEB_ROOT}/templates/{$template}/images/icon05.svg" alt="svg icons"></div>
	            <h3>{$LANG.dedicatedvmware}</h3>
	            <p>{$LANG.dedicatedvmwaretext}</p>
	        </div>
	      </div>
	      <div class="col-sm-3">
	        <div class="features-col">
	          <div class="img-box">
	            <img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/kvm-over-ip.svg" alt="user settings"></div>
	            <h3>{$LANG.dedicatedkvmip}</h3>
	            <p>{$LANG.dedicatedkvmiptext}</p>
	        </div>
	      </div>
	      <div class="col-sm-3">
	        <div class="features-col">
	          <div class="img-box">
	            <img class="svg raid" src="{$WEB_ROOT}/templates/{$template}/images/rpn1.svg" alt="raid icon"></div>
	            <h3>{$LANG.dedicatedraid}</h3>
	            <p>{$LANG.dedicatedraidtext}</p>          
	        </div>
	      </div>
	      <div class="col-sm-3">
	        <div class="features-col">
	          <div class="img-box">
	            <img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/support.svg" alt="24*7 Support"></div>
	            <h3>{$LANG.dedicatesupport}</h3>
	            <p>{$LANG.dedicatesupporttext}</p>
	        </div>
	      </div>
	      <div class="col-sm-3">
	        <div class="features-col">
	          <div class="img-box">
	            <img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/certified-datacenter.svg" alt="datacenter"></div>
	            <h3>{$LANG.dedicatecertifiedcenter}</h3>
	            <p>{$LANG.dedicatecertifiedcentertext}</p>
	        </div>
	      </div>
	      <div class="col-sm-3">
	        <div class="features-col">
	          <div class="img-box"> 
	            <img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/premium-network.svg" alt="network"></div>
	            <h3>{$LANG.dedicatedpremiumnetwork} </h3>
	            <p>{$LANG.dedicatedpremiumnetworktext}</p>
	        </div>
	      </div>
	    </div> 
    </div> 
</div>
{/if}