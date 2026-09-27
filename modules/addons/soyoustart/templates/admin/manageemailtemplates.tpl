{include file=$tplVar.header}
<script src="{$tplVar.urlPath}templates/assets/tinymce/tinymce.min.js"></script>

<div class="alert alert-secondary message">{$tplVar['_lang']['manageemailtemplates_note']}
    <span class="documentation"><a href="https://wiki.whmcsglobalservices.com/index.php?title=WHMCS_OVH_Module_Installation_Guide_%26_Documentation#Email_Template_Setup" target="_blank"> {$tplVar['_lang']['doc']}</a> </span>
</div>

<div class="tab0box" id="tab0box">
    <div id="tab_content">
        <table style="width:100%;margin: 10px;{if $smarty.get.tab eq "edittemplate"}display:none; {/if}" id="displayRec" cellspacing="1" cellpadding="3" class="datatable">
            <thead>
                <tr>
                    <th width="20"><input type="checkbox" id="checkall0"></th>
                    <th>{$tplVar['_lang']['emailtemplate']}</th>
                    <th>{$tplVar['_lang']['status']}</th>
                    <th>{$tplVar['_lang']['disable']}</th>
                    <th>{$tplVar['_lang']['actions']}</th>
                </tr>
            </thead>
            <tbody>
                {if !empty($tplVar["custommailTemplate"])}

                {foreach $tplVar["custommailTemplate"] as $emailTemplate }
                <tr>
                    <td>
                        {if $emailTemplate->disabled eq "0"}
                        <input type="checkbox" name="selectedorders[]" value="{$emailTemplate->id}" class="checkall">
                        {/if}
                    </td>
                    <td align="center">{$emailTemplate->name}</td>
                    <td align="center"> {if $emailTemplate->disabled eq "0"} <span class="badge badge-success">Enabled</span>  {else}  <span class="badge badge-secondary">Disabled</span> {/if}</td>
                    <td align="center">
                        {if $emailTemplate->disabled eq "0"}
                        <img src="{$tplVar.urlPath}templates/assets/images/disable.png" title="Disable" onclick="disableTemplate(this, '{$emailTemplate->id}');">
                        {else}
                        <img src="{$tplVar.urlPath}templates/assets/images/enable.png" title="Enable" onclick="enableTemplate(this, '{$emailTemplate->id}');">
                        {/if}
                    </td>
                    <td align="center">
                        <a href="{$tplVar.moduleLink}&action=manageemailtemplates&tab=edittemplate&templateId={$emailTemplate->id}">
                            <img src="{$tplVar.urlPath}templates/assets/images/edit.png" title="Edit" onclick="editTemplate('{$emailTemplate->id}');">
                        </a>
                    </td>
                </tr>
                {/foreach}
                {else}
                <tr>
                    <td colspan="5">{$tplVar['_lang']['notemplate']} </td>
                </tr>
                {/if}
            </tbody>
            <tfoot>
                <tr>
                    <td colspan="5">
                        <p>{$tplVar['_lang']['disableddelctemp']} 

                            <button class="btn btn-danger" onclick="disableSelected();" id="disable"> Disable</button>
                            {* <input type="button" name="disable_all" class="btn btn-danger" onclick="disableSelected();" value="Disable" id="disable"> *}
                        </p>
                    </td>
                </tr>
            </tfoot>
        </table>

        {if $smarty.get.tab eq "edittemplate"}
        <p align="center" style="margin-top: 15px"><b>{$tplVar['_lang']['templatedesired']}"{$tplVar["editTemplateData"]["0"]->name}"</b></p>
        <form method="POST" action="">
            <input type="hidden" name="templateId" value="{$tplVar['editTemplateData']['0']->id}">

            <label>{$tplVar['_lang']['subject']} :</label><input type="text" name="tempsubject" id="tempsubject" size="80" class="form-control" style="margin-left: 5px" value="{$tplVar['editTemplateData']['0']->subject}"><br><br>
            <textarea rows="7" style="width:100%" name="message" id="email_msg" class="tinymce">{$tplVar['editTemplateData']['0']->message}</textarea>
            <p align="center" style="margin-top: 10px">
                <input type="submit" name="updateTemplateData" value="Save" class="btn btn-primary">
                <a href="{$tplVar.moduleLink}&action=manageemailtemplates" class="btn btn-info" name="back">Back</a>
            </p>
        </form>

        <p><b>{$tplVar['_lang']['availabletemplate']}</b></p>
        <div style="border:1px solid #8FBCE9;background:#ffffff;color:#000000;padding:5px;height:150px;overflow:auto;font-size:13px;z-index:10;">
            {if $tplVar["editTemplateData"]["0"]->name eq 'Server Re-installed'}
            {literal}{$clientname} <br>{$ip_address}<br>{$custom_server_name}<br>{$operating_system}<br>{$custom_user_account}<br>{$new_password}<br>{$plesk_detail}<br>{$otherDetails}
            {/literal}
            {elseif $tplVar["editTemplateData"]["0"]->name eq 'Hardware Reboot' }
                {literal}{$clientname}<br>{$custom_server_name}<br>{$operating_system}{/literal}
            {elseif $tplVar["editTemplateData"]["0"]->name eq 'Ftp Backup Password change'}
                {literal}{$clientname}<br>{$ftp_server_name}<br>{$new_password}{/literal}
            {elseif $tplVar["editTemplateData"]["0"]->name eq 'Server Details'}
                {literal}{$server_ipaddress}<br>{$server_username}<br>{$server_password}{/literal}
            {elseif $tplVar["editTemplateData"]["0"]->name eq 'Rescue-Pro Mode'}
                {literal}{$clientname}<br>{$ipaddress}<br>{$username}<br>{$password}{/literal}
            {elseif $tplVar["editTemplateData"]["0"]->name eq 'BSD10 Rescue mode' }
                {literal}{$clientname}<br>{$username}<br>{$password} {/literal}
            {elseif $tplVar["editTemplateData"]["0"]->name eq 'Service Monitoring' }
                {literal}{$clientname}<br>{$details}{/literal}
            {elseif $tplVar["editTemplateData"]["0"]->name eq 'Detection of an attack on IP' }
                {literal}{$ipaddress}{/literal}
            {elseif $tplVar["editTemplateData"]["0"]->name eq 'Spam Detected' }
                {literal}{$ipaddress}<br>{$detected_detail}{/literal}
            {elseif $tplVar["editTemplateData"]["0"]->name eq 'Anti-hack' }
                {literal}{$server_name}<br>{$detail}{/literal}
            {elseif $tplVar["editTemplateData"]["0"]->name eq 'Monitoring Online' }
                {literal}{$server_name}<br>{$details}{/literal}
            {elseif $tplVar["editTemplateData"]["0"]->name eq 'Operation Hard Reboot Finished' }
                {literal}{$server}<br>{$detail}{/literal}
            {elseif $tplVar["editTemplateData"]["0"]->name eq 'Additional IP addresses' }
                {literal}{$ipaddress}{/literal}
            {elseif $tplVar["editTemplateData"]["0"]->name eq 'Additional Disk' }
                {literal}{$diskDetail}{/literal}
            {elseif $tplVar["editTemplateData"]["0"]->name eq 'End of Attack' or $tplVar["editTemplateData"]["0"]->name == 'Detection of an attack' }
                {literal}{$ipaddress}{/literal}
            {else}
                {literal}{$clientname}<br>{$custom_server_name}<br>{$new_password}<br>{$ftp_server_name}{/literal}
            {/if}
        </div>
        {/if}
    </div>
</div>

<script>
    tinymce.init({
        selector: 'textarea.tinymce',
        content_css: [
            '//www.tiny.cloud/css/codepen.min.css'
        ],
        plugins: [
            'advlist autolink lists link image charmap print preview anchor textcolor',
            'searchreplace visualblocks code fullscreen',
            'insertdatetime media table paste code help wordcount'
        ],
        valid_elements: '@[id|class|style|title|href|src|alt"],h1,h2,h3,h4,h5,h6,div,p,img,a,ul,li,i,span,br,hr,table,tbody,thead,tr,th,td,button,[size|noshade]'
    });
</script>



{include file=$tplVar.footer}