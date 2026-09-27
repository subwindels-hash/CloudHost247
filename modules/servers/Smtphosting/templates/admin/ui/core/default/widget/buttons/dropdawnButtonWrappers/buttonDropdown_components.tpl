{**********************************************************************
* AmazonLightsail product developed. (2018-11-29)
* *
*
*  CREATED BY MODULESGARDEN       ->       http://modulesgarden.com
*  CONTACT                        ->       contact@modulesgarden.com
*
*
* This software is furnished under a license and may be used and copied
* only  in  accordance  with  the  terms  of such  license and with the
* inclusion of the above copyright notice.  This software  or any other
* copies thereof may not be provided or otherwise made available to any
* other person.  No title to and  ownership of the  software is  hereby
* transferred.
*
*
**********************************************************************}

{**
* @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
*}

<script type="text/x-template" id="t-mg-dropdawn-btn-wrapper-{$elementId|strtolower}"
        :component_id="component_id"
        :component_namespace="component_namespace"
        :component_index="component_index"
>
    <div class="lu-has-dropdown">
        <button @click="toogleDropdawn" class="mg-drop-target-btn lu-btn lu-btn--icon lu-btn--link lu-btn--default" data-tooltip="" data-title="{$MGLANG->T('More Actions')}">
            <i class="lu-btn__icon lu-zmdi lu-zmdi-more-vert"></i>
        </button>
        <div class="mg-drop-bg-wrapper" v-show="dropOpen" @click="hideDrop"></div>
        <div v-show="dropOpen" @click="notHideDrop" class="drop lu-drop-element drop-enabled drop-element-attached-top drop-element-attached-left drop-target-attached-bottom drop-target-attached-left drop-open drop-open-transitionend drop-after-open">
            <div class="drop-content">
                <div class="lu-dropdown" data-dropdown-menu="">
                    <div class="lu-dropdown__arrow" data-arrow="" style="left: auto; right: 10px;"></div>
                    <ul class="lu-dropdown__menu">
                        <li class="lu-dropdown__header">
                            <span class="lu-dropdown__title">{$MGLANG->T('Additional Actions')}</span>
                        </li>
                        {foreach from=$rawObject->getButtons() key=buttonKey item=buttonValue}
                            <li class="lu-dropdown__item">
                                {$buttonValue->getHtml()}
                            </li>
                        {/foreach}
                    </ul>
                </div>
            </div>
        </div>
    </div>
</script>
