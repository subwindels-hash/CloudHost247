{include file="orderforms/standard_cart/common.tpl"}

<script>
var _localLang = {
    'addToCart': '{$LANG.orderForm.addToCart|escape}',
    'addedToCartRemove': '{$LANG.orderForm.addedToCartRemove|escape}'
}
</script>
    {if $productinfo.module eq 'soyoustart' || $productinfo.module eq 'soyoustart_vps'} 
        <link rel="stylesheet" href="templates/orderforms/{$carttpl}/css/style-design.css">
        <link rel="stylesheet" href="templates/orderforms/{$carttpl}/css/font-awesome.css" type="text/css">
        <link rel="stylesheet" href="templates/orderforms/{$carttpl}/css/style-ovh.css" type="text/css">
        <link href="https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        {if $template eq "clientx-child"}
            <link rel="stylesheet" href="templates/orderforms/{$carttpl}/css/clientx-child.css" type="text/css">
        {else if $template eq "cloudx"}    
            <link rel="stylesheet" href="templates/orderforms/{$carttpl}/css/cloudx.css" type="text/css">
        {else if $template eq "hostx"}    
            <link rel="stylesheet" href="templates/orderforms/{$carttpl}/css/hostx.css" type="text/css">
        {else if $template eq "lagom2"}    
            <link rel="stylesheet" href="templates/orderforms/{$carttpl}/css/lagom2.css" type="text/css">
        {else if $template eq "six"}    
            <link rel="stylesheet" href="templates/orderforms/{$carttpl}/css/six.css" type="text/css">
        {else if $template eq "twenty-x"}    
            <link rel="stylesheet" href="templates/orderforms/{$carttpl}/css/twenty-x.css" type="text/css">
        {/if}
    {/if}


<div id="order-standard_cart" class="order-standard_cart {$randomClass}">
    <div class="row">
        {if $hideSidebarOnCart !="on"}
            <div class="cart-sidebar">
                {include file="orderforms/standard_cart/sidebar-categories.tpl"}
            </div>
        {/if}

    {if $licenceError neq ''}
        <div class="header-lined customHeader w-100">
            <div class="alert alert-danger" role="alert">{$licenceError}!</div>
        </div>
    {elseif $licenseData["status"] neq "Active"}
        <div class="header-lined customHeader w-100">
            <div class="alert alert-danger" role="alert"> {$LANG.moduleLicenseStatus} {$licenseData["status"]}!</div>
        </div>
     {elseif isset($addonData["OVH Order Form"]) && $addonData["OVH Order Form"]["status"] neq "Active"}
        <div class="header-lined customHeader w-100">
            <div class="alert alert-danger" role="alert"> {$LANG.cartLicenseStatus} {$addonData["OVH Order Form"]["status"]}!</div>
        </div>
    {elseif !$orderFormPurchase}
        <div class="header-lined customHeader w-100">
            <div class="alert alert-primary" role="alert">{$LANG.buyOrderform} <a href="https://members.whmcsglobalservices.com/cart.php?gid=addons" target="_blank">{$LANG.buyButton}</a></div>
        </div>
    {else}

    <div class="cart-body" {if $hideSidebarOnCart =="on"} style="width: 100%;" {/if}>
            {include file="orderforms/standard_cart/sidebar-categories-collapsed.tpl"}

            <form id="frmConfigureProduct">
                <input type="hidden" name="configure" value="true" />
                <input type="hidden" name="i" value="{$i}"  id="i"/>

                <div class="row">
                    <div class="secondary-cart-body">
                        <div class="header-lined customHeader">
                            <h1 class="font-size-36">{$LANG.orderconfigure}</h1>
                            <p>{$LANG.configureDesiredOptions}</p>
                        </div>

                        <div class="product-info" style="padding: 20px;background: #f8f8f8;">
                            <p class="product-title">{$productinfo.name}</p>
                            <p>{$productinfo.description}</p>
                        </div>

                        <div class="alert alert-danger w-hidden" role="alert" id="containerProductValidationErrors">
                            <p>{$LANG.orderForm.correctErrors}:</p>
                            <ul id="containerProductValidationErrorsList"></ul>
                        </div>

                        {if $pricing.type eq "recurring"}
                            <div class="field-container" style="padding: 20px;background: #f8f8f8;">
                                <div class="form-group">
                                      <label id="billingcycleheader">{$LANG.cartchoosecycle}</label>

                                    <input type="hidden" name="billingcycle" value={$billingcycle} id="updatebillingcycle">
                                    <div class="row billing-main" id="billingcycle">
                                        {if $pricing.monthly}
                                            <div class="{if $hideSidebarOnCart =='on'} col-md-4 {else} col-md-6 {/if}billingcycle" data-billingcycle="monthly">
                                                <div class="billing-inner{if $billingcycle eq 'monthly'} active{/if}">
                                                    <div value="monthly" class="">
                                                        <h6>{$LANG.billingCyclemonthly}</h6>
                                                        <p>{$hxselectedcurrency.prefix}{$pricing.rawpricing["monthly"]+ $pricing.rawpricing["msetupfee"]} {$hxselectedcurrency.code}</p>
                                                        <span>{$pricing.monthly}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        {/if}
                                        {if $pricing.quarterly}
                                            <div class="{if $hideSidebarOnCart =="on"} col-md-4 {else} col-md-6 {/if}billingcycle" data-billingcycle="quarterly">
                                                <div class="billing-inner{if $billingcycle eq 'quarterly'} active{/if}">
                                                    <div value="quarterly" class="">
                                                        <h6>{$LANG.billingCyclequarterly}</h6>
                                                        <p>{$hxselectedcurrency.prefix}{$pricing.rawpricing["quarterly"]+ $pricing.rawpricing["qsetupfee"]} {$hxselectedcurrency.code}</p>
                                                        {assign var="quarterlyPrice" value=({$pricing.rawpricing["quarterly"]+ $pricing.rawpricing["qsetupfee"]})/3}
                                                        <span>{$pricing.quarterly}</span>
                                                        <small>{$hxselectedcurrency.prefix}{$quarterlyPrice|number_format:2} {$LANG.perMonth}</small>
                                                    </div>
                                                </div>
                                            </div>
                                        {/if}
                                        {if $pricing.semiannually}
                                            <div class="{if $hideSidebarOnCart =="on"} col-md-4 {else} col-md-6 {/if}billingcycle" data-billingcycle="semiannually">
                                                <div class="billing-inner{if $billingcycle eq 'semiannually'} active{/if}">
                                                    <div value="semiannually" class="">
                                                        <h6>{$LANG.billingCyclesemiannually}</h6>
                                                        <p>{$hxselectedcurrency.prefix}{$pricing.rawpricing["semiannually"]+ $pricing.rawpricing["ssetupfee"]} {$hxselectedcurrency.code}</p>
                                                        {assign var="semiannuallyPrice" value=({$pricing.rawpricing["semiannually"]+ $pricing.rawpricing["ssetupfee"]})/6}
                                                        <span>{$pricing.semiannually}</span>
                                                        <small>{$hxselectedcurrency.prefix}{$semiannuallyPrice|number_format:2} {$LANG.perMonth}</small>
                                                    </div>
                                                </div>
                                            </div>
                                        {/if}
                                        {if $pricing.annually}
                                            <div class="{if $hideSidebarOnCart =="on"} col-md-4 {else} col-md-6 {/if}billingcycle" data-billingcycle="annually">
                                                <div class="billing-inner{if $billingcycle eq 'annually'} active{/if}">
                                                    <div value="annually" class="">
                                                        <h6>{$LANG.billingCycleannually}</h6>
                                                        <p>{$hxselectedcurrency.prefix}{$pricing.rawpricing["annually"]+ $pricing.rawpricing["asetupfee"]} {$hxselectedcurrency.code}</p>
                                                        {assign var="annuallyPrice" value=({$pricing.rawpricing["annually"]+ $pricing.rawpricing["asetupfee"]})/12}
                                                        <span>{$pricing.annually}</span>
                                                        <small>{$hxselectedcurrency.prefix}{$annuallyPrice|number_format:2} {$LANG.perMonth}</small>
                                                    </div>
                                                </div>
                                            </div>
                                        {/if}
                                        {if $pricing.biennially}
                                            <div class="{if $hideSidebarOnCart =="on"} col-md-4 {else} col-md-6 {/if}billingcycle" data-billingcycle="biennially">
                                                <div class="billing-inner{if $billingcycle eq 'biennially'} active{/if}">
                                                    <div value="biennially" class="">
                                                        <h6>{$LANG.billingCyclebiennially}</h6>
                                                        <p>{$hxselectedcurrency.prefix}{$pricing.rawpricing["biennially"]+ $pricing.rawpricing["bsetupfee"]} {$hxselectedcurrency.code}</p>
                                                        {assign var="bienniallyPrice" value=({$pricing.rawpricing["biennially"]+ $pricing.rawpricing["bsetupfee"]})/24}
                                                        <span>{$pricing.biennially}</span>
                                                        <small>{$hxselectedcurrency.prefix}{$bienniallyPrice|number_format:2} {$LANG.perMonth}</small>
                                                    </div>
                                                </div>
                                            </div>
                                        {/if}
                                        {if $pricing.triennially}
                                            <div class="{if $hideSidebarOnCart =="on"} col-md-4 {else} col-md-6 {/if}billingcycle" data-billingcycle="triennially">
                                                <div class="billing-inner{if $billingcycle eq 'triennially'} active{/if}">
                                                    <div value="triennially" class="">
                                                        <h6>{$LANG.billingCycletriennially}</h6>
                                                        <p>{$hxselectedcurrency.prefix}{$pricing.rawpricing["triennially"]+ $pricing.rawpricing["tsetupfee"]} {$hxselectedcurrency.code}</p>
                                                        {assign var="trienniallyPrice" value=({$pricing.rawpricing["triennially"]+ $pricing.rawpricing["tsetupfee"]})/36}
                                                        <span>{$pricing.triennially}</span>
                                                        <small>{$hxselectedcurrency.prefix}{$trienniallyPrice|number_format:2} {$LANG.perMonth}</small>
                                                    </div>
                                                </div>
                                            </div>
                                        {/if}
                                    </div>
                                    </div>
                                </div>
                        {/if}

                        {if count($metrics) > 0}
                            <div class="sub-heading">
                                <span class="primary-bg-color">{$LANG.metrics.title}</span>
                            </div>

                            <p>{$LANG.metrics.explanation}</p>

                            <ul>
                                {foreach $metrics as $metric}
                                    <li>
                                        {$metric.displayName}
                                        -
                                        {if count($metric.pricing) > 1}
                                            {$LANG.metrics.startingFrom} {$metric.lowestPrice} / {if $metric.unitName}{$metric.unitName}{else}{$LANG.metrics.unit}{/if}
                                            <button type="button" class="btn btn-default btn-sm" data-toggle="modal" data-target="#modalMetricPricing-{$metric.systemName}">
                                                {$LANG.metrics.viewPricing}
                                            </button>
                                        {elseif count($metric.pricing) == 1}
                                            {$metric.lowestPrice} / {if $metric.unitName}{$metric.unitName}{else}{$LANG.metrics.unit}{/if}
                                            {if $metric.includedQuantity > 0} ({$metric.includedQuantity} {$LANG.metrics.includedNotCounted}){/if}
                                        {/if}
                                        {include file="$template/usagebillingpricing.tpl"}
                                    </li>
                                {/foreach}
                            </ul>

                            <br>
                        {/if}

                        {if $productinfo.type eq "server"}
                            <div class="sub-heading">
                                <span class="primary-bg-color">{$LANG.cartconfigserver}</span>
                            </div>

                            <div class="field-container">

                                <div class="row">
                                    <div class="col-sm-6">
                                        <div class="form-group">
                                            <label for="inputHostname">{$LANG.serverhostname}</label>
                                            <input type="text" name="hostname" class="form-control" id="inputHostname" value="{$server.hostname}" placeholder="servername.yourdomain.com">
                                        </div>
                                    </div>
                                    <div class="col-sm-6">
                                        <div class="form-group">
                                            <label for="inputRootpw">{$LANG.serverrootpw}</label>
                                            <input type="password" name="rootpw" class="form-control" id="inputRootpw" value="{$server.rootpw}">
                                        </div>
                                    </div>
                                </div>

                                <div class="row">
                                    <div class="col-sm-6">
                                        <div class="form-group">
                                            <label for="inputNs1prefix">{$LANG.serverns1prefix}</label>
                                            <input type="text" name="ns1prefix" class="form-control" id="inputNs1prefix" value="{$server.ns1prefix}" placeholder="ns1">
                                        </div>
                                    </div>
                                    <div class="col-sm-6">
                                        <div class="form-group">
                                            <label for="inputNs2prefix">{$LANG.serverns2prefix}</label>
                                            <input type="text" name="ns2prefix" class="form-control" id="inputNs2prefix" value="{$server.ns2prefix}" placeholder="ns2">
                                        </div>
                                    </div>
                                </div>

                            </div>
                        {/if}

                        {if $configurableoptions}
                            <div class="sub-heading">
                                <span class="primary-bg-color">{$LANG.orderconfigpackage}</span>
                            </div>
                            <div class="product-configurable-options" id="productConfigurableOptions">
                                <div class="row">
{if $productinfo.module eq 'soyoustart' || $productinfo.module eq 'soyoustart_vps'}
    {foreach key=num2 from=$configurableoptions item=configoption}  
        {if $configoption.optiontype eq 1}
            {if $configoption.optionname eq "Control Panel"}
                <div class="location-center">
                    <div class="row">
                    <div class="col-sm-12 col-md-12 col-lg-12" style="line-height: 35px;">
                        <div class="bil-title titlelicense">
                            <h4><img src="templates/orderforms/{$carttpl}/images/control-panels.svg" alt="control-panels.svg">{$LANG.paidLicenseHeading}</h4>
                            <p>{$LANG.paidLicenseDesc}</p>
                        </div>
                    </div>
                    {assign var="createdOptions" value=[]}

                    {foreach item=options from=$configoption.options}
                        {if $options.hidden} 
                            {continue}
                        {else} 
                            {assign var=optionName value=" "|explode:$options.name}
                            {if $options.name|str_contains:$optionName["0"]}
                                {if !$optionName["0"]|in_array:$createdOptions}
                                    {append var="createdOptions" value="{$optionName[0]}" index={$options['id']}}
                                {/if}
                                {if $options['id'] eq $configoption.selectedvalue}
                                    {append var="createdOptions" value="{$optionName[0]}" index="selectedvalue"}
                                {/if}
                            
                            {/if}
                        {/if}
                    {/foreach} 
                    
                    {assign var="selectedValue" value=$createdOptions|@array_values|@reset}
                    {assign var="selectedKey" value=$createdOptions|@array_keys|@reset}
    
                    {if !isset($createdOptions["selectedvalue"])} 
                        {assign var="selected" value=$selectedKey}
                        <input type="hidden" name="configoption[{$configoption.id}]" value="{$selectedKey}" id="customConfigVal">
                    {else}
                        {assign var="selected" value=$configoption.selectedvalue}
                        <input type="hidden" name="configoption[{$configoption.id}]" value="{$configoption.selectedvalue}" id="customConfigVal">
                    {/if}
                    {foreach from=$createdOptions item=optionname key=$key}
                        {if $key eq 'selectedvalue'} {continue}{/if}
                        <div class="col-md-4 license{$configoption.optionname}" data-name="{$optionname}" id="{$optionname}">
                            <div class="billingcycle-box singleSelected licenseControl {if $createdOptions.selectedvalue eq $optionname}active{elseif !isset($createdOptions["selectedvalue"])} {if $selectedValue eq $optionname}active{/if} {/if}" data-id="{$key}">
                            {if !$optionname|in_array:["none", "None"]}
                                <div class="lg-icons os-icons"><img src="templates/orderforms/{$carttpl}/images/{$optionname|lower}.svg" align="{$optionname}">
                                <h4>{$optionname}</h4>
                                    <select class="op-select licensedisable" id="{$key}Detail">
                                        {foreach key=num2 item=option from=$configoption.options}
                                            {if $option.name|str_contains:$optionname && !$option.hidden}
                                                <option value="{$option.id}"{if $configoption.selectedvalue eq $option.id} selected="selected"{/if}>{$option.name}</option>
                                            {/if}
                                        {/foreach}
                                    </select>
                            {else}
                                <div class="lg-icons os-icons"><img src="templates/orderforms/{$carttpl}/images/no-control-panel.svg" align="{$optionname}">
                                <h4>{$optionname}</h4>
                            {/if}

                        </div>

                            </div>
                        </div>    
                    {/foreach}
                </div>
                </div>
            {elseif $configoption.optionname eq "OS Family"}    

                <div class="choose-os location-center">
                    <div class="row">
                        <div class="col-sm-12 col-md-12 col-lg-12" style="line-height: 35px;">
                            <div class="bil-title titlelicense">
                                <h4><img src="templates/orderforms/{$carttpl}/images/operating-systems.svg" alt="os family">{$LANG.osFamillyHeading}</h4>
                                <p>{$LANG.osFamillyDesc}</p>
                            </div>
                        </div>
                        <div class="col-md-6 license{$configoption.optionname}">
                            <select name="configoption[{$configoption.id}]" id="osFamily" class="op-select no-iCheck">
                                {foreach key=num2 item=options from=$configoption.options}   

                                    {if $configoption.selectedname|in_array:["none", "None"]}
                                        {assign var="selectedvalue" value={$configoption.options[1]["id"]}}
                                    {else} 
                                        {assign var="selectedvalue" value={$configoption.selectedvalue}}
                                    {/if}


                                    {if !$options.hidden}
                                        <option value="{$options.id}"{if $selectedvalue eq $options.id} selected="selected"{/if}>{$options.name}</option>
                                    {/if}
                                {/foreach}
                            </select>
                        </div> 
                       
                    </div>
                </div>
            {elseif $configoption.optionname eq "OS Version" || $configoption.optionname eq "Operating System"}
                <div class="location-center">
                    <div class="row">
                    <div class="col-sm-12 col-md-12 col-lg-12" style="line-height: 35px;">
                        <div class="bil-title titlelicense">
                        <h4><img src="templates/orderforms/{$carttpl}/images/operating-systems.svg" alt="operating-systems">{$LANG.operatingSystemHeading}</h4>
                        <p>{$LANG.operatingSystemDesc}</p>
                        <p class="error" style="display: none">{$LANG.operatingSystemError}</p>
                        </div>
                    </div>
                    

                    {assign var="createdOSOptions" value=[]}


                    {foreach item=options from=$configoption.options}
    {if $options.name eq 'none' || $options.name eq 'None' || $options.hidden}
        {continue}
    {else}

        {* first split by space *}
        {assign var=optionName value=" "|explode:$options.name}

        {* remove version after dash *}
        {assign var=osName value="-"|explode:$optionName[0]}

        {if !$osName[0]|in_array:$createdOSOptions}
            {append var="createdOSOptions" value="{$osName[0]}" index={$options.id}}
        {/if}

        {if $options.id eq $configoption.selectedvalue}
            {append var="createdOSOptions" value="{$osName[0]}" index="selectedvalue"}
        {/if}

    {/if}
{/foreach}

                    {assign var="values" value=$createdOSOptions|@array_values}
                    {assign var="keys" value=$createdOSOptions|@array_keys}
                    {assign var="test" value= array_multisort($values, SORT_ASC, $keys)}
                    {assign var="sortedArray" value=array_combine($keys, $values)}

                    {assign var="selectedValue" value=$sortedArray|@array_values|@reset}
                    {assign var="selectedKey" value=$sortedArray|@array_keys|@reset}

                    {if !isset($sortedArray["selectedvalue"])} 
                        {assign var="selected" value=$selectedKey}
                        <input type="hidden" name="configoption[{$configoption.id}]" value="{$selectedKey}" id="customOSConfigVal">
                    {else}
                        {assign var="selected" value=$configoption.selectedvalue}
                        <input type="hidden" name="configoption[{$configoption.id}]" value="{$configoption.selectedvalue}" id="customOSConfigVal">
                    {/if}

                    {foreach from=$sortedArray item=optionname key=$key}
                        {if $optionname|in_array:['Bring', "Empty", "OS", "SUSE", "none", "None"] || $key eq 'selectedvalue' || strtolower($optionname)|in_array:$hideOs} {continue}{/if}
                        <div class="col-md-4 license{$configoption.optionname}" data-name="{$optionname}" id="{$optionname}">
                            <div class="billingcycle-box operating-box singleSelected osVersion {if $sortedArray.selectedvalue eq $optionname}active{elseif !isset($sortedArray["selectedvalue"])} {if $selectedValue eq $optionname}active{/if} {/if}" data-id="{$key}">
                                <div class="lg-icons os-icons">
                                    <img src="templates/orderforms/{$carttpl}/images/{$optionname|lower}.svg" align="{$optionname}">
                                    <h4>{$optionname}</h4>
                                    <select class="op-select licensedisable" id="{$key}Detail">
                                    {foreach key=num2 item=option from=$configoption.options}
                                        {if $option.name|str_contains:$optionname && !$option.hidden}
                                            <option value="{$option.id}"{if $configoption.selectedvalue eq $option.id} selected="selected"{/if}>{$option.name}</option>
                                        {/if}
                                    {/foreach}
                                    </select>
                                </div>

                            </div>
                        </div>    
                    {/foreach} 
                    </div>
                </div>
            {elseif $configoption.optionname eq "Server Location"}
                <div class="location-center bil-title">
                    <div class="row">
                    <div class="col-sm-12 col-md-12 col-lg-12" style="line-height: 35px;">
                        <h4><img src="templates/orderforms/{$carttpl}/images/datacenter-location.svg" alt="datacenter-location.svg">{$LANG.serverLocationHeading}</h4>
                        <p>{$LANG.serverLocationDesc}</p>
                    </div>
                    <div class="col-sm-12 col-md-12 col-lg-12" style="line-height: 35px;">
                        <div class="billingcycle-sec configurable-sec" id="serverLocation">
                            <div class="row">
                           {* formating and shorting the datacenters      *}
                            {assign var="createdServerlocationsOptions" value=[]}
                            {foreach key=num2 item=optionName from=$configoption.options}
                                {if !$optionName|in_array:$createdServerlocationsOptions && !$optionName.hidden }
                                    {append var="createdServerlocationsOptions" value="{$optionName['name']}" index={$optionName['id']}}
                                {/if}
                            {/foreach}
                            {assign var="values" value=$createdServerlocationsOptions|@array_values}
                            {assign var="keys" value=$createdServerlocationsOptions|@array_keys}
                            {assign var="test" value= array_multisort($values, SORT_ASC, $keys)}
                            {assign var="createdServerlocationsOptions" value=array_combine($keys, $values)}
                           
                            {assign var="selected" value=$createdServerlocationsOptions|@array_keys|@reset}
                            
                            {if $configoption.selectedvalue|array_key_exists:$createdServerlocationsOptions}
                                {assign var="selected" value=$configoption.selectedvalue}
                                <input type="hidden" name="configoption[{$configoption.id}]" value="{$configoption.selectedvalue}" id="customServerLocationConfigVal">
                            {else}
                                <input type="hidden" name="configoption[{$configoption.id}]" value="{$selected}" id="customServerLocationConfigVal">
                            {/if}

                            {foreach key=num2 item=options from=$createdServerlocationsOptions}
                                <div class="col-md-6">
                                    <div class="billingcycle-box config-box serverLocation{if $selected eq $num2} active{/if}" data-id="{$num2}">
                                        <div class="lg-icons">
                                            {if $options|strstr:'France'}
                                                <img src="templates/orderforms/{$carttpl}/images/FR.svg" align="france">
                                            {elseif $options|strstr:'Poland'}
                                                <img src="templates/orderforms/{$carttpl}/images/PL.svg" align="poland">
                                            {elseif $options|strstr:'Canada'}
                                                <img src="templates/orderforms/{$carttpl}/images/CA.svg" align="canada">
                                            {elseif $options|strstr:'United Kingdom'}
                                                <img src="templates/orderforms/{$carttpl}/images/GB.svg" align="UK">
                                            {elseif $options|strstr:'Germany'}
                                                <img src="templates/orderforms/{$carttpl}/images/DE.svg" align="germany">
                                            {elseif $options|strstr:'Singapour'}
                                                <img src="templates/orderforms/{$carttpl}/images/SG.svg" align="singapour">
                                            {elseif $options|strstr:'Singapore'}
                                                <img src="templates/orderforms/{$carttpl}/images/SG.svg" align="singapour">
                                            {elseif $options|strstr:'Sydney'}
                                                <img src="templates/orderforms/{$carttpl}/images/AU.svg" align="australia">
                                            {elseif $options|strstr:'Europe'}
                                                <img src="templates/orderforms/{$carttpl}/images/europe.jpg" align="lg-icon1">
                                            {elseif $options|strstr:'US'}
                                                <img src="templates/orderforms/{$carttpl}/images/US.svg" align="us">
                                            {elseif $options|strstr:'Australia'}
                                                <img src="templates/orderforms/{$carttpl}/images/AU.svg" align="australia">
                                            {elseif $options|strstr:'Mumbai'}
                                                <img src="templates/orderforms/{$carttpl}/images/IN.svg" align="Mumbai">
                                            {elseif $options|strstr:'Japan'}
                                                <img src="templates/orderforms/{$carttpl}/images/JP.svg" align="Japana">
                                            {elseif $options|strstr:'Netherlands'}
                                                <img src="templates/orderforms/{$carttpl}/images/NL.svg" align="Netherlands">
                                            {elseif $options|strstr:'Mexico'}
                                                <img src="templates/orderforms/{$carttpl}/images/MX.svg" align="Mexico">
                                            {elseif $options|strstr:'South Korea'}
                                                <img src="templates/orderforms/{$carttpl}/images/KR.svg" align="South Korea">
                                            {/if}
                                
                                        </div>
                                        <p>{$options}</p>
                                    </div>
                                </div>
                            {/foreach}
                        </div>
                    </div>
                    </div>
                </div>
                </div>
        
            {elseif $configoption.optionname eq "Disk" || $configoption.optionname eq "storage" || $configoption.optionname eq "Storage" }
                <div class="location-center">
                    <div class="row">
                    <div class="col-sm-12 col-md-12 col-lg-12">
                        <div class="bil-title">
                            <h4><img src="templates/orderforms/{$carttpl}/images/disk.svg" alt="disk">{$LANG.diskHeading}</h4>
                            <p>{$LANG.diskDesc}</p>
                        </div>
                    </div>
                    <div class="col-sm-12 col-md-12 col-lg-12">
                        <div class="list-section">
                            <div class="Diskconfig">
                                <p>{$LANG.diskConfg}</p>
                                <p class="">{$LANG['billingCycle'|cat:$billingcycle]|ucfirst} {$LANG.price}</p>
                            </div>
                            <div class="list-radio-btn">
                                {assign var="selected" value=0}

                                {foreach key=num2 item=options from=$configoption.options}
                                    {if !$options.hidden}
                                        {if $configoption.selectedvalue eq $options.id}
                                            {assign var="selected" value=$options.id}
                                        {elseif !$selected}
                                            {assign var="selected" value=$options.id}
                                        {/if}
                                        <p>
                                            <input type="radio" id="configoption{$options.id}" value="{$options.id}" name="configoption[{$configoption.id}]" {if $selected eq $options.id} checked="checked"{/if} onclick="recalctotals()">
                                            <label for="configoption{$options.id}">{$options.nameonly}<span class="">{$currency.prefix}{$options.fullprice}</span></label>
                                        </p>
                                    {/if}
                                {/foreach}
                            </div>
                        </div>
                    </div>
                </div>
                </div>
             {elseif $configoption.optionname eq "System-storage" || $configoption.optionname eq "System Storage" }
                <div class="location-center">
                    <div class="row">
                    <div class="col-sm-12 col-md-12 col-lg-12">
                        <div class="bil-title">
                            <h4><img src="templates/orderforms/{$carttpl}/images/disk.svg" alt="disk">{$LANG.systemStorageHeading}</h4>
                            <p>{$LANG.systemStorageDesc}</p>
                        </div>
                    </div>
                    <div class="col-sm-12 col-md-12 col-lg-12">
                        <div class="list-section">
                            <div class="Diskconfig">
                                <p>{$LANG.diskConfg}</p>
                                <p class="">{$LANG['billingCycle'|cat:$billingcycle]|ucfirst} {$LANG.price}</p>
                            </div>
                            <div class="list-radio-btn">
                                {assign var="selected" value=0}

                                {foreach key=num2 item=options from=$configoption.options}
                                    {if !$options.hidden}
                                        {if $configoption.selectedvalue eq $options.id}
                                            {assign var="selected" value=$options.id}
                                        {elseif !$selected}
                                            {assign var="selected" value=$options.id}
                                        {/if}
                                        <p>
                                            <input type="radio" id="configoption{$options.id}" value="{$options.id}" name="configoption[{$configoption.id}]" {if $selected eq $options.id} checked="checked"{/if} onclick="recalctotals()">
                                            <label for="configoption{$options.id}">{$options.nameonly}<span class="">{$currency.prefix}{$options.fullprice}</span></label>
                                        </p>
                                    {/if}
                                {/foreach}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {elseif $configoption.optionname eq "Memory" || $configoption.optionname eq "memory"}
                <div class="location-center">
                    <div class="row">
                        <div class="col-sm-12 col-md-12 col-lg-12">
                            <div class="bil-title">
                                <h4><img src="templates/orderforms/{$carttpl}/images/memory-card.svg" alt="memory-card.svg">{$LANG.memoryHeading}</h4>
                                <p>{$LANG.memoryDesc}</p>
                            </div>      
                        </div>
                        <div class="col-sm-12 col-md-12 col-lg-12">
                            <div class="list-section">
                                <div class="Diskconfig">
                                    <p>{$LANG.memoryHeading}</p>
                                    <p class="">{$LANG['billingCycle'|cat:$billingcycle]|ucfirst} {$LANG.price}</p>
                                </div>
                                <div class="list-radio-btn">
                                    {assign var="selected" value=0}
                                    {foreach key=num2 item=options from=$configoption.options}
                                        {if !$options.hidden}
                                            {if !$selected || $configoption.selectedvalue eq $options.id}
                                                {assign var="selected" value=$options.id}
                                            {/if}
                                            <p>
                                                <input type="radio" id="configoption{$options.id}" value="{$options.id}" name="configoption[{$configoption.id}]" {if $selected eq $options.id} checked="checked"{/if} onclick="recalctotals()">
                                                <label for="configoption{$options.id}">{$options.nameonly}<span class="">{$currency.prefix}{$options.fullprice}</span></label>
                                            </p>
                                        {/if}
                                    {/foreach}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            {elseif $configoption.optionname eq "Additional IPs"}
                <div class="location-center">
                    <div class="row">
                        <div class="col-sm-12 col-md-12 col-lg-12">
                            <div class="bil-title">
                                <h4><img src="templates/orderforms/{$carttpl}/images/ip.svg" alt="ip.svg">{$LANG.additionalIpHeading}</h4>
                                <p>{$LANG.additionalIpDesc}</p>
                            </div>
                        </div>
                        <div class="col-sm-12 col-md-12 col-lg-12 mb-3">
                            <div class="list-section">
                                <div class="Diskconfig">
                                    <p>{$LANG.IPs}</p>
                                    <p class="">{$LANG['billingCycle'|cat:$billingcycle]|ucfirst} {$LANG.price}</p>
                                </div>
                                <div class="list-radio-btn">
                                    {assign var="selected" value=0}

                                    {foreach key=num2 item=options from=$configoption.options}
                                        {if !$options.hidden}
                                            {if $configoption.selectedvalue eq $options.id}
                                                {assign var="selected" value=$options.id}
                                            {elseif !$selected}
                                                {assign var="selected" value=$options.id}
                                            {/if}
                                            <p>
                                                <input type="radio" id="configoption{$options.id}" value="{$options.id}" name="configoption[{$configoption.id}]" {if $selected eq $options.id} checked="checked"{/if}>
                                                <label for="configoption{$options.id}" class="check-title">
                                                    
                                                    {if $options.nameonly eq 'None'} No extra IPv4 address {else} {$options.nameonly} Additional IPv4 addresses<span {/if}
                                                    <span>{$currency.prefix}{$options.fullprice}</span>
                                                </label>
                                            </p>
                                        {/if}
                                    {/foreach}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
               
            {elseif $configoption.optionname eq "Public network" || $configoption.optionname eq "Public Network"}
                <div class="location-center">
                    <div class="row">
                    <div class="col-sm-12 col-md-12 col-lg-12">
                        <div class="bil-title">
                            <h4><img src="templates/orderforms/{$carttpl}/images/networking.svg" alt="networking.svg">{$LANG.publicNetworkHeading}</h4>
                        </div>
                    </div>
                    <div class="col-sm-12 col-md-12 col-lg-12">
                        <div class="list-section">
                            <div class="Diskconfig">
                                <p>{$LANG.publicNetwork}</p>
                                <p class="">{$LANG['billingCycle'|cat:$billingcycle]|ucfirst} {$LANG.price}</p>
                            </div>
                            <div class="list-radio-btn">
                            {assign var="selected" value=0}
                                {foreach key=num2 item=options from=$configoption.options}
                                    {if !$options.hidden}
                                        {if $configoption.selectedvalue eq $options.id}
                                            {assign var="selected" value=$options.id}
                                        {elseif !$selected}
                                            {assign var="selected" value=$options.id}
                                        {/if}
                                        <p>
                                            <input type="radio" id="configoption{$options.id}" value="{$options.id}" name="configoption[{$configoption.id}]" {if $selected eq $options.id} checked="checked"{/if} onclick="recalctotals()">
                                            <label for="configoption{$options.id}">{$options.nameonly}<span class="">{$currency.prefix}{$options.fullprice}</span></label>
                                        </p>
                                    {/if}
                                {/foreach}
                            </div>
                        </div>
                    </div>
                </div>
                </div>
            {elseif $configoption.optionname eq "Private network" || $configoption.optionname eq "Private Network"}
                <div class="location-center">
                    <div class="row">
                        <div class="col-sm-12 col-md-12 col-lg-12">
                            <div class="bil-title">
                                <h4><img src="templates/orderforms/{$carttpl}/images/networking.svg" alt="networking.svg">Choose a Private Network</h4>
                            </div>
                        </div>
                        <div class="col-sm-12 col-md-12 col-lg-12">
                            <div class="list-section">
                                <div class="Diskconfig">
                                    <p>{$LANG.privateNetwork}</p>
                                    <p class="">{$LANG['billingCycle'|cat:$billingcycle]|ucfirst} {$LANG.price}</p>
                                </div>
                                <div class="list-radio-btn">
                                    {assign var="selected" value=0}
                                    {foreach key=num2 item=options from=$configoption.options}
                                        {if !$options.hidden}
                                            {if $configoption.selectedvalue eq $options.id}
                                                {assign var="selected" value=$options.id}
                                            {elseif !$selected}
                                                {assign var="selected" value=$options.id}
                                            {/if}
                                            <p>
                                                <input type="radio" id="configoption{$options.id}" value="{$options.id}" name="configoption[{$configoption.id}]" {if $selected eq $options.id} checked="checked"{/if} onclick="recalctotals()">
                                                <label for="configoption{$options.id}">{$options.nameonly}<span class="">{$currency.prefix}{$options.fullprice}</span></label>
                                            </p>
                                        {/if}
                                    {/foreach}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            {elseif $configoption.optionname eq "Additional Disk"}

                <div class="location-center">
                    <div class="row">
                        <div class="col-sm-12 col-md-12 col-lg-12">
                            <div class="bil-title">
                                <h4><img src="templates/orderforms/{$carttpl}/images/disk.svg" alt="disk">{$LANG.additionalDiskHeading}</h4>
                                <p>{$LANG.additionalDesc}</p>
                            </div>
                        </div>
                        <div class="col-sm-12 col-md-12 col-lg-12 mb-3">
                            <div class="list-section">
                                <div class="Diskconfig">
                                    <p>{$LANG.disk}</p>
                                    <p class="">{$LANG['billingCycle'|cat:$billingcycle]|ucfirst} {$LANG.price}</p>
                                </div>
                                <div class="list-radio-btn">
                                    {assign var="selected" value=0}

                                    {foreach key=num2 item=options from=$configoption.options}
                                        {if !$options.hidden}
                                            {if $configoption.selectedvalue eq $options.id}
                                                {assign var="selected" value=$options.id}
                                            {elseif !$selected}
                                                {assign var="selected" value=$options.id}
                                            {/if}
                                            <p>
                                                <input type="radio" id="configoption{$options.id}" value="{$options.id}" name="configoption[{$configoption.id}]" {if $selected eq $options.id} checked="checked"{/if}>
                                                <label for="configoption{$options.id}">{$options.nameonly}<span class="">{$currency.prefix}{$options.fullprice}</span></label>
                                            </p>
                                        {/if}
                                    {/foreach}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            {else}
                <div class="col-md-4 license{$configoption.optionname}">
                    <div class="billingcycle-box operating-box">
                        {if $configoption.optionname == 'SqlServer'}
                            <div class="lg-icons"><img src="templates/orderforms/{$carttpl}/images/lic-icon3.png" align="lic-icon1"></div>
                        {elseif $configoption.optionname == 'DirectAdmin'}
                            <div class="lg-icons"><img src="templates/orderforms/{$carttpl}/images/lic-icon4.png" align="lic-icon1"></div>
                        {elseif $configoption.optionname == 'CloudLinux'}
                            <div class="lg-icons"><img src="templates/orderforms/{$carttpl}/images/lic-icon6.png" align="lic-icon1"></div>
                        {elseif $configoption.optionname == 'Plesk'}
                            <div class="lg-icons"><img src="templates/orderforms/{$carttpl}/images/lic-icon5.png" align="lic-icon1"></div>
                        {else if $configoption.optionname eq "cPanel"}
                            <div class="lg-icons"><img src="templates/orderforms/{$carttpl}/images/lic-icon1.png" align="lic-icon1"></div>
                        {else if $configoption.optionname == 'Windows'}
                            <div class="lg-icons"><img src="templates/orderforms/{$carttpl}/images/lic-icon2.png" align="lic-icon1"></div>
                        {/if}
                        <h4>{$configoption.optionname}</h4>
                        <select name="configoption[{$configoption.id}]" onchange="recalctotals()" class="op-select">
                            {foreach key=num2 item=options from=$configoption.options}
                                <option value="{$options.id}"{if $configoption.selectedvalue eq $options.id} selected="selected"{/if}>{$options.name}</option>
                            {/foreach}
                        </select>
                    </div>
                </div>
            {/if}   
        {elseif $configoption.optiontype eq 2}
            <div class="col-sm-6">
                <div class="form-group">
                    <label for="inputConfigOption{$configoption.id}">{$configoption.optionname}</label>
                    {foreach key=num2 item=options from=$configoption.options}
                        <br />
                        <label>
                            <input type="radio" name="configoption[{$configoption.id}]" value="{$options.id}"{if $configoption.selectedvalue eq $options.id} checked="checked"{/if} />
                            {if $options.name}
                                {$options.name}
                            {else}
                                {$LANG.enable}
                            {/if}
                        </label>
                    {/foreach}
                </div>
            </div>
        {elseif $configoption.optiontype eq 3}
            {if $configoption.optionname eq "Snapshot"}
                <div class="location-center addonSection {if $configoption.selectedqty}active{/if}">
                    <div class="row">
                        <div class="col-sm-12 col-md-12 col-lg-12">
                            <div class="bil-title">
                                <!-- <h4><img src="templates/orderforms/{$carttpl}/images/snapshot.svg" alt="crt-icon4">{$LANG.snapshotHeading}</h4> -->
                                <h4 class="addonPrices" ><img src="templates/orderforms/{$carttpl}/images/snapshot.svg" alt="crt-icon4">{$configoption.options.0.name}</h4>
                                <p>{$LANG.snapshotDesc}</p>
                            </div>
                        </div>
                        <div class="col-sm-9 col-md-9 col-lg-9 mb-3">
                            <!-- <span class="addonPrices"> {$configoption.selectedoption}</span> -->
                            <input type="hidden" class="addonValue" name="configoption[{$configoption.id}]" value="{$configoption.selectedqty}"/>
                        </div> 
                    </div>
                </div>
            {elseif $configoption.optionname eq "Automated Backup"}
             <div class="location-center addonSection {if $configoption.selectedqty}active{/if}">
                <div class="row">
                    <div class="col-sm-12 col-md-12 col-lg-12">
                        <div class="bil-title">
                            <h4><img src="templates/orderforms/{$carttpl}/images/database.svg" alt="crt-icon4"> {$configoption.options.0.name}</h4>
                            <p>{$LANG.AutoBackupDesc}</p>
                    </div>
                    </div>
                    <div class="col-sm-9 col-md-9 col-lg-9 mb-3">
                        <!-- <span class="addonPrices"> {$configoption.options.0.name}</span> -->
                        <input type="hidden" class="addonValue" name="configoption[{$configoption.id}]" value="{$configoption.selectedqty}"/>
                    </div>
                </div>
            </div>
            {elseif $configoption.optionname eq "FTP Backup"}
                <div class="location-center addonSection {if $configoption.selectedqty}active{/if}">
                    <div class="row">
                        <div class="col-sm-12 col-md-12 col-lg-12">
                            <div class="bil-title">
                                <h4><img src="templates/orderforms/{$carttpl}/images/ftp-bckup.svg" alt="ftp-bckup"> {$configoption.options.0.name}</h4>
                                <p>{$LANG.backupSpaceDesc}</p>
                            </div>
                        </div>
                        <div class="col-sm-9 col-md-9 col-lg-9 mb-3">
                            <!-- <span class="addonPrices"> {$configoption.options.0.name}</span> -->
                            <input type="hidden" class="addonValue" name="configoption[{$configoption.id}]" value="{$configoption.selectedqty}"/>
                        </div>
                    </div>
                </div>
            
            {else}
                <div class="col-sm-6">
                    <div class="form-group">
                        <label for="inputConfigOption{$configoption.id}">{$configoption.optionname}</label>
                        <br />
                        <label>
                            <input type="checkbox" name="configoption[{$configoption.id}]" id="inputConfigOption{$configoption.id}" value="1"{if $configoption.selectedqty} checked{/if} />
                            {if $configoption.options.0.name}
                                {$configoption.options.0.name}
                            {else}
                                {$LANG.enable}
                            {/if}
                        </label>
                    </div>
                </div>

            {/if}
                
        {elseif $configoption.optiontype eq 4}
         <div class="location-center">
            <div class="row">
                <div class="col-sm-12 col-md-12 col-lg-12">
                    <div class="bil-title">
                        <h4><img src="templates/orderforms/{$carttpl}/images/crt-icon4.png" alt="crt-icon4"> Additional IP's</h4>
                        <p>Choose the operating system to install on your server.</p>
                    </div>
                    </div>
                    <div class="col-sm-12">
                        <div class="form-group">
                            {if $configoption.qtymaximum}
                                {if !$rangesliderincluded}
                                    <script type="text/javascript" src="{$BASE_PATH_JS}/ion.rangeSlider.min.js"></script>
                                    <link href="{$BASE_PATH_CSS}/ion.rangeSlider.css" rel="stylesheet">
                                    <link href="{$BASE_PATH_CSS}/ion.rangeSlider.skinModern.css" rel="stylesheet">
                                    {assign var='rangesliderincluded' value=true}
                                {/if}
                                <input type="text" name="configoption[{$configoption.id}]" value="{if $configoption.selectedqty}{$configoption.selectedqty}{else}{$configoption.qtyminimum}{/if}" id="inputConfigOption{$configoption.id}" class="form-control" />
                                <script>
                                    var sliderTimeoutId = null;
                                    var sliderRangeDifference = {$configoption.qtymaximum} - {$configoption.qtyminimum};
                                    // The largest size that looks nice on most screens.
                                    var sliderStepThreshold = 25;
                                    // Check if there are too many to display individually.
                                    var setLargerMarkers = sliderRangeDifference > sliderStepThreshold;

                                    jQuery("#inputConfigOption{$configoption.id}").ionRangeSlider({
                                        min: {$configoption.qtyminimum},
                                        max: {$configoption.qtymaximum},
                                        grid: true,
                                        grid_snap: setLargerMarkers ? false : true,
                                        onChange: function() {
                                            if (sliderTimeoutId) {
                                                clearTimeout(sliderTimeoutId);
                                            }

                                            sliderTimeoutId = setTimeout(function() {
                                                sliderTimeoutId = null;
                                                recalctotals();
                                            }, 250);
                                        }
                                    });
                                </script>
                            {else}
                                                        <div>
                                                            <input type="number" name="configoption[{$configoption.id}]" value="{if $configoption.selectedqty}{$configoption.selectedqty}{else}{$configoption.qtyminimum}{/if}" id="inputConfigOption{$configoption.id}" min="{$configoption.qtyminimum}" onchange="recalctotals()" onkeyup="recalctotals()" class="form-control form-control-qty" />
                                                            <span class="form-control-static form-control-static-inline">
                                                                    x {$configoption.options.0.name}
                                                                </span>
                                                        </div>
                                                    {/if}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
        {/if}
        
    {/foreach}
{else}
    {foreach $configurableoptions as $num => $configoption}
        {if $configoption.optiontype eq 1}
            <div class="col-sm-6">
                <div class="form-group">
                    <label for="inputConfigOption{$configoption.id}">{$configoption.optionname}</label>
                    <select name="configoption[{$configoption.id}]" id="inputConfigOption{$configoption.id}" class="form-control">
                        {foreach key=num2 item=options from=$configoption.options}
                            <option value="{$options.id}"{if $configoption.selectedvalue eq $options.id} selected="selected"{/if}>
                                {$options.name}
                            </option>
                        {/foreach}
                    </select>
                </div>
            </div>
        {elseif $configoption.optiontype eq 2}
            <div class="col-sm-6">
                <div class="form-group">
                    <label for="inputConfigOption{$configoption.id}">{$configoption.optionname}</label>
                    {foreach key=num2 item=options from=$configoption.options}
                        <br />
                        <label>
                            <input type="radio" name="configoption[{$configoption.id}]" value="{$options.id}"{if $configoption.selectedvalue eq $options.id} checked="checked"{/if} />
                            {if $options.name}
                                {$options.name}
                            {else}
                                {$LANG.enable}
                            {/if}
                        </label>
                    {/foreach}
                </div>
            </div>
        {elseif $configoption.optiontype eq 3}
                <div class="col-sm-6">
                    <div class="form-group">
                        <label for="inputConfigOption{$configoption.id}">{$configoption.optionname}</label>
                        <br />
                        <label>
                            <input type="checkbox" name="configoption[{$configoption.id}]" id="inputConfigOption{$configoption.id}" value="1"{if $configoption.selectedqty} checked{/if} />
                            {if $configoption.options.0.name}
                                {$configoption.options.0.name}
                            {else}
                                {$LANG.enable}
                            {/if}
                        </label>
                    </div>
                </div>
        {elseif $configoption.optiontype eq 4}
            <div class="col-sm-12">
                <div class="form-group">
                    <label for="inputConfigOption{$configoption.id}">{$configoption.optionname}</label>
                    {if $configoption.qtymaximum}
                        {if !$rangesliderincluded}
                            <script type="text/javascript" src="{$BASE_PATH_JS}/ion.rangeSlider.min.js"></script>
                            <link href="{$BASE_PATH_CSS}/ion.rangeSlider.css" rel="stylesheet">
                            <link href="{$BASE_PATH_CSS}/ion.rangeSlider.skinModern.css" rel="stylesheet">
                            {assign var='rangesliderincluded' value=true}
                        {/if}
                        <input type="text" name="configoption[{$configoption.id}]" value="{if $configoption.selectedqty}{$configoption.selectedqty}{else}{$configoption.qtyminimum}{/if}" id="inputConfigOption{$configoption.id}" class="form-control" />
                        <script>
                            var sliderTimeoutId = null;
                            var sliderRangeDifference = {$configoption.qtymaximum} - {$configoption.qtyminimum};
                            // The largest size that looks nice on most screens.
                            var sliderStepThreshold = 25;
                            // Check if there are too many to display individually.
                            var setLargerMarkers = sliderRangeDifference > sliderStepThreshold;

                            jQuery("#inputConfigOption{$configoption.id}").ionRangeSlider({
                                min: {$configoption.qtyminimum},
                                max: {$configoption.qtymaximum},
                                grid: true,
                                grid_snap: setLargerMarkers ? false : true,
                                onChange: function() {
                                    if (sliderTimeoutId) {
                                        clearTimeout(sliderTimeoutId);
                                    }
                                    sliderTimeoutId = setTimeout(function() {
                                        sliderTimeoutId = null;
                                            recalctotals();
                                        }, 250);
                                    }
                                });
                        </script>
                    {else}
                        <div>
                            <input type="number" name="configoption[{$configoption.id}]" value="{if $configoption.selectedqty}{$configoption.selectedqty}{else}{$configoption.qtyminimum}{/if}" id="inputConfigOption{$configoption.id}" min="{$configoption.qtyminimum}" onchange="recalctotals()" onkeyup="recalctotals()" class="form-control form-control-qty" />
                            <span class="form-control-static form-control-static-inline">
                            x {$configoption.options.0.name}
                            </span>
                        </div>
                    {/if}
                </div>
            </div>
        {/if}
        {if $num % 2 != 0}
            </div>
            <div class="row">
        {/if}
        {/foreach}
{/if}
        </div>
                </div>

                        {/if}

                        {if $customfields}

                            <div class="sub-heading pb-1">
                                <span class="primary-bg-color">{$LANG.orderadditionalrequiredinfo}<br><i><small>{lang key='orderForm.requiredField'}</small></i></span>
                            </div>

                            <div class="field-container">
                                {foreach $customfields as $customfield}
                                    <div class="form-group">
                                        <label for="customfield{$customfield.id}">{$customfield.name} {$customfield.required}</label>
                                        {$customfield.input}
                                        {if $customfield.description}
                                            <span class="field-help-text">
                                                {$customfield.description}
                                            </span>
                                        {/if}
                                    </div>
                                {/foreach}
                            </div>

                        {/if}

                        {if $addons || count($addonsPromoOutput) > 0}

                            <div class="sub-heading">
                                <span class="primary-bg-color">{$LANG.cartavailableaddons}</span>
                            </div>

                            {foreach $addonsPromoOutput as $output}
                                <div>
                                    {$output}
                                </div>
                            {/foreach}

                            <div class="row addon-products">
                                {foreach $addons as $addon}
                                    <div class="col-sm-{if count($addons) > 1}6{else}12{/if}">
                                        <div class="panel card panel-default panel-addon{if $addon.status} panel-addon-selected{/if}">
                                            <div class="panel-body card-body">
                                                <label>
                                                    <input type="checkbox" name="addons[{$addon.id}]"{if $addon.status} checked{/if} />
                                                    {$addon.name}
                                                </label><br />
                                                {$addon.description}
                                            </div>
                                            <div class="panel-price">
                                                {$addon.pricing}
                                            </div>
                                            <div class="panel-add">
                                                <i class="fas fa-plus"></i>
                                                {$LANG.addtocart}
                                            </div>
                                        </div>
                                    </div>
                                {/foreach}
                            </div>

                        {/if}

                        <div class="alert alert-warning info-text-sm">
                            <i class="fas fa-question-circle"></i>
                            {$LANG.orderForm.haveQuestionsContact} <a href="{$WEB_ROOT}/contact.php" target="_blank" class="alert-link">{$LANG.orderForm.haveQuestionsClickHere}</a>
                        </div>

                    </div>
                    <div class="secondary-cart-sidebar" id="scrollingPanelContainer">

                        <div id="orderSummary">
                            <div class="order-summary">
                                <div class="loader" id="orderSummaryLoader">
                                    <i class="fas fa-fw fa-sync fa-spin"></i>
                                </div>
                                <h2 class="font-size-30">{$LANG.ordersummary}</h2>
                                <div class="summary-container" id="producttotal"></div>
                            </div>
                            <div class="text-center">
                                <button type="submit" id="btnCompleteProductConfig" class="btn btn-primary btn-lg">
                                    {$LANG.continue}
                                    <i class="fas fa-arrow-circle-right"></i>
                                </button>
                            </div>
                        </div>

                    </div>

                </div>

            </form>
        </div>

    {/if}    
    </div>
</div>

<script>

$(document).ready(function() {


    $(document).on("click", "#billingcycle .billingcycle", function(){
        $("#updatebillingcycle").val($(this).data("billingcycle"));
        $("#billingcycle").find(".active").removeClass("active");
        $(this).find(".billing-inner").addClass("active");
        updateConfigurableOptions($("#i").val(), $(this).data("billingcycle"))
        recalctotals();
    })
    $(document).on("click", ".billingcycle-box.licenseControl", function(e){
        $(".location-center .licenseControl").find(".active").removeClass("active");
        $(this).addClass("active");
        if(e.target.tagName == "SELECT"){
            $("#customConfigVal").val(e.target.value);
        }else{
            $("#customConfigVal").val($(this).data("id"));
        }
        recalctotals();

    })
    $(document).on("click", ".billingcycle-box.osVersion", function(e){
       
        $(".location-center .licenseOS.Version").find(".active").removeClass("active");
        $(this).addClass("active");
        if(e.target.tagName == "SELECT"){
            $("#customOSConfigVal").val(e.target.value);
        }else{
            $("#customOSConfigVal").val($(this).data("id"));
        }
        recalctotals();

    })

    $('.billingcycle-box.config-box.serverLocation').on('click', function(e) {
        let selectedvalue = $(this).data("id");
        $("#serverLocation").find(".active").removeClass("active");
        $(this).addClass("active");
        $("#customServerLocationConfigVal").val(selectedvalue);
        recalctotals();
        return false;
    });
    $('.billingcycle-box.additionalIps').on('click', function(e) {
        let selectedvalue = $(this).find(".radio-custom").data("id");
        $(this).find(".radio-custom").iCheck('check');
        $("#customAdditionalIpConfigVal").val(selectedvalue);
        recalctotals();
    });

    // showing/hidding options on change of the os family
    $(document).on("change", "#osFamily", function(e) {
        e.stopPropagation();
        let osFamily = $(this).find(':selected').text();

        showHideOptions(osFamily);
    });

    // showing/hidding options on page load 
    if($("#osFamily").find(':selected').text()){
        showHideOptions($("#osFamily").find(':selected').text());
    }
    

    $(document).on("click", ".location-center.addonSection", function(){
        if($(this).find(".addonValue").val() == 0){
            $(this).addClass("active");
            $(this).find(".addonValue").val(1)
         }else{ 
            $(this).removeClass("active");
            $(this).find(".addonValue").val("0")
        }
        recalctotals();            
    })

    recalctotals();
    
});


const showHideOptions = (osFamily) => {
    
    const hideOptions = {
        "Windows": ["AlmaLinux", "Ubuntu", "Rocky", "Fedora", "Debian", "Centos", "cPanel", "CPanel", "CloudLinux", "FreeBSD"],
        "OS Linux": ["Windows"], 
        "None": ["Windows","AlmaLinux", "Ubuntu", "Rocky", "Fedora", "Debian", "Centos","Plesk", "cPanel", "CPanel", "CloudLinux", "FreeBSD"], 
    };

    $(".licenseOS.Version").show();
    $(".licenseControl.Panel").show();
    $("#productConfigurableOptions .error").hide();
    $("#btnCompleteProductConfig").attr("disabled", false)

    if (osFamily && osFamily.includes("windows") || osFamily.includes("Windows")) {
        osFamily = "Windows";
    } else if (osFamily && (osFamily.includes("linux") || osFamily.includes("Linux"))) {
        osFamily = "OS Linux";
    } else {
        osFamily = osFamily;
    }
    if (hideOptions[osFamily] && osFamily) {
       hideOptions[osFamily].forEach(os => {
        const el = document.getElementById(os);
        if (el) {
            el.style.display = "none";
        }
    });

    }
    if(osFamily == "None"){
        $("#productConfigurableOptions .error").show();
        $("#btnCompleteProductConfig").attr("disabled", true)
    }

}

</script>
