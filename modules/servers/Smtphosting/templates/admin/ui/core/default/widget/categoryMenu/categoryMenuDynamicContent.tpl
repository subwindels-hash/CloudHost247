
{**********************************************************************
* AmazonLightsail product developed. (2017-08-24)
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

<mg-component-body-{$elementId} targetid="{$elementId}" namespace="{$namespace}" index="{$rawObject->getIndex()}" inline-template
                                makeCustomAction=makeCustomAction
                                component_id='{$elementId}'
                                component_namespace='{$namespace}'
                                component_index='{$rawObject->getIndex()}'
>
    <div class="lu-block">
        <div class="lu-block__sidebar">

            <div class="lu-widget" name="mgCategoryMenu" namespace="{$namespace}" index="{$rawObject->getIndex()}" id="{$elementId}">
                <div class="lu-widget__header">
                    <div class="lu-widget__top lu-top">
                        <div class="lu-top__title" v-show="!showSearch">
                            {if $rawObject->getIcon()}<i class="{$rawObject->getIcon()}"></i>{/if}
                            {$MGLANG->T('title')}
                        </div>
                        <div class="lu-top__toolbar">
                            {foreach from=$rawObject->getButtons() key=buttonKey item=buttonValue}{$buttonValue->getHtml()} {/foreach}
                            {$rawObject->insertHiddenSearchForm()}
                        </div>
                    </div>
                </div>
                {literal}
                <div class="lu-widget__body">
                    <div class="lu-preloader-container lu-preloader-container--full-screen lu-preloader-container--overlay" v-show="menuLoading">
                        <div class="lu-preloader lu-preloader--sm"></div>
                    </div>
                    <ul class="lu-nav lu-nav--tabs lu-nav--border-left {/literal}{if $rawObject->isvSortable()}vSortable{/if}{literal}" id="groupList">
                        <li v-for="(dataRow, index) in returnedData" :class="{ 'sortable-disabled' : dataRow.id == 0, 'lu-nav__item' : true, 'is-active': index === 0 }" :actionid="dataRow.id" :id="dataRow.elId">
                            <a href="javascript:;" class="lu-nav__link" v-on:click="reloadMenuContent(dataRow.elId, dataRow.namespace, dataRow.id)">
                                {/literal}{if $rawObject->isvSortable()}<span class="drag-and-drop-icon"><i class="lu-zmdi lu-zmdi-unfold-more"></i></span>{/if}{literal}
                                #{{ dataRow.id }} - {{ dataRow.title }}<span v-if="dataRow.count >= 0" class="badge badge--outline">{{ dataRow.count }}</span>
                                <span class="promoted-star-span" v-if="dataRow.suggested === 'on'">
                                    <i class="lu-zmdi lu-zmdi-star promoted-star"></i>
                                </span>
                            </a>
                            <ul class="nav nav--sub" v-if="dataRow.children && dataRow.children.length > 0">
                                <li v-for="(child, index) in dataRow.children" :class="{ 'lu-nav__item' : true }" :actionid="child.id" :id="child.elId">
                                    <a href="javascript:;" class="nav__link" v-on:click="reloadMenuContent(child.elId, child.namespace, child.id)">
                                        {/literal}{if $rawObject->isvSortable()}<span class="drag-and-drop-icon"><i class="zmdi zmdi-unfold-more"></i></span>{/if}{literal}
                                        #{{ child.id }} - {{ child.title }}
                                        <span class="promoted-star-span" v-if="child.suggested === 'on'">
                                            <i class="lu-zmdi lu-zmdi-star promoted-star"></i>
                                        </span>
                                    </a>
                                </li>
                            </ul>
                        </li>
                    </ul>
                    <div class="no-groups-found" v-show="showNoGroups">
                        {/literal}{$MGLANG->T('NoGroupsFoundSidebar')}{literal}
                    </div>
                </div>
            </div>
        </div>
        <div class="lu-block__body" id="itemContentContainer" v-show="!showNoGroups">
            <component :is="contentContainerName"></component>
        </div>
        <div class="lu-block__body" v-show="showNoGroups">
            <div class="lu-widget">
                <div class="lu-widget__body">
                    <div class="lu-zero-data">
                        <div class="lu-msg">
                            <div class="lu-msg__body">
                                <div class="lu-msg__title lu-type-4">
                                    {/literal}{$MGLANG->T('NoGroupsFoundTitle')}
                                </div>
                                <p class="lu-msg__description">
                                    {$MGLANG->T('NoGroupsFoundDescription')}
                                </p>
                                {if $rawObject->elementsExists('contentNotFoundButtons')}
                                    <div class="lu-msg__actions">
                                        {foreach from=$rawObject->getElements('contentNotFoundButtons') key=buttonKey item=buttonValue}{$buttonValue->getHtml()} {/foreach}
                                    </div>
                                {/if}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</mg-component-body-{$elementId}>
