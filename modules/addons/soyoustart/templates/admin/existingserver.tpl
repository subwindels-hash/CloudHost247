{include file=$tplVar.header}

<div class="innerContent">
    <ul class="nav nav-tabs">
        <li class="tab existactive" id="existtab">
            <input id="servicetyp1" name="existingsetting" type="button" value="Existing"
                class="serverBproperty activeButton">&nbsp;
        </li>&nbsp;&nbsp;
        <li class="tab" id="newtab">
            <input id="servicetyp2" name="existingsetting" type="button" class="serverBproperty"
                value="New">&nbsp;&nbsp;
        </li>
    </ul>

    <form method="post" action="" id="existingserver">
        <div class="tab-pane-exist existingactive">
        <div class="alert alert-secondary existingserver_existing_note" role="alert">{$tplVar['_lang']['existingserver_existing_note']}
            <span class="documentation"><a href="https://wiki.whmcsglobalservices.com/index.php?title=WHMCS_OVH_Module_Installation_Guide_%26_Documentation#How_to_Assign_Existing_OVH_server_in_WHMCS" target="_blank"> {$tplVar['_lang']['doc']}</a> </span>
        </div>
            <div class="container form datatable" id="existingform">
                <div class="row">
                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="useridexist">{$tplVar['_lang']['client']}</label>
                            <select name="userexist" class="form-control userselectexist select2" id="useridexist">
                                <option value="" disabled selected>Select Client</option>
                                {foreach $tplVar["users"] as $value}
                                    <option value='{$value->id}'>{$value->firstname} {$value->lastname}</option>
                                {/foreach}
                            </select>
                        </div>
                    </div>

                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="servertype">{$tplVar['_lang']['existingserver']}</label>
                            <select name="service" class="form-control" id="service-list">
                                <option value="" id="services" disabled selected>Select Service</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="row">
                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="server">{$tplVar['_lang']['serverLocation']}</label>
                            <select name="locationexist" class="form-control location_provider location-list"
                                id="location-list">
                                <option value="none" selected disabled>None</option>
                                {foreach from=$tplVar["serverLocation"] key=key item=location}
                                    {if $location neq "World"}
                                        <option value="{$key}">{$location}</option>
                                    {/if}
                                {/foreach}
                            </select>
                        </div>
                    </div>

                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="servertype">{$tplVar['_lang']['Account-Number']}</label>
                            <select name="accountexist" class="form-control account-list" id="account-list">
                                <option value="" disabled selected>Select Account</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div class="row">
                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="">{$tplVar['_lang']['OVHServername']}</label>
                            <input type="text" class="form-control ovhservernameexist" name="ovhservernameexist" placeholder="{$tplVar['_lang']['OVHServernamePlaceholder']}" value="">
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="">{$tplVar['_lang']['OVHCustomHostName']}</label>
                            <input type="text" class="form-control ovhCustomHostName" name="newovhCustomHostName" placeholder="{$tplVar['_lang']['OVHCustomHostNamePlaceholder']}" value="">
                        </div>
                    </div>
                </div>
                <div class="btn-container">
                    <input type="submit" id="submit" name="existServer" class="btn btn-info" value="Assign Existing Server">
                </div>
            </div>
        </div>
        <div class="tab-pane-new">
        <div class="alert alert-secondary existingserver_new_note" role="alert" hidden>{$tplVar['_lang']['existingserver_new_note']}
            <span class="documentation"><a href="https://wiki.whmcsglobalservices.com/index.php?title=WHMCS_OVH_Module_Installation_Guide_%26_Documentation#How_to_Assign_Existing_OVH_server_in_WHMCS" target="_blank"> {$tplVar['_lang']['doc']}</a> </span>
        </div>
            <div class="container form datatable" id="newform" style="display:none;">
                <div class="row">
                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="">{$tplVar['_lang']['client']}</label>
                            <select name="userexist" class="form-control userselectew select2">
                                <option value="" disabled selected>Select Client</option>
                                {foreach $tplVar["users"] as $value}
                                    <option value='{$value->id}'>{$value->firstname} {$value->lastname}</option>
                                {/foreach}
                            </select>
                        </div>
                    </div>

                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="servertype">{$tplVar['_lang']['product']}</label>
                            <select name="product" class="form-control" id="product-list">
                                <option value="" disabled selected>Select Product</option>
                                {foreach $tplVar["Products"] as $value}
                                    <option value='{$value->id}'>{$value->name}</option>
                                {/foreach}
                            </select>
                        </div>
                    </div>
                </div>
                <div class="row">
                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="server">{$tplVar['_lang']['paymentMethod']}</label>
                            <select name="payment" class="form-control" id="payment-list">
                                <option value="" disabled selected>Select Payment Method</option>
                                {foreach $tplVar["paymentMethods"] as $value}
                                    <option value='{$value->gateway}'>{$value->gateway}</option>
                                {/foreach}
                            </select>
                        </div>
                    </div>

                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="servertype">{$tplVar['_lang']['billingCycle']}</label>
                            <select name="billing" class="form-control" id="billing-list">
                                <option value="" disabled selected>Select Billing Option</option>
                                <option value="monthly" selected>Monthly</option>
                                <option value="quartly">Quarterly</option>
                                <option value="semiannually">Semi Annually</option>
                                <option value="annualy">Annually</option>
                                <option value="binary">Biennially</option>
                                <option value="trianualy">Triannually</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div class="row">
                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="server">{$tplVar['_lang']['serverLocation']}</label>
                            <select name="location" class="form-control location_provider location-list"
                                id="location-list">
                                <option value="" disabled selected>None</option>
                                {foreach from=$tplVar["serverLocation"] key=key item=location}
                                    {if $location neq "World"}
                                        <option value="{$key}">{$location}</option>
                                    {/if}
                                {/foreach}
                            </select>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="server">{$tplVar['_lang']['Account-Number']}</label>
                            <select name="account" class="form-control account-list" id="account-listnew">
                                <option value="" disabled selected>Select Account</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="row">
                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="server">{$tplVar['_lang']['OVHServername']}</label>
                            <input type="text" class="form-control validate_servernew" placeholder="{$tplVar['_lang']['OVHServernamePlaceholder']}" name="ovhservername" value="">
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="">{$tplVar['_lang']['OVHCustomHostName']}</label>
                            <input type="text" class="form-control validate_server" name="ovhCustomHostName" placeholder="{$tplVar['_lang']['OVHCustomHostNamePlaceholder']}" value="">
                        </div>
                    </div>
                </div>
                <div class="row">
                    <div class="col-md-6">
                        <div class="form-group">
                            <input type="checkbox" name="invoice" class="" id="chk"> &nbsp;
                            {$tplVar['_lang']['createInvoice']} &nbsp;&nbsp;&nbsp;
                            <input type="checkbox" name="email" id="email"> &nbsp; {$tplVar['_lang']['sendEmail']}
                        </div>
                    </div>
                </div>
                <div id="productConfigoptions"></div>
                <div class="btn-container">
                    {* <input type="button" id="newServer" name="newServer" class="btn btn-info" value="Create New Service"> *}
                    <button type="button" id="newServer" name="newServer" class="btn btn-info" value="Create New Service"> Create New Service </button>
                    {* <input type="button" id="newServer" name="newServer" class="btn btn-info" value="Create New Service"> *}
                </div>
            </div>
        </div>

    </form>

</div>

{include file=$tplVar.footer}