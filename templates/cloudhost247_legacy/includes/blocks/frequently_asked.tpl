{if $hostx_blocks[$block_slug]}
  <div class="frequbntly_asked mt-5">
      <div class="container">

        <div class="top">
          <h2>{eval var=$hostx_blocks[$block_slug]->title}</h2>
          <h5>{eval var=$hostx_blocks[$block_slug]->sub_title}</h5>
        </div>
        <div class="clearfix"></div>

       {foreach $hostx_blocks[$block_slug]->widgets as $k =>  $widget}
        <div class="question_answers">
            <span>{if $k < 10}0{/if}{($k+1)}</span>
            <a class="question" href="javascript:;" data="#collapse_{$k}" role="button" aria-expanded="false" aria-controls="collapse_{$k}">{eval var=$widget->widget_title}
              <span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
            </a> 
            <div class="collapse" id="collapse_{$k}">
               {eval var=$widget->widget_description|html_entity_decode}
            </div>
        </div>
       {/foreach}
      </div>
  </div>
{else}
  <div class="frequbntly_asked mt-5">
      <div class="container">

        <div class="top">
          <h2>{$LANG.domainfrequentlyask}</h2>
          <h5>{$LANG.domainquesanss}</h5>
        </div>
        <div class="clearfix"></div>

        <div class="question_answers">
            <span>01</span>
            <a class="question" href="javascript:;" data="#collapseExample_" role="button" aria-expanded="false" aria-controls="collapseExample_">{$LANG.domainque1}
              <span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
            </a> 
            <div class="collapse" id="collapseExample_">
              {$LANG.domainqueans}
            </div>
        </div>
        <div class="question_answers">
            <span>02</span>
            <a class="question" href="javascript:;" data="#collapseExample1_" role="button" aria-expanded="false" aria-controls="collapseExample1_">{$LANG.domainque2}
              <span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
            </a> 
            <div class="collapse" id="collapseExample1_">
              {$LANG.domainqueans}
            </div>
        </div> 
        <div class="question_answers">
            <span>03</span>
            <a class="question" href="javascript:;" data="#collapseExample2_" role="button" aria-expanded="false" aria-controls="collapseExample2_">{$LANG.domainque3}
              <span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
            </a> 
            <div class="collapse" id="collapseExample2_">
              {$LANG.domainqueans}
            </div>
        </div>
        <div class="question_answers">
            <span>04</span>
            <a class="question" href="javascript:;" data="#collapseExample3_" role="button" aria-expanded="false" aria-controls="collapseExample3_">{$LANG.domainque4}
              <span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
            </a> 
            <div class="collapse" id="collapseExample3_">
              {$LANG.domainqueans}
            </div>
        </div>

      </div>
  </div>
{/if}