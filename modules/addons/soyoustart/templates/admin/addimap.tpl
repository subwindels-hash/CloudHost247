{include file=$tplVar.header}
<div id="tab_content">

    <div class="alert alert-secondary" role="alert"> {$tplVar['_lang']['addimap_note']}
        <span class="documentation"><a href="https://wiki.whmcsglobalservices.com/index.php?title=OVH_whmcs_module#Email_Import_Settings" target="_blank"> {$tplVar['_lang']['doc']}</a> </span>
    </div>

    <div style="margin: 4px 0px -35px 5px;font-family: arial;color: #666;font-size: 27px;letter-spacing: 0.5px;text-align: left;">
        {$tplVar['_lang']['imapSetting']}
        <a href="{$tplVar.moduleLink}&action=imapsetting"><input type="button" style="float:right;" class="btn btn-info"
                value="{$tplVar['_lang']['back']}"></a>
    </div>
    <br><br>
    <ul class="nav nav-tabs">
        <li class="tab {if $smarty.get.tab eq 'editWebMail' } webactive {elseif $smarty.get.tab eq 'imapsetting'}  webactive {/if}"
            id="webtab">
            <input type="button" name='mailsettigs' class="bproperty" id="mailconf" value='Webmail'>
        </li>&nbsp;&nbsp;
        <li class="tab {if $smarty.get.tab eq 'edit' } gmailactive {/if}" id="gmailtab">
            <input type="button" name='mailsettigs' class="bproperty" id="mailconf2" value='Gmail'>
        </li>
    </ul>
    <br>
    <div id="gmaildiv" {if $smarty.get.tab eq "edit" } style="display: block;" {else} style="display: none;" {/if}>
        <form method="post" id="gmailSettingform" action="">
            <div class="tab-pane gmailtabactive">
                <div class="container form webform">
                    <div class="row">
                        <div class="col-md-12 text-center bg-primary text-white glink">
                            <a style="color:white" href="https://console.developers.google.com/" target="_blank">Make
                                project on your google account by clicking this link and copy and paste the clientid and
                                secretkey below</a>
                        </div>
                    </div>
                    <div class="row">
                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="server">{$tplVar['_lang']['accountuser']}</label>
                                <select name="gmailUserAccount" id="uAccount" class="form-control">
                                    {* <option value="wgsdevelopers@gmail.com">wgsdevelopers@gmail.com</option> *}

                                    {foreach from=$tplVar.allOvhAccounts item=ovhAccount key=key }
                                        <option value="{$ovhAccount->account_number}_{$ovhAccount->location}">
                                            {$ovhAccount->account_number}({$ovhAccount->location})</option>
                                    {/foreach}
                                </select>
                            </div>
                        </div>

                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="servertype">{$tplVar['_lang']['appClientID']}</label>
                                <input type="text" value="{$tplVar.gmailImapDatas['0']->gmail_clientId}"
                                    name="gclientid" id="gclientid" class="form-control">
                            </div>
                        </div>
                    </div>
                    <div class="row">
                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="server">{$tplVar['_lang']['appSecretkey']}</label>
                                <input type="text" value="{$tplVar.gmailImapDatas['0']->gmail_secretkey}"
                                    name="gclientSecret" id="gclientSecret" class="form-control">
                            </div>
                        </div>

                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="servertype">{$tplVar['_lang']['email']}</label>
                                <input type="text" value="{$tplVar.gmailImapDatas['0']->gmailaddr}" name="gmailaddr"
                                    id="gmailaddr" class="form-control">
                            </div>
                        </div>
                    </div>
                    <div class="row">
                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="server">{$tplVar['_lang']['language']}</label>
                                <select name="language" id="gclanguage" class="form-control">
                                    <option value="english">English</option>
                                    <option value="french">French</option>
                                    <option value="spanish">Spanish</option>
                                    <option value="portuguese">Portuguese</option>
                                    <option value="italian">Italian</option>
                                    <option value="german">German</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div class="btn-container">
                        {if isset($tplVar.gmailImapDatas)}
                            <td style="float: right;"><input type="submit" id="saveGsettings" value="Edit"
                                    name="editGsettings" class="btn btn-info"></td>
                        {else}
                            <td style="float: right;"><input type="submit" id="saveGsettings" value="Save"
                                    name="saveGsettings" class="btn btn-info"></td>
                        {/if}
                    </div>
                </div>
            </div>
        </form>

    </div>

    <form method="post" name="soyoustartform" id="imapform" action="" {if $smarty.get.tab eq "editWebMail" }
        style="display: block;" {elseif !isset( $smarty.get.id)} style="display: block;" 
        {else} style="display: none;"
        {/if}>
        <div class="tab-pane webmailactive">
            <div class="container form webform">
                <div class="row">
                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="server">{$tplVar['_lang']['accountuser_addimap']}</label>
                            <select name="userAccount" id="userAccount" class="form-control">
                               
                                {foreach from=$tplVar.allOvhAccounts item=ovhAccount key=key }
                                    <option value="{$ovhAccount->account_number}_{$ovhAccount->location}">
                                        {$ovhAccount->account_number}({$ovhAccount->location})</option>
                                {/foreach}
                            </select>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="server">{$tplVar['_lang']['incomingmailservername_addimap']}</label>
                            <input type="text" required name="hostname" placeholder="mymailserver.com" id="hostname"
                                value="{$tplVar.webMailImapDatas['0']->soyouimaphost}" class="form-control">
                        </div>
                    </div>
                </div>
                <div class="row">
                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="server">{$tplVar['_lang']['portnumber_addimap']}</label>
                            <input type="text" name="portnumber" id="portnumber" required placeholder="143"
                                value="{$tplVar.webMailImapDatas['0']->soyouimapport}" class="form-control">
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="server">{$tplVar['_lang']['ssltype_addimap']}</label>
                            <select required="" name="ssltype" id="ssltype" class="form-control">
                                <option value="default">Default</option>
                                <option value="tls">TLS</option>
                                <option value="ssl">SSL</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="row">
                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="server">{$tplVar['_lang']['username_addimap']}</label>
                            <input type="text" required name="username" id="username"
                                value="{$tplVar.webMailImapDatas['0']->soyouimapuser}" class="form-control">
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="server">{$tplVar['_lang']['password_addimap']}</label>
                            <input type="password" required name="password" id="password"
                                value="{$tplVar.webMailImapDatas['0']->soyouimappass}" class="form-control">
                        </div>
                    </div>
                </div>
                <div class="row">
                    <div class="col-md-6">
                        <div class="form-group">
                            <label for="server">{$tplVar['_lang']['language_addimap']}</label>
                            <select name="language" id="webMAilLanguage" required class="form-control">
                                <option value="english">English</option>
                                <option value="french">French</option>
                                <option value="spanish">Spanish</option>
                                <option value="portuguese">Portuguese</option>
                                <option value="italian">Italian</option>
                                <option value="german">German</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="btn-container">

                    {if $smarty.get.tab eq "editWebMail"}
                        <button class="btn btn-info" type="button" id="addWebmail">Update</button> 
                    {else}
                        <button class="btn btn-info" type="button" id="addWebmail">Add Webmail</button> 

                    {/if}

                    <button class="btn btn-info" type="button" id="testWebMail">Test Connection </button>

                </div>

            </div>
        </div>
    </form>
</div>


<script>
    $("#gclanguage option").each(function() {
        if ($(this).val() == '{$tplVar.gmailImapDatas["0"]->language}') {
        $(this).attr('selected', 'selected');
    }
    });

    $("#webMAilLanguage option").each(function() {
        if ($(this).val() == '{$tplVar.webMailImapDatas["0"]->language}') {
        $(this).attr('selected', 'selected');
    }
    });
    $("#ssltype option").each(function() {
        if ($(this).val() == '{$tplVar.webMailImapDatas["0"]->soyouimapssl}') {
        $(this).attr('selected', 'selected');
    }
    });
</script>

{include file=$tplVar.footer}