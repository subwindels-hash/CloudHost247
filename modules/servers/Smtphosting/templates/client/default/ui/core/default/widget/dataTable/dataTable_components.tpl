{**********************************************************************
* AmazonLightsail product developed. (2017-10-10)
*
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

<script type="text/x-template" id="t-mg-datatable-{$elementId|strtolower}"
        :component_id="component_id"
        :component_namespace="component_namespace"
        :component_index="component_index"
        :autoload_data_after_created="autoload_data_after_created"
        :start_length="start_length"
>
    <div class="lu-widget widgetActionComponent vueDatatableTable" id="{$rawObject->getId()}" namespace="{$namespace}" index="{$rawObject->getIndex()}" actionid="{$rawObject->getIndex()}">
        {if ($rawObject->getRawTitle() || $rawObject->getTitle() || $rawObject->titleButtonIsExist()) && $rawObject->isViewHeader()}
            <div class="lu-widget__header">
                <div class="lu-widget__top lu-top">
                    {if $rawObject->getRawTitle() || $rawObject->getTitle()}
                        <div class="lu-top__title">
                            {if $rawObject->getIcon()}
                                <i class="{$rawObject->getIcon()}"></i>
                            {/if}
                            {if $rawObject->isRawTitle()}
                                {$rawObject->getRawTitle()}
                            {elseif $rawObject->getTitle()}
                                {$MGLANG->T($rawObject->getTitle())}
                            {/if}
                        </div>
                    {/if}
                    {if $rawObject->titleButtonIsExist()}
                        <div class="lu-top__toolbar">
                            {foreach from=$rawObject->getTitleButtons() key=buttonKey item=buttonValue}
                                {$buttonValue->getHtml()}
                            {/foreach}
                        </div>
                    {/if}
                </div>
            </div>
        {/if}
        <div class="lu-widget__body">
            <div class="lu-t-c  datatableLoader" id="{$elementId}" data-table-container data-check-container>
                {if $rawObject->isViewTopBody()}
                    <div class="lu-t-c__top lu-top mob-top-search">
                        <div class="lu-top__toolbar"> {$rawObject->insertSearchForm()} </div>
                        <div class="lu-top__toolbar">
                            {foreach from=$rawObject->getButtons() key=buttonKey item=buttonValue}
                                {$buttonValue->getHtml()}
                            {/foreach}
                            {if $rawObject->hasDropdawnButton()}
                                {$rawObject->getDropdawnButtonHtml()}
                            {/if}
                        </div>
                    </div>
                {/if}
                <div class="lu-t-c__mass-actions lu-top">
                    <div class="lu-top__title"><span class="lu-badge lu-badge--primary lu-value">0</span> {$MGLANG->absoluteT('datatableItemsSelected')}</div>
                    <div class="lu-top__toolbar">
                        {if $rawObject->hasMassActionButtons()}
                            {foreach $rawObject->getMassActionButtons() as $maButton}
                                {$maButton->getHtml()}
                            {/foreach}
                        {/if}
                    </div>
                    <div class="drop-arrow{if $rawObject->isvSortable()} drop-arrow-sorting{/if}"></div>
                </div>

                {***DATATABLE*BODY******************************************************************}

                <div class="dataTables_wrapper no-footer">
                    <div>
                        <table class="lu-table lu-table--mob-collapsible dataTable no-footer dtr-column" width="100%" role="grid">
                            <thead>
                            <tr role='row'>
                                {assign var="collArrKeys" value=$customTplVars.columns|array_keys}
                                {foreach from=$customTplVars.columns key=tplKey item=tplValue}
                                    {if $rawObject->hasMassActionButtons() && $collArrKeys[0] === $tplKey}
                                        <th class="{if $tplValue->orderable}{$tplValue->orderableClass}{/if} {if $tplValue->class !== ''}{$tplValue->class}{/if}"
                                            name="{$tplValue->name}">
                                            {if $rawObject->isvSortable()}
                                                <span class="drag-and-drop-icon" style="visibility: hidden;"><i class="zmdi zmdi-unfold-more"></i></span>
                                            {/if}
                                            <div class="lu-rail">
                                                <div class="lu-form-check">
                                                    <label>
                                                        <input type="checkbox" data-check-all="" class="lu-form-checkbox">
                                                        <span class="lu-form-indicator"></span>
                                                    </label>
                                                </div>
                                                <span class="lu-table__text" {if $tplValue->orderable}v-on:click="updateSorting"{/if}>{if $tplValue->rawTitle}{$tplValue->rawTitle}{else}{$MGLANG->T('table', $tplValue->title)}{/if}</span>
                                            </div>
                                        </th>
                                    {else}
                                        <th class="{if $tplValue->orderable}{$tplValue->orderableClass}{/if} {if $tplValue->class !== ''}{$tplValue->class}{/if}" {if $tplValue->orderable} aria-sort="descending" {/if}
                                                {if $tplValue->orderable}v-on:click="updateSorting"{/if} name="{$tplValue->name}">
                                            <span class="lu-table__text">{if $tplValue->rawTitle}{$tplValue->rawTitle}{else}{$MGLANG->T('table', $tplValue->title)}{/if}&nbsp;&nbsp;</span>
                                        </th>
                                    {/if}
                                {/foreach}
                                {if $rawObject->hasActionButtons()}
                                    <th class="mgTableActionsHeader" name="actionsCol"></th>
                                {/if}
                            </tr>
                            </thead>
                            <tbody>
                            <tr v-for="dataRow in dataRows" {literal}:actionid{/literal}="dataRow.{$rawObject->getActionIdColumnName()}" role="row">
                                {foreach from=$customTplVars.columns key=tplKey item=tplValue}
                                    {if $rawObject->hasMassActionButtons() && $collArrKeys[0] === $tplKey}
                                        <td>
                                            {if $rawObject->isvSortable()}
                                                <span class="drag-and-drop-icon"><i class="lu-zmdi lu-zmdi-unfold-more"></i></span>
                                            {/if}
                                            <div class="lu-rail">
                                                <div class="lu-form-check">
                                                    <label>
                                                        <input type="checkbox" class="lu-form-checkbox table-mass-action-check" {literal}:value="dataRow.id"{/literal}>
                                                        <span class="lu-form-indicator">
                                                            </span>
                                                    </label>
                                                </div>
                                                <span v-html="dataRow.{$tplKey}"></span>
                                            </div>
                                        </td>
                                    {elseif $customTplVars.jsDrawFunctions[$tplKey]}
                                        <td v-html="rowDrow('{$tplKey}', dataRow, '{$customTplVars.jsDrawFunctions[$tplKey]}')"></td>
                                    {elseif $rawObject->hasCustomColumnHtml($tplKey)}
                                        <td class="mgTableActions">
                                            {$rawObject->getCustomColumnHtml($tplKey)}
                                        </td>
                                    {else}
                                        <td v-html="dataRow.{$tplKey}"></td>
                                    {/if}
                                {/foreach}
                                {if $rawObject->hasActionButtons()}
                                    <td class="lu-cell-actions mgTableActions">
                                        {foreach $rawObject->getActionButtons() as $aButton}
                                            {$aButton->getHtml()}
                                        {/foreach}
                                    </td>
                                {/if}
                            </tr>
                            </tbody>
                        </table>
                        <div v-show="noData" style="padding: 15px; text-align: center; border-top: 1px solid #e9ebf0;">
                            {$MGLANG->absoluteT('noDataAvalible')}
                        </div>
                        <div class="lu-preloader-container lu-preloader-container--full-screen lu-preloader-container--overlay" v-show="loading">
                            <div class="lu-preloader lu-preloader--sm"></div>
                        </div>
                    </div>
                    {if $rawObject->isViewFooter()}{literal}
                        <div class="lu-t-c__footer table-footer">
                        <div class="dataTables_paginate paging_simple_numbers" id="DataTables_Table_0_paginate">
                        <a :class='"paginate_button previous" + ((curPage < 2) ? " disabled" : "")' aria-controls="DataTables_Table_0" :data-dt-idx='curPage -1' tabindex="0" href="javascript:;" page="prev" v-on:click="changePage" id="{/literal}{$elementId}{literal}_previous"></a>
                        <span v-for="pageNumber in pagesMap">
                                    <a v-if='pageNumber && pageNumber !== "..."' :class='"paginate_button" + (curPage === pageNumber ? " current" : "")' aria-controls="DataTables_Table_0" v-on:click="changePage" :data-dt-idx="pageNumber" tabindex="0"> {{ pageNumber}} </a>
                                    <a v-if='pageNumber && pageNumber === "..."' class="paginate_button disabled"> {{ pageNumber}} </a>
                                </span>
                        <a :class='"paginate_button next" + ((curPage === allPages || allPages === 0) ? " disabled" : "")' aria-controls="DataTables_Table_0" :data-dt-idx='curPage +1' tabindex="0" href="javascript:;" page="next" v-on:click="changePage" id="{/literal}{$elementId}{literal}_next"></a>
                        </div>
                        <div class="lu-dt-buttons">
                    {/literal}
                        {foreach from=$rawObject->getTableLengthList() key=tplKey item=lengthList}
                            {if $lengthList == "inf"}
                                <a class="dt-button {if $rawObject->getTableLength() == $lengthList}active{/if}" tabindex="0" data-length="999999" v-on:click="updateLength" aria-controls="DataTables_Table_0" href="#{$elementId}">
                                    <span>∞</span>
                                </a>
                            {else}
                                <a class="dt-button {if $rawObject->getTableLength() == $lengthList}active{/if}" tabindex="0" data-length="{$lengthList}" v-on:click="updateLength" aria-controls="DataTables_Table_0" href="#{$elementId}">
                                    <span>{$lengthList}</span>
                                </a>
                            {/if}
                        {/foreach}
                        </div>
                        </div>
                    {/if}
                </div>
            </div>
            {if ($isDebug eq true AND (count($MGLANG->getMissingLangs()) != 0))}
                <div class="lu-row" style="max-width: 95%;">
                    {foreach from=$MGLANG->getMissingLangs() key=varible item=value}
                        <div class="lu-col-md-12"><b>{$varible}</b> = '{$value}';</div>
                    {/foreach}
                </div>
            {/if}
        </div>
    </div>
</script>
