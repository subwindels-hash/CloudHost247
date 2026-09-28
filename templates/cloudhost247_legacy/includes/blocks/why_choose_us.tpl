{if $hostx_blocks[$block_slug]}
<div id="choose" class="choose_section">
  <div class="container">
    <h2>{eval var=$hostx_blocks[$block_slug]->title}</h2>
    <p> {eval var=$hostx_blocks[$block_slug]->sub_title}</p>
        {eval var=$hostx_blocks[$block_slug]->description}
  </div>
</div>
<div class="tab-content" id="myTabContent">
  {foreach $hostx_blocks[$block_slug]->widgets as $widget}
          {eval var=$widget->widget_description|html_entity_decode}
  {/foreach} 
</div>
{else}
<div id="choose" class="choose_section">
  <div class="container">
    <h2>{$LANG.cpanelwhychoose}?</h2>
    <p>{$LANG.cpanelchallengin}.</p>
     <ul class="nav tab">
  <li><a class="nav-link active" data-toggle="tab" href="#tab1"><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon007.svg" alt="svg icon">  {$LANG.cpanelinfratechno}</a></li>
  <li><a class="nav-link" data-toggle="tab" href="#tab2"><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon008.svg" alt="svg-icon"> {$LANG.cpanelfreeclickintalls}</a></li>
  <li><a class="nav-link" data-toggle="tab" href="#tab3"><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon009.svg" alt="svg-icon"> {$LANG.cpanelsslcertificate}</a></li>
  <li><a class="nav-link" data-toggle="tab" href="#tab4"><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon010.svg" alt="svg icon"> {$LANG.headersupport}</a></li>   
  </ul> 
  </div>
</div>

<div class="tab-content" id="myTabContent"> 

  <div class="tab-pane active" id="tab1" role="tabpanel" aria-labelledby="tab1">
  	<div class="cloud_hosting">
  	  <div class="container">
  	    <div class="cloud_hosting_in">
  	    <div class="row">
  	      <div class="col-sm-6">
  	        <div class="left">
  	          <h2>{$LANG.cpanelultrahosting}</h2>
  	          <p>{$LANG.cpanelcloudsimplicity}</p>
  	          <div class="hosting_list">
  	          <ul>
  	            <li>{$LANG.cpaneldualprocess}</li>
  	            <li>24GB {$LANG.cpanelram}</li>
  	            <li>24x7x365 {$LANG.cpanelSupport}</li>
  	            <li>250GB {$LANG.cpanelraidos}</li>
  	            <li>1TB {$LANG.cpanelcacheddrive}</li>
  	            <li>{$LANG.cpanelapache} 2.2x</li>
  	            <li>{$LANG.cpanelphpversion}</li>
  	            <li>{$LANG.cpanelfreednsmanage}</li>
  	          </ul>
  	          <ul>
  	            <li>{$LANG.cpanelmysql} 5</li>
  	            <li>{$LANG.cpanelrubyrail}</li>
  	            <li>{$LANG.cpanelantiprotect}</li>
  	            <li>{$LANG.cpanelsecureftp}</li>
  	            <li>{$LANG.cpanelleechprotect}</li>
  	            <li>{$LANG.cpanelphpmyadmin}</li>
  	            <li>{$LANG.cpanelemailaddress}</li>
  	            <li>{$LANG.cpanelvarnishcach}</li>
  	          </ul>
  	        </div>
  	        </div>
  	      </div>
  	      <div class="col-sm-6">
  	        <div class="right">
  	          <div class="row">  
  	            <div class="col-sm-6">
  	          <div class="hosting_box" style="background-image: url({$WEB_ROOT}/templates/{$template}/images/img001.png);">
  	            <img src="{$WEB_ROOT}/templates/{$template}/images/icon011.svg" alt="clock image">
  	            <h2>{$LANG.cpanelreliablepower} </h2>
  	            <p>{$LANG.cpaneluninterrup}</p>
  	          </div>
  	          <div class="hosting_box mt-3" style="background-image: url({$WEB_ROOT}/templates/{$template}/images/img002.png);">
  	            <img src="{$WEB_ROOT}/templates/{$template}/images/icon012.svg" alt="lock settings">
  	            <h2>{$LANG.cpanelnetworksecurity}</h2>
  	            <p>{$LANG.cpanelmustability}</p>
  	          </div>
  	        </div>
  	        <div class="col-sm-6 justify-content-center d-flex pl-0">
  	          <div class="hosting_box" style="background-image: url({$WEB_ROOT}/templates/{$template}/images/img003.png);"> 
  	            <img src="{$WEB_ROOT}/templates/{$template}/images/icon013.svg" alt="safe and secure"> 
  	            <h2>{$LANG.cpanelhvacprotection}</h2>
  	            <p>{$LANG.cpanelresilience}</p>
  	          </div>
  	        </div>
  	          </div>
  	        </div>
  	      </div>
  	    </div></div>
  	  </div>
  	</div>
  </div>

  <div class="tab-pane" id="tab2" role="tabpanel" aria-labelledby="tab2">
    <div class="install">
      <div class="container">
        <div class="row">
          <div class="col-sm-4">
            <div class="left">
            <img src="{$WEB_ROOT}/templates/{$template}/images/csm-icon.png" alt="CMS Icons">          
          </div>
          </div>
            <div class="col-sm-8">
              <div class="right">
                <h2>{$LANG.cpanelinstallapp}</h2>
                <p>{$LANG.cpanelinstallapptext}.</p>
               <a href="#">{$LANG.cpaneloneclickapp}</a> 
              </div>
            </div>
        </div>
      </div>
    </div>
  </div>


  <div class="tab-pane" id="tab3" role="tabpanel" aria-labelledby="tab3">  
    <div class="clearfix"></div>
      <div class="certificate">
        <div class="container">
          <div class="row">
            <div class="col-sm-5">
              <div class="left text-right">
                <img src="{$WEB_ROOT}/templates/{$template}/images/img004.png" alt="ssl certificate">
              </div>
            </div>
            <div class="col-sm-7">
              <div class="right">
                <h4>{$LANG.cpanelsitesecure}</h4>
                <h2>{$LANG.cpanelfreessl}!</h2>
                <p>{$LANG.cpanelfreessltext}.</p>
                <a href="#" class="button03">{$LANG.cpanelgetout}</a>
              </div>
            </div>
          </div>
        </div>
      </div> 
  </div>

   <div class="tab-pane" id="tab4" role="tabpanel" aria-labelledby="tab4"> 
      <div class="secure_col">
        <div class="container">
          <div class="row">
            <div class="col-sm-5"> 
              
                <img src="{$WEB_ROOT}/templates/{$template}/images/banner-logo.png" alt="theme logo">
                <h2>{$LANG.cpanelyoulove}</h2>
                <p>{$LANG.cpanelyoulovetext}.</p>
       
            </div>
            <div class="col-sm-12"> 
              <div class="row">
              <div class="col-sm-6">
                <h5>{$LANG.cpanelactivebackup}:</h5>
                <h4>+1(929)8002575</h4>
              </div>
              <div class="col-sm-5">
                <div class="secure-box">
                  <div class="secure-box1">
                      <img src="{$WEB_ROOT}/templates/{$template}/images/icon-01.svg" class="svg" alt="svg icon">
                      <h6>{$LANG.cpaneltext}</h6> 
                  </div>
                  <div class="secure-box1">
                      <img src="{$WEB_ROOT}/templates/{$template}/images/icon-02.svg" class="svg" alt="svg icon">
                      <h6>{$LANG.cpanelchat}</h6>  
                  </div>
                  <div class="secure-box1">
                      <img src="{$WEB_ROOT}/templates/{$template}/images/icon-03.svg" class="svg" alt="svg icon">
                      <h6>{$LANG.cpanelphone}</h6>   
                  </div>
                </div>
              </div>
              </div>
            </div>
          </div>
        </div>
      </div>
   </div>
   
</div>
{/if}