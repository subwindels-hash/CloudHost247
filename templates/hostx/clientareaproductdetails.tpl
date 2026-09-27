{if $modulecustombuttonresult}
    {if $modulecustombuttonresult == "success"}
        {include file="$template/includes/alert.tpl" type="success" msg=$LANG.moduleactionsuccess textcenter=true idname="alertModuleCustomButtonSuccess"}
    {else}
        {include file="$template/includes/alert.tpl" type="error" msg=$LANG.moduleactionfailed|cat:' ':$modulecustombuttonresult textcenter=true idname="alertModuleCustomButtonFailed"}
    {/if}
{/if}

{if $pendingcancellation}
    {include file="$template/includes/alert.tpl" type="error" msg=$LANG.cancellationrequestedexplanation textcenter=true idname="alertPendingCancellation"}
{/if}
{if $unpaidInvoice}
	<div class="row wgs-alter-info-cls">
		<div class="col-sm-12 wgs-alert-invc">
			<div class="alert alert-{if $unpaidInvoiceOverdue}danger{else}warning{/if}" id="alert{if $unpaidInvoiceOverdue}Overdue{else}Unpaid{/if}Invoice">
				<div class="pull-right">
					<a href="viewinvoice.php?id={$unpaidInvoice}" class="btn btn-xs btn-default">
						{lang key='payInvoice'}
					</a>
				</div>
				{$unpaidInvoiceMessage}
			</div>
		</div>
	</div>
{/if}
<div class="tab-content margin-bottom">
    <div class="tab-pane fade in active" id="tabOverview">
        {if $tplOverviewTabOutput}
            {$tplOverviewTabOutput}
        {else}
            <div class="product-details clearfix">
                <div class="row">
                    <div class="col-md-5">
                        <div class="active-domain {$status|lower}">
                         {if $status|lower eq 'active'}
                          <img src="templates/{$template}/images/cercle-icon.png" alt="">
                         {elseif $status|lower eq 'active' || $status|lower eq 'suspended' || $status|lower eq 'terminated' || $status|lower eq 'cancelled'  || $status|lower eq 'fraud'}
                          <img src="templates/{$template}/images/terminate.png" alt="">  
                         {else} 
                          <img src="templates/{$template}/images/pending-icon.png" alt="">  
                         {/if} 
                          <h2>{$product}</h2>
                          <h5>{$groupname}</h5>
                          <p><span>Status :</span> {$status}</p>
                          {if $showcancelbutton || $packagesupgrade}                            
                                {if $packagesupgrade}
                                        <a href="upgrade.php?type=package&amp;id={$id}" class="request upgrade">{$LANG.upgrade}</a>                                    
                                {/if}
                                {if $showcancelbutton}
                                        <a href="clientarea.php?action=cancel&amp;id={$id}" class="request {if $pendingcancellation}disabled{/if}">{if $pendingcancellation}{$LANG.cancellationrequested}{else}{$LANG.clientareacancelrequestbutton}{/if}</a>
                                    
                                {/if}                            
                        {/if}
                        </div>
                    </div>
                    <div class="col-md-7">
                        <div class="manage-detail">
                            <p><img src="templates/{$template}/images/d-icon1.png" alt=""><span> {$LANG.clientareahostingregdate}:</span> {$regdate}</p>
                            <p><img src="templates/{$template}/images/d-icon2.png" alt=""><span> {$LANG.clientareahostingnextduedate}:</span> {$nextduedate}</p>
                          {if $firstpaymentamount neq $recurringamount}
                            <p><img src="templates/{$template}/images/d-icon3.png" alt=""><span> {$LANG.firstpaymentamount}:</span>  {$firstpaymentamount}</p>
                          {/if}
                          {if $billingcycle != $LANG.orderpaymenttermonetime && $billingcycle != $LANG.orderfree}
                            <p><img src="templates/{$template}/images/d-icon4.png" alt=""><span> {$LANG.recurringamount}:</span> {$recurringamount}</p>
                          {/if}
						  {if $quantitySupported && $quantity > 1}
							<p><img src="templates/{$template}/images/d-icon-qty.png" alt=""><span> {lang key='quantity'}:</span> {$quantity}</p>
						  {/if}                          
                            <p><img src="templates/{$template}/images/d-icon3.png" alt=""><span> {$LANG.orderbillingcycle}:</span>  {$billingcycle}</p>
                            <p><img src="templates/{$template}/images/d-icon5.png" alt=""><span> {$LANG.orderpaymentmethod}:</span> {$paymentmethod}</p>
                          {if $suspendreason}
                            <p><img src="templates/{$template}/images/d-icon3.png" alt=""><span> {$LANG.suspendreason}:</span>  {$suspendreason}</p>
                          {/if}
                          {if $firstpaymentamount neq $recurringamount}
                             <p><img src="templates/{$template}/images/d-icon3.png" alt=""><span> {$LANG.firstpaymentamount}:</span>  {$firstpaymentamount}</p>
                          {/if}
                        </div>
                    </div>
                </div>

            </div>

            {foreach $hookOutput as $output}
                <div>
                    {$output}
                </div>
            {/foreach}

            {if $domain || $moduleclientarea || $configurableoptions || $customfields || $lastupdate}
                <div class="row clearfix">
                    <div class="col-xs-12">
                        <ul class="nav nav-tabs nav-tabs-overflow">
                            {if $domain}
                                <li class="active">
                                    <a href="#domain" data-toggle="tab"><i class="fas fa-globe fa-fw"></i> {if $type eq "server"}{$LANG.sslserverinfo}{elseif ($type eq "hostingaccount" || $type eq "reselleraccount") && $serverdata}{$LANG.hostingInfo}{else}{$LANG.clientareahostingdomain}{/if}</a>
                                </li>
                            {elseif $moduleclientarea}
                                <li class="active">
                                    <a href="#manage" data-toggle="tab"><i class="fas fa-globe fa-fw"></i> {$LANG.manage}</a>
                                </li>
                            {/if}
                            {if $configurableoptions}
                                <li{if !$domain && !$moduleclientarea} class="active"{/if}>
                                    <a href="#configoptions" data-toggle="tab"><i class="fas fa-cubes fa-fw"></i> {$LANG.orderconfigpackage}</a>
                                </li>
                            {/if}
                           {if $metricStats}
                                <li{if !$domain && !$moduleclientarea && !$configurableoptions} class="active"{/if}>
                                    <a href="#metrics" data-toggle="tab"><i class="fas fa-chart-line fa-fw"></i> {$LANG.metrics.title}</a>
                                </li>
                            {/if}
                            {if $customfields}
                                <li{if !$domain && !$moduleclientarea && !$metricStats && !$configurableoptions} class="active"{/if}>
                                    <a href="#additionalinfo" data-toggle="tab"><i class="fas fa-info fa-fw"></i> {$LANG.additionalInfo}</a>
                                </li>
                            {/if}

                            {if $lastupdate}
                                <li{if !$domain && !$moduleclientarea && !$configurableoptions && !$customfields} class="active"{/if}>
                                    <a href="#resourceusage" data-toggle="tab"><i class="fas fa-inbox fa-fw"></i> {$LANG.resourceUsage}</a>
                                </li>
                            {/if}
                        </ul>
                    </div>
                </div>
                <div class="tab-content product-details-tab-container">
                    {if $domain}
                        <div class="tab-pane fade in active text-center" id="domain">
                            {if $type eq "server"}
                                <div class="row">
                                    <div class="col-sm-5 text-right">
                                        <strong>{$LANG.serverhostname}</strong>
                                    </div>
                                    <div class="col-sm-7 text-left">
                                        {$domain}
                                    </div>
                                </div>
                                {if $dedicatedip}
                                    <div class="row">
                                        <div class="col-sm-5 text-right">
                                            <strong>{$LANG.primaryIP}</strong>
                                        </div>
                                        <div class="col-sm-7 text-left">
                                            {$dedicatedip}
                                        </div>
                                    </div>
                                {/if}
                                {if $assignedips}
                                    <div class="row">
                                        <div class="col-sm-5 text-right">
                                            <strong>{$LANG.assignedIPs}</strong>
                                        </div>
                                        <div class="col-sm-7 text-left">
                                            {$assignedips|nl2br}
                                        </div>
                                    </div>
                                {/if}
                                {if $ns1 || $ns2}
                                    <div class="row">
                                        <div class="col-sm-5 text-right">
                                            <strong>{$LANG.domainnameservers}</strong>
                                        </div>
                                        <div class="col-sm-7 text-left">
                                            {$ns1}<br />{$ns2}
                                        </div>
                                    </div>
                                {/if}
                            {elseif ($type eq "hostingaccount" || $type eq "reselleraccount") && $serverdata}
                                {if $domain}
                                    <div class="row">
                                        <div class="col-sm-5 text-right">
                                            <strong>{$LANG.orderdomain}</strong>
                                        </div>
                                        <div class="col-sm-7 text-left">
                                            {$domain}&nbsp;<a href="http://{$domain}" target="_blank" class="btn btn-default btn-xs" >{$LANG.visitwebsite}</a>
                                        </div>
                                    </div>
                                {/if}
                                {if $username}
                                    <div class="row">
                                        <div class="col-sm-5 text-right">
                                            <strong>{$LANG.serverusername}</strong>
                                        </div>
                                        <div class="col-sm-7 text-left">
                                            {$username}
                                        </div>
                                    </div>
                                {/if}
                                <div class="row">
                                    <div class="col-sm-5 text-right">
                                        <strong>{$LANG.servername}</strong>
                                    </div>
                                    <div class="col-sm-7 text-left">
                                        {$serverdata.hostname}
                                    </div>
                                </div>
                                <div class="row">
                                    <div class="col-sm-5 text-right">
                                        <strong>{$LANG.domainregisternsip}</strong>
                                    </div>
                                    <div class="col-sm-7 text-left">
                                        {$serverdata.ipaddress}
                                    </div>
                                </div>
                                {if $serverdata.nameserver1 || $serverdata.nameserver2 || $serverdata.nameserver3 || $serverdata.nameserver4 || $serverdata.nameserver5}
                                    <div class="row">
                                        <div class="col-sm-5 text-right">
                                            <strong>{$LANG.domainnameservers}</strong>
                                        </div>
                                        <div class="col-sm-7 text-left">
                                            {if $serverdata.nameserver1}{$serverdata.nameserver1} ({$serverdata.nameserver1ip})<br />{/if}
                                            {if $serverdata.nameserver2}{$serverdata.nameserver2} ({$serverdata.nameserver2ip})<br />{/if}
                                            {if $serverdata.nameserver3}{$serverdata.nameserver3} ({$serverdata.nameserver3ip})<br />{/if}
                                            {if $serverdata.nameserver4}{$serverdata.nameserver4} ({$serverdata.nameserver4ip})<br />{/if}
                                            {if $serverdata.nameserver5}{$serverdata.nameserver5} ({$serverdata.nameserver5ip})<br />{/if}
                                        </div>
                                    </div>
                                {/if}
                                {if $domain && $sslStatus}
                                    <div class="row">
                                        <div class="col-sm-5 text-right">
                                            <strong>{$LANG.sslState.sslStatus}</strong>
                                        </div>
                                        <div class="col-sm-7 text-left{if $sslStatus->isInactive()} ssl-inactive{/if}">
                                            <img src="{$sslStatus->getImagePath()}" width="12" data-type="service" data-domain="{$domain}" data-showlabel="1" class="{$sslStatus->getClass()}"/>
                                            <span id="statusDisplayLabel">
                                                {if !$sslStatus->needsResync()}
                                                    {$sslStatus->getStatusDisplayLabel()}
                                                {else}
                                                    {$LANG.loading}
                                                {/if}
                                            </span>
                                        </div>
                                    </div>
                                    {if $sslStatus->isActive() || $sslStatus->needsResync()}
                                        <div class="row">
                                            <div class="col-sm-5 text-right">
                                                <strong>{$LANG.sslState.startDate}</strong>
                                            </div>
                                            <div class="col-sm-7 text-left" id="ssl-startdate">
                                                {if !$sslStatus->needsResync() || $sslStatus->startDate}
                                                    {$sslStatus->startDate->toClientDateFormat()}
                                                {else}
                                                    {$LANG.loading}
                                                {/if}
                                            </div>
                                        </div>
                                        <div class="row">
                                            <div class="col-sm-5 text-right">
                                                <strong>{$LANG.sslState.expiryDate}</strong>
                                            </div>
                                            <div class="col-sm-7 text-left" id="ssl-expirydate">
                                                {if !$sslStatus->needsResync() || $sslStatus->expiryDate}
                                                    {$sslStatus->expiryDate->toClientDateFormat()}
                                                {else}
                                                    {$LANG.loading}
                                                {/if}
                                            </div>
                                        </div>
                                        <div class="row">
                                            <div class="col-sm-5 text-right">
                                                <strong>{$LANG.sslState.issuerName}</strong>
                                            </div>
                                            <div class="col-sm-7 text-left" id="ssl-issuer">
                                                {if !$sslStatus->needsResync() || $sslStatus->issuerName}
                                                    {$sslStatus->issuerName}
                                                {else}
                                                    {$LANG.loading}
                                                {/if}
                                            </div>
                                        </div>
                                    {/if}
                                {/if}
                            {else}
                                <p>
                                    {$domain}
                                </p>
                                <p>
                                    <a href="http://{$domain}" class="btn btn-default" target="_blank">{$LANG.visitwebsite}</a>
                                    {if $domainId}
                                        <a href="clientarea.php?action=domaindetails&id={$domainId}" class="btn btn-default" target="_blank">{$LANG.managedomain}</a>
                                    {/if}
                                </p>
                            {/if}
                            {if $moduleclientarea}
                                <div class="text-center module-client-area">
                                    {$moduleclientarea}
                                </div>
                            {/if}
                        </div>
                        {if $sslStatus}
                            <div class="tab-pane fade text-center" id="ssl-info">
                                {if $sslStatus->isActive()}
                                    <div class="alert alert-success" role="alert">
                                        {lang key='sslActive' expiry=$sslStatus->expiryDate->toClientDateFormat()}
                                    </div>
                                {else}
                                    <div class="alert alert-warning ssl-required" role="alert">
                                         {lang key='sslState.sslInactive'}
                                    </div>
                                {/if}
                            </div>
                        {/if}
                    {elseif $moduleclientarea}
                        <div class="tab-pane fade{if !$domain} in active{/if} text-center" id="manage">
                            {if $moduleclientarea}
                                <div class="text-center module-client-area">
                                    {$moduleclientarea}
                                </div>
                            {/if}
                        </div>
                    {/if}
                    {if $configurableoptions}
                        <div class="tab-pane fade{if !$domain && !$moduleclientarea} in active{/if} text-center" id="configoptions">
                            {foreach from=$configurableoptions item=configoption}
                                <div class="row">
                                    <div class="col-sm-5">
                                        <strong>{$configoption.optionname}</strong>
                                    </div>
                                    <div class="col-sm-7 text-left">
                                        {if $configoption.optiontype eq 3}{if $configoption.selectedqty}{$LANG.yes}{else}{$LANG.no}{/if}{elseif $configoption.optiontype eq 4}{$configoption.selectedqty} x {$configoption.selectedoption}{else}{$configoption.selectedoption}{/if}
                                    </div>
                                </div>
                            {/foreach}
                        </div>
                    {/if}

                    {if $metricStats}
                        <div class="tab-pane fade{if !$domain && !$moduleclientarea && !$configurableoptions} in active{/if}" id="metrics">
                            {include file="$template/clientareaproductusagebilling.tpl"}
                        </div>
                    {/if}

                    {if $customfields}
                        <div class="tab-pane fade{if !$domain && !$moduleclientarea && !$configurableoptions && !$metricStats} in active{/if} text-center" id="additionalinfo">
                            {foreach from=$customfields item=field}
                                <div class="row">
                                    <div class="col-sm-3">
                                        <strong>{$field.name} :</strong>
                                    </div>
                                    <div class="col-sm-8 text-left">
                                        {$field.value}
                                    </div>
                                </div>
                            {/foreach}
                        </div>
                    {/if}
                    {if $lastupdate}
                        <div class="tab-pane fade text-center" id="resourceusage">
                            <div class="col-sm-10 col-sm-offset-1">
                                <div class="col-sm-6">
                                    <h4>{$LANG.diskSpace}</h4>
                                    <input type="text" value="{$diskpercent|substr:0:-1}" class="dial-usage" data-width="100" data-height="100" data-min="0" data-readOnly="true" />
                                    <p>{$diskusage}MB / {$disklimit}MB</p>
                                </div>
                                <div class="col-sm-6">
                                    <h4>{$LANG.bandwidth}</h4>
                                    <input type="text" value="{$bwpercent|substr:0:-1}" class="dial-usage" data-width="100" data-height="100" data-min="0" data-readOnly="true" />
                                    <p>{$bwusage}MB / {$bwlimit}MB</p>
                                </div>
                            </div>
                            <div class="clearfix">
                            </div>
                            <p class="text-muted">{$LANG.clientarealastupdated}: {$lastupdate}</p>

                            <script src="{$BASE_PATH_JS}/jquery.knob.js"></script>
                            <script type="text/javascript">
                            jQuery(function() {ldelim}
                                jQuery(".dial-usage").knob({ldelim}'format':function (v) {ldelim} alert(v); {rdelim}{rdelim});
                            {rdelim});
                            </script>
                        </div>
                    {/if}
                </div>
            {/if}
            <script src="{$BASE_PATH_JS}/bootstrap-tabdrop.js"></script>
            <script type="text/javascript">
                jQuery('.nav-tabs-overflow').tabdrop();
            </script>

        {/if}

    </div>
    <div class="tab-pane fade in" id="tabDownloads">

        <h3>{$LANG.downloadstitle}</h3>

        {include file="$template/includes/alert.tpl" type="info" msg="{lang key="clientAreaProductDownloadsAvailable"}" textcenter=true}

        <div class="row">
            {foreach from=$downloads item=download}
                <div class="col-xs-10 col-xs-offset-1">
                    <h4>{$download.title}</h4>
                    <p>
                        {$download.description}
                    </p>
                    <p>
                        <a href="{$download.link}" class="btn btn-default"><i class="fas fa-download"></i> {$LANG.downloadname}</a>
                    </p>
                </div>
            {/foreach}
        </div>

    </div>
    <div class="tab-pane fade in" id="tabAddons">

        <h3>{$LANG.clientareahostingaddons}</h3>

        {if $addonsavailable}
            {include file="$template/includes/alert.tpl" type="info" msg="{lang key="clientAreaProductAddonsAvailable"}" textcenter=true}
        {/if}

        <div class="row">
            {foreach from=$addons item=addon}
                <div class="col-xs-10 col-xs-offset-1">
                    <div class="panel panel-default panel-accent-blue">
                        <div class="panel-heading">
                            {$addon.name}
                            <div class="pull-right status-{$addon.rawstatus|strtolower}">{$addon.status}</div>
                        </div>
                        <div class="row panel-body">
                            <div class="col-md-6">
                                <p>
                                    {$addon.pricing}
                                </p>
                                <p>
                                    {$LANG.registered}: {$addon.regdate}
                                </p>
                                <p>
                                    {$LANG.clientareahostingnextduedate}: {$addon.nextduedate}
                                </p>
                            </div>
                        </div>
                        <div class="panel-footer">
                            {$addon.managementActions}
                        </div>
                    </div>
                </div>
            {/foreach}
        </div>

    </div>
    <div class="tab-pane fade in" id="tabChangepw">
        <h3>{$LANG.serverchangepassword}</h3>
        {if $modulechangepwresult}
            {if $modulechangepwresult == "success"}
                {include file="$template/includes/alert.tpl" type="success" msg=$modulechangepasswordmessage textcenter=true}
            {elseif $modulechangepwresult == "error"}
                {include file="$template/includes/alert.tpl" type="error" msg=$modulechangepasswordmessage|strip_tags textcenter=true}
            {/if}
        {/if}
        <form class="form-horizontal using-password-strength" method="post" action="{$smarty.server.PHP_SELF}?action=productdetails#tabChangepw" role="form">
            <input type="hidden" name="id" value="{$id}" />
            <input type="hidden" name="modulechangepassword" value="true" />
			<div class="wgsrow">
				<div class="col-sm-8">
					<div class="form-group">
						<div id="newPassword1" class="has-feedback">
							<label for="inputNewPassword1">{$LANG.newpassword}</label>
								<input type="password" class="form-control" name="newpw" id="inputNewPassword1" autocomplete="off" />
								<span class="form-control-feedback glyphicon"></span>
								{include file="$template/includes/pwstrength.tpl"}
						</div>
					</div>
				</div>
				<div class="col-sm-4">
					<button type="button" class="btn generate-password wgs-button-gen-pwd" data-targetfields="inputNewPassword1,inputNewPassword2">
						{$LANG.generatePassword.btnLabel}
					</button>
				</div>
			</div>
			<div class="wgsrow">
				<div class="col-sm-8">
					<div class="form-group">
						<div id="newPassword2" class="has-feedback">
							<label for="inputNewPassword2">{$LANG.confirmnewpassword}</label>
								<input type="password" class="form-control" name="confirmpw" id="inputNewPassword2" autocomplete="off" />
								<span class="form-control-feedback glyphicon"></span>
								<div id="inputNewPassword2Msg"></div>
						</div>
					</div>
				</div>
			</div>
			<div class="row chpwv8">
				<div class="col-sm-12">
					<input class="btn wgs-submit-button" type="submit" value="{$LANG.clientareasavechanges}" />
					<input class="btn wgs-cancel-button" type="reset" value="{$LANG.cancel}" />
				</div>
			</div>
        </form>
    </div>
</div>
