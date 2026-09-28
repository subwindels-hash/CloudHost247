<div class="submitticketstepone">
    <p>{$LANG.supportticketsheader}</p>
    <h3 class="ticketh3">{$LANG.supportticketschoosedepartment}</h3>
    <div class="choose-more-product">
        <div class="row"> 		
                {foreach from=$departments key=num item=department}
                    <div class="col-sm-12 col-md-4 departdiv">
                      <a href="{$smarty.server.PHP_SELF}?step=2&amp;deptid={$department.id}">
                        <div class="more-product-col">
                        {if !empty($hostx_theme_settings.{"dept_{$department.id}"})}
							<img src='{$hostx_theme_settings.{"dept_{$department.id}"}}' alt="{$WEB_ROOT}/templates/{$template}/images/sharedhosting.png">
                        {else}
							<img src="{$WEB_ROOT}/templates/{$template}/images/{if $num > 4}sharedhosting{else}ticketicon{$num}{/if}.png" alt="{$WEB_ROOT}/templates/{$template}/images/sharedhosting.png">
                        {/if}
                            <h3>{$department.name}</h3>
                            {if $department.description}
                                <span>{$department.description}</span>
                            {/if}
                        </div>
                      </a>
                    </div>
                {foreachelse}
                    {include file="$template/includes/alert.tpl" type="info" msg=$LANG.nosupportdepartments textcenter=true}
                {/foreach}           
        </div>
    </div>
</div>