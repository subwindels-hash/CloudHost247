<!--  frequently-questions-->
{if $hostx_blocks[$block_slug]}
<div class="frequently-questions">
        <div class="container">
          <div class="row frequently-questions-row">
            <h2>{eval var=$hostx_blocks[$block_slug]->title|html_entity_decode}</h2>
              <div class="col-sm-12">
               <div class="accordion-container-main">
                   <!--Accordion wrapper-->
                      <div class="accordion md-accordion" id="accordionEx1" role="tablist" aria-multiselectable="true">
                          <!-- Accordion card -->
                          {foreach $hostx_blocks[$block_slug]->widgets  as $key =>  $widget}
                          <div class="card">
                            <!-- Card header -->
                            <div class="card-header" role="tab" id="headingTwo{$key}">
                              <a class="collapsed card-anchor" data-toggle="collapse" data-parent="#accordionEx1" 
                                aria-expanded="false" aria-controls="collapseTwo1">
                                <h5 class="mb-0">{eval var=$widget->widget_title}</h5>
                              </a>
                            </div>
                            <!-- Card body -->
                            <div id="collapse{$key}" class="collapse card-body-new" role="tabpanel" aria-labelledby="headingTwo{$key}" data-parent="#accordionEx1">
                              <div class="card-body">
                                {eval var=$widget->widget_description|html_entity_decode}
                              </div>
                            </div>
                          </div>
                          {/foreach}
                          <!-- Accordion card -->
                      </div>
                    <!-- Accordion wrapper -->
               </div>
              </div>
          </div>
       </div>
</div>
{else}
<div class="frequently-questions">
        <div class="container">
          <div class="row frequently-questions-row">
            <h2>{$LANG.sslPageFaqHead}</h2>
              <div class="col-sm-12">
               <div class="accordion-container-main">
                   <!--Accordion wrapper-->
                      <div class="accordion md-accordion" id="accordionEx1" role="tablist" aria-multiselectable="true">
                          <!-- Accordion card -->
                          <div class="card">
                            <!-- Card header -->
                            <div class="card-header" role="tab" id="headingTwo1">
                              <a class="collapsed" data-toggle="collapse" data-parent="#accordionEx1" href="#collapseTwo"
                                aria-expanded="false" aria-controls="collapseTwo">
                                <h5 class="mb-0">{$LANG.sslPageFaqAccord1Head}</h5>
                              </a>
                            </div>
                            <!-- Card body -->
                            <div id="collapseTwo" class="collapse card-body-new" role="tabpanel" aria-labelledby="headingTwo1" data-parent="#accordionEx1">
                              <div class="card-body">{$LANG.sslPageFaqAccord1Body}</div>
                            </div>
                          </div>
                          <!-- Accordion card -->
                          <div class="card current">
                            <!-- Card header -->
                            <div class="card-header" role="tab" id="headingTwo2">
                              <a class="collapsed" data-toggle="collapse" data-parent="#accordionEx1" href="#collapseTwo1"
                                aria-expanded="false" aria-controls="collapseTwo1">
                                <h5 class="mb-0">{$LANG.sslPageFaqAccord2Head}</h5>
                              </a>
                            </div>
                            <!-- Card body -->
                            <div id="collapseTwo1" class="collapse card-body-new" role="tabpanel" aria-labelledby="headingTwo2" data-parent="#accordionEx1">
                              <div class="card-body">{$LANG.sslPageFaqAccord2Body}</div>
                            </div>
                          </div>
                          <!-- Accordion card -->
                          <div class="card">
                            <!-- Card header -->
                            <div class="card-header" role="tab" id="headingTwo3">
                              <a class="collapsed" data-toggle="collapse" data-parent="#accordionEx1" href="#collapseThree"
                                aria-expanded="false" aria-controls="collapseThree">
                                <h5 class="mb-0">{$LANG.sslPageFaqAccord3Head}</h5>
                              </a>
                            </div>
                            <!-- Card body -->
                            <div id="collapseThree" class="collapse card-body-new" role="tabpanel" aria-labelledby="headingTwo3" data-parent="#accordionEx1">
                              <div class="card-body">{$LANG.sslPageFaqAccord3Body}</div>
                            </div>
                          </div>
                          <!-- Accordion card -->
                          <div class="card">
                            <!-- Card header -->
                            <div class="card-header" role="tab" id="headingTwo4">
                              <a class="collapsed" data-toggle="collapse" data-parent="#accordionEx1" href="#headingfour"
                                aria-expanded="false" aria-controls="headingfour">
                                <h5 class="mb-0">{$LANG.sslPageFaqAccord4Head}</h5>
                              </a>
                            </div>
                            <!-- Card body -->
                            <div id="headingfour" class="collapse card-body-new" role="tabpanel" aria-labelledby="headingTwo4" data-parent="#accordionEx1">
                              <div class="card-body">{$LANG.sslPageFaqAccord4Body}</div>
                            </div>
                          </div>
                          <!-- Accordion card -->
                          <div class="card">
                            <!-- Card header -->
                            <div class="card-header" role="tab" id="headingTwo5">
                              <a class="collapsed" data-toggle="collapse" data-parent="#accordionEx1" href="#collapsefive"
                                aria-expanded="false" aria-controls="collapsefive">
                                <h5 class="mb-0">{$LANG.sslPageFaqAccord5Head}</h5>
                              </a>
                            </div>
                            <!-- Card body -->
                            <div id="collapsefive" class="collapse card-body-new" role="tabpanel" aria-labelledby="headingTwo5" data-parent="#accordionEx1">
                              <div class="card-body">{$LANG.sslPageFaqAccord5Body}</div>
                            </div>
                          </div>
                          <!-- Accordion card -->
                      </div>
                    <!-- Accordion wrapper -->
               </div>
              </div>
          </div>
       </div>
</div>
{/if}

  <script>
    jQuery('.card').on('click', function(){
		if(!jQuery(this).hasClass("current")){
			jQuery(".card.current").find('.card-anchor').toggleClass('collapsed');
			jQuery(".card.current").find(".card-body-new").slideToggle();
			jQuery(".card").removeClass("current");
		}
		jQuery(this).toggleClass('current');
		jQuery(this).find('.card-anchor').toggleClass('collapsed');		
		jQuery(this).find(".card-body-new").slideToggle();
   }); 
</script>
<!--  frequently-questions-->