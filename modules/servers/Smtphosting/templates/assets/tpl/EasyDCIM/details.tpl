{if $someConditionIfErrorIsMet}

{elseif !empty($details)}
    <div class="panel panel-default">
        <!-- Default panel contents -->
        <div class="panel-heading"><b>Information</b></div>
        <table class="table">
            <tbody>
            {foreach from=$details key=name item=value}
                {if !empty($value)}
                    <tr>
                        <td>{{$MGLANG->T('EasyDCIM', $name)}}</td>
                        <td class="text-secondary">
                            {if $name =="deviceStatus"}
                                <span class="{if $value=='Running'}text-success{else}text-danger{/if}">
                                <i class="glyphicon glyphicon-play-circle"></i>
                                    {$value}
                                </span>
                            {elseif $name == 'ipaddresses'}
                                {foreach from=$value item=address}
                                    {$address} <br/>
                                {/foreach}
                            {else}
                                {trim($value)}
                            {/if}
                        </td>
                    </tr>
                {/if}
            {/foreach}
            </tbody>
        </table>
    </div>
{/if}
