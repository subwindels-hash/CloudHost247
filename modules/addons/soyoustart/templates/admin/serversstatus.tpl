{include file=$tplVar.header}

<link href="https://cdn.datatables.net/1.11.5/css/jquery.dataTables.min.css" rel="stylesheet" />
<script src="https://cdn.datatables.net/1.11.5/js/jquery.dataTables.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
<style>
    table.dataTable {
        border-collapse: separate !important;
        border-spacing: 1px;
    }

    table.dataTable>thead>tr>th,
    table.dataTable>thead>tr>td {
        padding: 9px;
        border-bottom: 0px solid rgba(0, 0, 0, 0.3);
    }

    th.textdata.sorting {
        text-align: center;
    }

    th {
        font-size: 12px !important;
    }
</style>

<div class="tab0box" id="tab0box">
    <div id="tab_content">
        <div class="table-responsive">
        <div class="alert alert-secondary existingserver_existing_note" role="alert">{$tplVar['_lang']['serversstatus_note']}
            <span class="documentation"><a href="https://wiki.whmcsglobalservices.com/index.php?title=WHMCS_OVH_Module_Installation_Guide_%26_Documentation#Server_Status" target="_blank"> {$tplVar['_lang']['doc']}</a> </span>
        </div>
            <table id="serverStaus" class="datatable display" width="100%" border="0" cellspacing="1" cellpadding="3">
                <thead>
                    <tr>
                        <th class="h5">{$tplVar['_lang']['clientName']}</th>
                        <th class="h5">{$tplVar['_lang']['server']}</th>
                        <th class="h5">{$tplVar['_lang']['hostname']}</th>
                        <th class="h5" style="width: 90px;">{$tplVar['_lang']['serviceRenewDate']}</th>
                        <th class="h5">{$tplVar['_lang']['serviceStatus']}</th>
                        <th class="h5" style="width: 90px;">{$tplVar['_lang']['serverRenewDate']}</th>
                        <th class="h5">{$tplVar['_lang']['serverStatus']}</th>
                        <th style="width:85px;" class="h5"><b>{$tplVar['_lang']['serverType']}</b></th>
                        <th style="width:240px;" class="h5">{$tplVar['_lang']['OVHAccount']}</th>
                        <th class="h5">{$tplVar['_lang']['action']}</th>
                    </tr>
                </thead>
                <tbody>

                    {foreach from=$tplVar["allPackages"] item=package key=key }

                        <tr  data-serviceId="{$package->id}"  data-serverName="{$package->ovh_server_name}" data-servertype="{$package->servertype}">
                            <td class="text-center"><a href="clientssummary.php?userid={$package->clientid}" target="_blank">{$package->firstname|capitalize} {$package->firstname|capitalize}</a></td>
                    <td class="text-center"><a href="clientsservices.php?id={$package->id}" target="_blank">{if $package->ovh_server_name neq '' }   {$package->ovh_server_name}{else} -- {/if}</a></td>
                            <td class="text-center">{if $package->ovh_custom_hostname}{$package->ovh_custom_hostname}{else}--{/if}</td>
                            <td class="text-center">{$package->nextinvoicedate}</td>
                            <td class="text-center">
                                {if $package->domainstatus eq "Active" }
                                    <span class="label label-success">{$package->domainstatus}</span>
                                {else}
                                    <span class="label label-warning">{$package->domainstatus}</span>
                                {/if}
                            </td>
                            <td class="text-center">{if $package->serverInfo->expiration neq ''} {$package->serverInfo->expiration}{else} -- {/if}</td>
                            <td class="text-center" id="orderStatus">
                                {if $package->serverInfo->state eq "ok" || $package->serverInfo->state eq "running" }
                                    <span class="label label-success">Active</span>
                                {else}
                                    <span class="label label-warning">{$package->error}</span>
                                {/if}

                            </td>
                            <td class="text-center">{if $package->servertype eq "soyoustart"} DEDICATED {else} VPS{/if}</td>
                            <td class="text-center">{$package->ovh_server_location}-{$package->ovh_account}</td>
                            <td class="text-center">
                                {if $package->serverInfo->state eq "ok" || $package->serverInfo->state eq "running" && $package->servertype eq "soyoustart_vps" }
                                    <button class="btn btn-danger" type="button" id="terminateServer" data-id="{$package->accountInfo->id}"> Terminate Server </button>
                                {/if}
                            </td>
                        </tr>
                    {/foreach}
                </tbody>
            </table>
        </div>
    </div>
</div>



{include file=$tplVar.footer}