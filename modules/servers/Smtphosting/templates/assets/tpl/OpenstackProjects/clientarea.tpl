<div class="lu-tiles lu-row lu-row--eq-height">
    <div>
        <a class="mg-tile mg-tile--btn" href="{$panelLogin}" target="_blank">
            <div class="mg-i-c-6x">
                <img src="{$imgSrc}" alt="">
            </div>
            <div class="mg-tile__title">{$MGLANG->absoluteT('openstackLogin')}</div>
        </a>
    </div>
</div>
{if $serverStatus === 'Active'}
    <div class="panel panel-default">
        <div class="panel-heading"><b>{$MGLANG->T('serverInformation')}</b></div>
        <table class="table">
            <tbody>
            {foreach from=$details key=name item=value}
                {if $name === 'domain' && !$isShowDomainEnabled}
                    {continue}
                {/if}
                <tr role="row">
                    <td>{$MGLANG->T($name)}</td>
                    {if $name === 'password'}
                        <td>
                            <span class="password_element">
                                <input class="elementPasswordInput" type="password" value="{$value}" readonly=""
                                       style="margin-right:-24px">
                                <i class="elementPasswordIcon fas fa-eye-slash" onclick="changePasswordElement()"></i>
                            </span>
                        </td>
                    {else}
                        <td class="text-secondary">
                            {$value}
                        </td>
                    {/if}
                </tr>
            {/foreach}
            </tbody>
        </table>
    </div>
{/if}

<script>
    $('[menuitemname="panelLogin"').attr("href", "{$panelLogin}")

    function changePasswordElement()
    {
        var type = $('.elementPasswordInput').attr('type');

        if (type == "password")
        {
            $('.elementPasswordIcon').removeClass('fa-eye-slash');
            $('.elementPasswordIcon').addClass('fa-eye');
            $('.elementPasswordInput').attr('type', 'text')
        } else
        {
            $('.elementPasswordIcon').addClass('fa-eye-slash');
            $('.elementPasswordIcon').removeClass('fa-eye');
            $('.elementPasswordInput').attr('type', 'password')
        }
    }
</script>
