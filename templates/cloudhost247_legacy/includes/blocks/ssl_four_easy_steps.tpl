{if $hostx_blocks[$block_slug]}
<div class="about-why-choose-us ssl-certification">
        <div class="container">
          <div class="row choose-us-row">
            <div class="col-sm-12">
              <h2>{eval var=$hostx_blocks[$block_slug]->title}</h2>
              <p>{eval var=$hostx_blocks[$block_slug]->sub_title}</p>
            </div>
          </div>
          <div class="row choose-us-row-two">
          {foreach $hostx_blocks[$block_slug]->widgets as $widget}
             {eval var=$widget->widget_description|html_entity_decode}
          {/foreach}
          </div>
       </div>
</div>
{else}
<div class="about-why-choose-us ssl-certification">
        <div class="container">
          <div class="row choose-us-row">
            <div class="col-sm-12">
              <h2>{$LANG.sslPageEasyStepHead}</h2>
              <p>{$LANG.sslPageEasyStepHeadP}</p>
            </div>
          </div>
          <div class="row choose-us-row-two">
            <div class="col-sm-3">
               <div class="why-choose-inner-abt border-light-blue">
                <span>{$LANG.sslPageEasyStepBox1Span}</span>
                <img src="{$WEB_ROOT}/templates/{$template}/images/ssl-icon-1.png" alt="ssl icon">
                 <h5>{$LANG.sslPageEasyStepBox1H5}</h5>
                 <p>{$LANG.sslPageEasyStepBox1P}</p>
               </div>
            </div>
            <div class="col-sm-3">
               <div class="why-choose-inner-abt  border-yellow">
                <span>{$LANG.sslPageEasyStepBox2Span}</span>
                <img src="{$WEB_ROOT}/templates/{$template}/images/ssl-icon-2.png" alt="point click">
                 <h5>{$LANG.sslPageEasyStepBox2H5}</h5>
                 <p>{$LANG.sslPageEasyStepBox2P}</p>
               </div>
            </div>
            <div class="col-sm-3">
               <div class="why-choose-inner-abt  border-light-yellow">
                <span>{$LANG.sslPageEasyStepBox3Span}</span>
                <img src="{$WEB_ROOT}/templates/{$template}/images/ssl-icon-3.png" alt="code icon">
                 <h5>{$LANG.sslPageEasyStepBox3H5}</h5>
                 <p>{$LANG.sslPageEasyStepBox3P}</p>
               </div>
            </div>
            <div class="col-sm-3">
               <div class="why-choose-inner-abt sky-blue-border">
                <span>{$LANG.sslPageEasyStepBox4Span}</span>
                <img src="{$WEB_ROOT}/templates/{$template}/images/ssl-icon-4.png" alt="ssl icon">
                 <h5>{$LANG.sslPageEasyStepBox4H5}</h5>
                 <p>{$LANG.sslPageEasyStepBox4P}</p>
               </div>
            </div>
          </div>
       </div>
</div>
{/if}