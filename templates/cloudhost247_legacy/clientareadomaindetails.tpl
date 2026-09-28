<div class="domain_detail_page">
	<div class="shared-hosting">
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
	{if $registrarcustombuttonresult=="success"}
		<div class="row wgs-alter-info-cls">
			<div class="col-sm-12">
				{include file="$template/includes/alert.tpl" type="success" msg=$LANG.moduleactionsuccess textcenter=true}
			</div>
		</div>
	{elseif $registrarcustombuttonresult}
		<div class="row wgs-alter-info-cls">
			<div class="col-sm-12">
				{include file="$template/includes/alert.tpl" type="error" msg=$LANG.moduleactionfailed textcenter=true}
			</div>
		</div>
	{/if}
<div class="row wgs-alter-info-cls">
	<div class="col-sm-12">
		{if $alerts}
			{foreach $alerts as $alert}
				{include file="$template/includes/alert.tpl" type=$alert.type msg="<strong>{$alert.title}</strong><br>{$alert.description}" textcenter=true}
			{/foreach}
		{/if}

		{if $systemStatus != 'Active'}
			<div class="alert alert-warning text-left" role="alert">
				{$LANG.domainCannotBeManagedUnlessActive}
			</div>
		{/if}
		{if $lockstatus eq "unlocked"}
			{capture name="domainUnlockedMsg"}<strong>{$LANG.domaincurrentlyunlocked}</strong><br />{$LANG.domaincurrentlyunlockedexp}{/capture}
			{include file="$template/includes/alert.tpl" type="error" msg=$smarty.capture.domainUnlockedMsg}
		{/if}
	</div>
</div>
<div class="tab-content margin-bottom">
    <div class="tab-pane fade in active" id="tabOverview">
		<div class="manage-domain-box">
			<div class="overview-main-div">
				<div class="row">
					<div class="col-sm-5 d-flex">
						<div class="active-domain">
							<img src="templates/{$template}/images/{if $status eq 'Active'}cercle-icon.png{else}circle_deactive.png{/if}" alt="">
							  <a href="http://{$domain}" target="_blank"><h2>{$domain}</h2></a>
							  <p class="{if $status eq 'Active'}active-status{else}pending-status{/if}"><span>{$LANG.clientareastatus} :</span> {$status}</p>
						</div>
					</div>
					<div class="col-sm-7">
						<div class="manage-detail">
							<p><img src="templates/{$template}/images/d-icon1.png" alt=""><span> {$LANG.clientareahostingregdate}:</span> {$registrationdate}</p>
							<p><img src="templates/{$template}/images/d-icon2.png" alt=""><span> {$LANG.clientareahostingnextduedate}:</span> {$nextduedate}</p>
							<p><img src="templates/{$template}/images/d-icon3.png" alt=""><span> {$LANG.firstpaymentamount}:</span> {$firstpaymentamount}</p>
							<p><img src="templates/{$template}/images/d-icon4.png" alt=""><span> {$LANG.recurringamount}:</span> {$recurringamount} {$LANG.every} {$registrationperiod} {$LANG.orderyears}</p>
							<p><img src="templates/{$template}/images/d-icon5.png" alt=""><span> {$LANG.orderpaymentmethod}:</span> {$paymentmethod}</p>
						</div>
					</div>
				</div>
			</div>
			<div class="overview-main-div-2">
				{if $sslStatus}
					<div class="row">
						<div class="col-sm-offset-1 col-sm-5{if $sslStatus->isInactive()} ssl-inactive{/if}">
							<h4><strong>{$LANG.sslState.sslStatus}</strong></h4> <img src="{$sslStatus->getImagePath()}" width="16" data-type="domain" data-domain="{$domain}" data-showlabel="1" class="{$sslStatus->getClass()}"/>
							<span id="statusDisplayLabel">
								{if !$sslStatus->needsResync()}
									{$sslStatus->getStatusDisplayLabel()}
								{else}
									{$LANG.loading}
								{/if}
							</span>
						</div>
						{if $sslStatus->isActive() || $sslStatus->needsResync()}
							<div class="col-sm-6">
								<h4><strong>{$LANG.sslState.startDate}</strong></h4>
								<span id="ssl-startdate">
									{if !$sslStatus->needsResync() || $sslStatus->startDate}
										{$sslStatus->startDate->toClientDateFormat()}
									{else}
										{$LANG.loading}
									{/if}
								</span>
							</div>
						{/if}
					</div>
					{if $sslStatus->isActive() || $sslStatus->needsResync()}
						<div class="row">
							<div class="col-sm-offset-1 col-sm-5">
								<h4><strong>{$LANG.sslState.issuerName}</strong></h4>
								<span id="ssl-issuer">
									{if !$sslStatus->needsResync() || $sslStatus->issuerName}
										{$sslStatus->issuerName}
									{else}
										{$LANG.loading}
									{/if}
								</span>
							</div>
							<div class="col-sm-6">
								<h4><strong>{$LANG.sslState.expiryDate}</strong></h4>
								<span id="ssl-expirydate">
									{if !$sslStatus->needsResync() || $sslStatus->expiryDate}
										{$sslStatus->expiryDate->toClientDateFormat()}
									{else}
										{$LANG.loading}
									{/if}
								</span>
							</div>
						</div>
					{/if}
				{/if}
				<div class="row">
					<div class="col-sm-12">
						{if $registrarclientarea}
							<div class="moduleoutput">
								{$registrarclientarea|replace:'modulebutton':'btn'}
							</div>
						{/if}
						{foreach $hookOutput as $output}
							<div>
								{$output}
							</div>
						{/foreach}
					</div>
				</div>
			</div>
		</div>
		<div class="domain-detail-tabs">
			{if $canDomainBeManaged
				and (
					$managementoptions.nameservers or
					$managementoptions.contacts or
					$managementoptions.locking or
					$renew)}
					{* No reason to show this section if nothing can be done here! *}
				<div class="today-text">{$LANG.doToday}</div>
				<ul class="nav nav-tabs" role="tablist">
					{if $systemStatus == 'Active' && $managementoptions.nameservers}
						<li class="nav-item">
							<a class="nav-link" data-toggle="tab" href="#tabNameservers">
								<img src="templates/{$template}/images/{$layoutStyle}/cloud-iconn.png" class="cloud-icon1"/> {$LANG.changeDomainNS}
							</a>
						</li>
					{/if}
					{if $systemStatus == 'Active' && $managementoptions.contacts}
						<li class="nav-item">
							<a class="nav-link" href="clientarea.php?action=domaincontacts&domainid={$domainid}">
								<img src="templates/{$template}/images/{$layoutStyle}/cloud-iconn.png" class="cloud-icon1"/> {$LANG.updateWhoisContact}
							</a>
						</li>
					{/if}
					{if $systemStatus == 'Active' && $managementoptions.locking}
						<li class="nav-item">
							<a class="nav-link" data-toggle="tab" href="#tabReglock">
								<img src="templates/{$template}/images/{$layoutStyle}/cloud-iconn.png" class="cloud-icon1"/> {$LANG.changeRegLock}
							</a>
						</li>
					{/if}
					{if $renew}
						<li class="nav-item">
							<a class="nav-link" href="{routePath('domain-renewal', $domain)}">
								<img src="templates/{$template}/images/{$layoutStyle}/cloud-iconn.png" class="cloud-icon1"/> {$LANG.renewYourDomain}
							</a>
						</li>
					{/if}
				</ul>
			{/if}		
		</div>
    </div>
	
    <div class="tab-pane fade" id="tabAutorenew">
        <h3>{$LANG.domainsautorenew}</h3>
        {if $changeAutoRenewStatusSuccessful}
            {include file="$template/includes/alert.tpl" type="success" msg=$LANG.changessavedsuccessfully textcenter=true}
        {/if}
        {include file="$template/includes/alert.tpl" type="info" msg=$LANG.domainrenewexp}
        <br />
        <h2 class="text-center">{$LANG.domainautorenewstatus}: <span class="label label-{if $autorenew}success{else}danger{/if}">{if $autorenew}{$LANG.domainsautorenewenabled}{else}{$LANG.domainsautorenewdisabled}{/if}</span></h2>
        <br />
        <br />
        <form method="post" action="{$smarty.server.PHP_SELF}?action=domaindetails#tabAutorenew">
            <input type="hidden" name="id" value="{$domainid}">
            <input type="hidden" name="sub" value="autorenew" />
            {if $autorenew}
                <input type="hidden" name="autorenew" value="disable">
                <p class="text-center">
                    <input type="submit" class="btn btn-lg btn-danger" value="{$LANG.domainsautorenewdisable}" />
                </p>
            {else}
                <input type="hidden" name="autorenew" value="enable">
                <p class="text-center">
                    <input type="submit" class="btn btn-lg btn-success" value="{$LANG.domainsautorenewenable}" />
                </p>
            {/if}
        </form>
    </div>
	
    <div class="tab-pane fade" id="tabNameservers">
        <h3>{$LANG.domainnameservers}</h3>
        {if $nameservererror}
            {include file="$template/includes/alert.tpl" type="error" msg=$nameservererror textcenter=true}
        {/if}
        {if $subaction eq "savens"}
            {if $updatesuccess}
                {include file="$template/includes/alert.tpl" type="success" msg=$LANG.changessavedsuccessfully textcenter=true}
            {elseif $error}
                {include file="$template/includes/alert.tpl" type="error" msg=$error textcenter=true}
            {/if}
        {/if}
        {include file="$template/includes/alert.tpl" type="info" msg=$LANG.domainnsexp}
        <form class="form-horizontal" role="form" method="post" action="{$smarty.server.PHP_SELF}?action=domaindetails#tabNameservers">
            <input type="hidden" name="id" value="{$domainid}" />
            <input type="hidden" name="sub" value="savens" />
			<div class="row">
				<div class="col-sm-4">
					<div class="form-group">
						<div class="radio">
							<label>
								<input type="radio" name="nschoice" value="default" onclick="disableFields('domnsinputs',true)"{if $defaultns} checked{/if} /> {$LANG.nschoicedefault}
							</label>
						</div>
					</div>
				</div>
				<div class="col-sm-8">
					<div class="form-group">
						<div class="radio">
							<label>
								<input type="radio" name="nschoice" value="custom" onclick="disableFields('domnsinputs',false)"{if !$defaultns} checked{/if} /> {$LANG.nschoicecustom}
							</label>
						</div>
					</div>
				</div>
				{for $num=1 to 5}
					<div class="col-sm-4">
						<div class="form-group">
							<label for="inputNs{$num}">{$LANG.clientareanameserver} {$num}</label>
							<input type="text" class="form-control" name="ns{$num}" id="inputNs{$num}" value="{$nameservers[$num].value}" />
						</div>
					</div>
				{/for}
				<div class="col-sm-12">
					<div class="form-group">
						<p class="text-left">
							<input type="submit" class="btn btn-primary wgs-submit-button" value="{$LANG.changenameservers}" />
						</p>
					</div>
				</div>
			</div>
        </form>
    </div>
	
    <div class="tab-pane fade" id="tabReglock">
        <h3>{$LANG.domainregistrarlock}</h3>
        {if $subaction eq "savereglock"}
            {if $updatesuccess}
                {include file="$template/includes/alert.tpl" type="success" msg=$LANG.changessavedsuccessfully textcenter=true}
            {elseif $error}
                {include file="$template/includes/alert.tpl" type="error" msg=$error textcenter=true}
            {/if}
        {/if}
        {include file="$template/includes/alert.tpl" type="info" msg=$LANG.domainlockingexp}
        <h2 class="text-left">{$LANG.domainreglockstatus}: <span class="label label-{if $lockstatus == "locked"}success{else}danger{/if}">{if $lockstatus == "locked"}{$LANG.domainsautorenewenabled}{else}{$LANG.domainsautorenewdisabled}{/if}</span></h2>
        <form method="post" action="{$smarty.server.PHP_SELF}?action=domaindetails#tabReglock">
            <input type="hidden" name="id" value="{$domainid}">
            <input type="hidden" name="sub" value="savereglock" />
            {if $lockstatus=="locked"}
                <p class="text-left">
                    <input type="submit" class="btn btn-lg btn-danger wgs-cancel-button" value="{$LANG.domainreglockdisable}" />
                </p>
            {else}
                <input type="hidden" name="autorenew" value="enable">
                <p class="text-left">
                    <input type="submit" class="btn btn-lg btn-success wgs-submit-button" name="reglock" value="{$LANG.domainreglockenable}" />
                </p>
            {/if}
        </form>
    </div>
	
    <div class="tab-pane fade" id="tabRelease">
        <h3>{$LANG.domainrelease}</h3>
		{if $releaseDomainSuccessful}
            {include file="$template/includes/alert.tpl" type="success" msg="{lang key='changessavedsuccessfully'}" textcenter="true"}
        {elseif !empty($error)}
            {include file="$template/includes/alert.tpl" type="error" msg="$error" textcenter="true"}
        {/if}
		{include file="$template/includes/alert.tpl" type="info" msg=$LANG.domainreleasedescription}
        <form class="form-horizontal" role="form" method="post" action="{$smarty.server.PHP_SELF}?action=domaindetails#tabRelease">
            <input type="hidden" name="sub" value="releasedomain">
            <input type="hidden" name="id" value="{$domainid}">
            <div class="form-group">
                <label for="inputReleaseTag" class="col-xs-4 control-label">{$LANG.domainreleasetag}</label>
                <div class="col-xs-6 col-sm-5">
                    <input type="text" class="form-control" id="inputReleaseTag" name="transtag" />
                </div>
            </div>
            <p class="text-center">
                <input type="submit" value="{$LANG.domainrelease}" class="btn btn-primary" />
            </p>
        </form>
    </div>
	
    <div class="tab-pane fade" id="tabAddons">
        <h3>{$LANG.domainaddons}</h3>
        <p>
            {$LANG.domainaddonsinfo}
        </p>
        {if $addons.idprotection}
            <div class="row margin-bottom">
                <div class="col-xs-3 col-md-2 text-center">
                    <i class="fas fa-shield-alt fa-3x"></i>
                </div>
                <div class="col-xs-9 col-md-10">
                    <strong>{$LANG.domainidprotection}</strong><br />
                    {$LANG.domainaddonsidprotectioninfo}<br />
                    <form action="clientarea.php?action=domainaddons" method="post">
                        <input type="hidden" name="id" value="{$domainid}"/>
                        {if $addonstatus.idprotection}
                            <input type="hidden" name="disable" value="idprotect"/>
                            <input type="submit" value="{$LANG.disable}" class="btn btn-danger"/>
                        {else}
                            <input type="hidden" name="buy" value="idprotect"/>
                            <input type="submit" value="{$LANG.domainaddonsbuynow} {$addonspricing.idprotection}" class="btn btn-success"/>
                        {/if}
                    </form>
                </div>
            </div>
        {/if}
        {if $addons.dnsmanagement}
            <div class="row margin-bottom">
                <div class="col-xs-3 col-md-2 text-center">
                    <i class="fas fa-cloud fa-3x"></i>
                </div>
                <div class="col-xs-9 col-md-10">
                    <strong>{$LANG.domainaddonsdnsmanagement}</strong><br />
                    {$LANG.domainaddonsdnsmanagementinfo}<br />
                    <form action="clientarea.php?action=domainaddons" method="post">
                        <input type="hidden" name="id" value="{$domainid}"/>
                        {if $addonstatus.dnsmanagement}
                            <input type="hidden" name="disable" value="dnsmanagement"/>
                            <a class="btn btn-success" href="clientarea.php?action=domaindns&domainid={$domainid}">{$LANG.manage}</a> <input type="submit" value="{$LANG.disable}" class="btn btn-danger"/>
                        {else}
                            <input type="hidden" name="buy" value="dnsmanagement"/>
                            <input type="submit" value="{$LANG.domainaddonsbuynow} {$addonspricing.dnsmanagement}" class="btn btn-success"/>
                        {/if}
                    </form>
                </div>
            </div>
        {/if}
        {if $addons.emailforwarding}
            <div class="row margin-bottom">
                <div class="col-xs-3 col-md-2 text-center">
                    <i class="fas fa-envelope fa-3x">&nbsp;</i><i class="fas fa-share fa-2x"></i>
                </div>
                <div class="col-xs-9 col-md-10">
                    <strong>{$LANG.domainemailforwarding}</strong><br />
                    {$LANG.domainaddonsemailforwardinginfo}<br />
                    <form action="clientarea.php?action=domainaddons" method="post">
                        <input type="hidden" name="id" value="{$domainid}"/>
                        {if $addonstatus.emailforwarding}
                            <input type="hidden" name="disable" value="emailfwd"/>
                            <a class="btn btn-success" href="clientarea.php?action=domainemailforwarding&domainid={$domainid}">{$LANG.manage}</a> <input type="submit" value="{$LANG.disable}" class="btn btn-danger"/>
                        {else}
                            <input type="hidden" name="buy" value="emailfwd"/>
                            <input type="submit" value="{$LANG.domainaddonsbuynow} {$addonspricing.emailforwarding}" class="btn btn-success"/>
                        {/if}
                    </form>
                </div>
            </div>
        {/if}
    </div>
	
</div>
		
	</div> <!-- shared hosting div -->
</div> <!-- domain detail div -->