{if $hostx_blocks[$block_slug]}
  <div class="frequbntly_asked frequbntly_asked1">
    <div class="container">
      <div class="top">
        <h2>{eval var=$hostx_blocks[$block_slug]->title}</h2> 
      </div>
      <div class="clearfix"></div>
       {foreach $hostx_blocks[$block_slug]->widgets as $k =>  $widget}
          <div class="question_answers">
            <a class="question" href="javascript:;" data="#collapseExample_{$k}" role="button" aria-expanded="false" aria-controls="collapseExample_{$k}">{eval var=$widget->widget_title}
                <span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
            </a> 
            <div class="collapse" id="collapseExample_{$k}">
                 {eval var=$widget->widget_description|html_entity_decode}
            </div>
          </div>
      {/foreach}

    </div>
  </div>
{else}
<div class="frequbntly_asked frequbntly_asked1">
  <div class="container">
    <div class="top">
      <h2>{$LANG.vpsaskque}</h2> 
    </div>

    <div class="clearfix"></div>

    <div class="question_answers">
      <a class="question" href="javascript:;" data="#collapseExample" role="button" aria-expanded="false" aria-controls="collapseExample">{$LANG.domainque1}
          <span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
      </a> 
      <div class="collapse" id="collapseExample">
           {$LANG.domainqueans}
      </div>
    </div>
    
    <div class="question_answers">
         
        <a class="question" href="javascript:;" data="#collapseExample1" role="button" aria-expanded="false" aria-controls="collapseExample">{$LANG.domainque2}
          <span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
        </a> 
        <div class="collapse" id="collapseExample1">
          {$LANG.domainqueans}
        </div>
    </div> 

    <div class="question_answers">
          
        <a class="question" href="javascript:;" data="#collapseExample2" role="button" aria-expanded="false" aria-controls="collapseExample">{$LANG.domainque3}
          <span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
        </a> 
        <div class="collapse" id="collapseExample2">
           {$LANG.domainqueans}
        </div>
    </div>

    <div class="question_answers">
      <a class="question" href="javascript:;" data="#collapseExample3" role="button" aria-expanded="false" aria-controls="collapseExample">{$LANG.domainque4}
        <span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
      </a> 
      <div class="collapse" id="collapseExample3">
         {$LANG.domainqueans}
      </div>
    </div>
  </div>
</div>
{/if}