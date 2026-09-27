{include file=$tplVar.header}

<div class="alert alert-secondary" role="alert">{$tplVar['_lang']['imapsetting_note']}
    <span class="documentation"><a
            href="https://wiki.whmcsglobalservices.com/index.php?title=WHMCS_OVH_Module_Installation_Guide_%26_Documentation#Email_Import_Settings"
            target="_blank"> {$tplVar['_lang']['doc']}</a> </span>

</div>
<div style="width: 100%; height: auto; float: left; padding-bottom: 5px; ">
    <a href="{$tplVar.moduleLink}&action=addimap&tab=imapsetting" style="float: right;"
        class="btn btn-info">{$tplVar['_lang']['addimapsetting']}</a>
</div>
<h1>{$tplVar['_lang']['webmail_imaps']}</h1>

<table class="datatable" width="100%" border="0" cellspacing="1" cellpadding="3" style="clear:both;">
    <thead>
        <tr>
            <th> &nbsp;{$tplVar['_lang']['accountuser']}</th>
            <th> &nbsp;{$tplVar['_lang']['username']}</th>
            <th> &nbsp;{$tplVar['_lang']['incomingmailservername']}</th>
            <th> &nbsp;{$tplVar['_lang']['portnumber']}</th>
            <th> &nbsp;{$tplVar['_lang']['ssltype']}</th>
            <th> &nbsp;{$tplVar['_lang']['status']}</th>
            <th> &nbsp;{$tplVar['_lang']['language']}</th>
            <th></th>
            <th></th>
        </tr>
    </thead>
    <tbody>
    <tbody>

        {foreach $tplVar.imapDatas as $value}
            <tr class="text-center">
                <td>{$value->account_user}</td>
                <td> {$value->soyouimapuser}</td>
                <td>{$value->soyouimaphost}</td>
                <td>{$value->soyouimapport}</td>
                <td>{$value->soyouimapssl|upper}</td>
                <td>
                    {if $value->status}
                        <span class="label active">{$value->status}</span>
                    {else}
                    {/if}
                </td>
                <td> {$value->language|capitalize}</td>
                <td>
                    <a href="{$tplVar.moduleLink}&amp;tab=editWebMail&amp;action=addimap&amp;id={$value->id}"><img
                            src="images/edit.gif" width="16" height="16" border="0" alt="Edit"></a>
                </td>
                <td>
                    <a href="{$tplVar.moduleLink}&amp;tab=delete&amp;action=imapsetting&amp;id={$value->id}"
                        onclick="return confirm('Are you sure want to delete this imap setting?');"><img
                            src="images/delete.gif" width="16" height="16" border="0" title="Delete"></a>
                </td>
                </td>
            </tr>
        {/foreach}
    </tbody>
    </tbody>
</table>

<h1><br>{$tplVar['_lang']['gmails']}</h1>


<table class="datatable" width="100%" border="0" cellspacing="1" cellpadding="3" style="clear:both;">

    <thead>
        <tr>
            <th>{$tplVar['_lang']['accountuser']}</th>
            <th>{$tplVar['_lang']['email']}</th>
            <th>{$tplVar['_lang']['appsecretkey']}</th>
            <th>{$tplVar['_lang']['status']}</th>
            <th>{$tplVar['_lang']['language']}</th>
            <th>{$tplVar['_lang']['taketoken']}</th>
            <th></th>
            <th></th>
        </tr>
    </thead>
    <tbody>

        {foreach $tplVar.gmailImapDatas as $value}
            <tr class="text-center">
                <td>{$value->account_user}</td>
                <td> {$value->gmailaddr}</td>
                <td>{$value->gmail_secretkey}</td>
                <td>
                    {if !empty($value->accesstoken) && !empty($value->refereshtoken)}
                        <span class="label active">Active</span>
                    {else}
                        <span class="label closed">Inactive</span>
                    {/if}
                </td>
                <td> {$value->language|capitalize}</td>
                <td>
                    <a class='login' href='{$tplVar.moduleLink}&action=imapsetting&account={$value->account_user}'>
                        <img height="40px" src="{$tplVar.urlPath}templates/assets/images/google-login-button-asif18.png" />
                    </a>
                </td>
                <td>
                    <a href="{$tplVar.moduleLink}&amp;tab=edit&amp;action=addimap&amp;id={$value->id}"
                        class="editcolor"><img src="images/edit.gif" width="16" height="16" border="0" alt="Edit"></a>
                </td>
                <td>
                    <a href="{$tplVar.moduleLink}&amp;tab=delete&amp;action=imapsetting&amp;id={$value->id}"
                        onclick="return confirm('Are you sure want to delete this imap setting?');"><img
                            src="images/delete.gif" width="16" height="16" border="0" title="Delete"></a>
                </td>
                </td>
            </tr>
        {/foreach}
    </tbody>
</table>



<h1><br>{$tplVar['_lang']['automationsettings']} </h1>
<div class="alert alert-warning text-center">
    <div style="width:100%; float: left; text-align:left; padding-bottom: 10px;">
        {$tplVar['_lang']['automationsettingstext']}</div>
    <div class="input-group">
        <input type="text" id="cronPhp" value="/usr/local/bin/php -q {$tplVar['crondirpath']}emailSend.php"
            class="form-control" onfocus="this.select()" onmouseup="return false;">
        <span class="input-group-addon" id="cronGet"
            style="background:{if $tplVar['cronConfigStatus']['emailSendcronstatus']["status"] eq 'Configured'} green; color:#fff; {else} yellow {/if}">{$tplVar["cronConfigStatus"]["emailSendcronstatus"]["status"]}</span>
    </div>
    <p class="text-left"><strong><small>Last Cron
                Invocation:{if $tplVar['cronConfigStatus']['emailSendcronstatus']["status"] eq 'Configured'}
                {$tplVar['cronConfigStatus']['emailSendcronstatus']["dateTime"]} {/if} </small> </strong></p>
    <strong>AND</strong><br>
    <div class="input-group">
        <input type="text" id="cronGet" value="/usr/local/bin/php -q {$tplVar['crondirpath']}getServer.php"
            class="form-control" onfocus="this.select()" onmouseup="return false;">
        <span class="input-group-addon" id="cronGet"
            style="background: {if $tplVar['cronConfigStatus']['getServercronstatus']["status"] eq 'Configured'} green; color:#fff {else} yellow {/if}">{$tplVar["cronConfigStatus"]["getServercronstatus"]["status"]}</span>
    </div>
    <p class="text-left"><strong><small>Last Cron Invocation:
                {if $tplVar['cronConfigStatus']['getServercronstatus']["status"] eq 'Configured'}
                {$tplVar['cronConfigStatus']['getServercronstatus']["dateTime"]} {/if} </small> </strong></p>
    <strong>AND</strong><br>
    <div class="input-group">
        <input type="text" id="cronGet" value="/usr/local/bin/php -q {$tplVar['crondirpath']}priceSync.php"
            class="form-control" onfocus="this.select()" onmouseup="return false;">
        <span class="input-group-addon" id="cronGet"
            style="background:{if $tplVar['cronConfigStatus']['priceSynccronstatus']["status"] eq 'Configured'} green; color:#fff; {else} yellow {/if}">{$tplVar["cronConfigStatus"]["priceSynccronstatus"]["status"]}</span>
    </div>
    <p class="text-left"><strong><small>Last Cron
                Invocation:{if $tplVar['cronConfigStatus']['priceSynccronstatus']["status"] eq 'Configured'}
                {$tplVar['cronConfigStatus']['priceSynccronstatus']["dateTime"]} {/if} </small> </strong></p>
    <strong>AND</strong><br>
    <div class="input-group">
        <input type="text" id="cronGet" value="/usr/local/bin/php -q {$tplVar['crondirpath']}getIpStatus.php"
            class="form-control" onfocus="this.select()" onmouseup="return false;">
        <span class="input-group-addon" id="cronGet"
            style="background:{if $tplVar['cronConfigStatus']['getIpCronstatus']["status"] eq 'Configured'} green; color:#fff; {else} yellow {/if}">{$tplVar["cronConfigStatus"]["getIpCronstatus"]["status"]}</span>
    </div>
    <p class="text-left"><strong><small>Last Cron
                Invocation:{if $tplVar['cronConfigStatus']['getIpCronstatus']["status"] eq 'Configured'}
                {$tplVar['cronConfigStatus']['getIpCronstatus']["dateTime"]} {/if} </small> </strong></p>
</div>
{include file=$tplVar.footer}