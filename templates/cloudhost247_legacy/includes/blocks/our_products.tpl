{if $hostx_blocks[$block_slug]}
<div class="features-option2 features-option3">
  <div class="container">
    <div class="top">
      <h2>{eval var=$hostx_blocks[$block_slug]->title}</h2>
       <p>{eval var=$hostx_blocks[$block_slug]->sub_title}</p>
    </div>
    <div class="clearfix"></div>
    <div class="row mouse-leave-div">
      {foreach $hostx_blocks[$block_slug]->widgets as $widget}
          {eval var=$widget->widget_description|html_entity_decode}
      {/foreach}
    </div>  
  </div>
</div>
{else}
<div class="features-option2 features-option3">
  <div class="container">
    <div class="top">
      <h2>{$LANG.homeourproducts}</h2>
      <p>{$LANG.homeourproductstext}.</p>
    </div>
    <div class="clearfix"></div>
    <div class="row mouse-leave-div">
      <div class="col-sm-4">
        <div class="features-col active"> 
          <div class="img-box">
            <img class="" src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/icon-a1.svg" alt="cloud server"></div>
            <h3>{$LANG.homevpshosting}</h3>
            <p>{$LANG.homevpshostingtext}. </p>
          
        </div>
      </div>
      <div class="col-sm-4">
        <div class="features-col">
          <div class="img-box">
            <img class="" src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/icon-a2.svg" alt="server"></div>
            <h3>{$LANG.homevirtualserver}</h3>
            <p>{$LANG.homevirtualservertext}</p>
          
        </div>
      </div>
      <div class="col-sm-4">
        <div class="features-col">
          <div class="img-box">
            <img class=" box-svg" src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/icon-a3.svg" alt="cloud server"></div>
            <h3>{$LANG.headerwebhosting}</h3>
            <p>{$LANG.homewebhostcert}.</p>
          
        </div>
      </div>
      <div class="col-sm-4">
        <div class="features-col">
          <div class="img-box">
            <img class="" src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/icon-a4.svg" alt="database"></div>
            <h3>{$LANG.homesharehost}</h3>
            <p>{$LANG.homesharehosttext}</p>
          
        </div>
      </div>
      <div class="col-sm-4">
        <div class="features-col">
          <div class="img-box">
            <img class=" raid" src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/icon-a5.svg" alt="wordpress logo"></div>
            <h3>{$LANG.homewordpresshosting}</h3>
            <p>{$LANG.homewordpresshostingtext}. </p>
          
        </div>
      </div>
      <div class="col-sm-4">
        <div class="features-col">
          <div class="img-box">
            <img class="" src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/icon-a6.svg" alt="cloud icon"></div>
            <h3>{$LANG.homecloudhosting}</h3>
            <p>{$LANG.homecloudhostingtext}.</p>
        </div>
      </div>  
    </div>
  </div>
</div>
{/if}
<script>
jQuery(document).ready(function(){
	jQuery(".features-option3").find(".features-col").eq(0).addClass("firstActiveClass");
	jQuery(".features-col").mouseover(function(){
	   if(!jQuery(this).hasClass("firstActiveClass")){
			jQuery(".features-option3").find(".features-col").eq(0).removeClass("firstActiveClass");
	   }
	});
	jQuery(".mouse-leave-div").mouseout(function() {
		jQuery(".features-option3").find(".features-col").eq(0).addClass("firstActiveClass");
	});
});
</script>