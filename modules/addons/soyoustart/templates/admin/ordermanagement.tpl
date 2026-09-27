{include file=$tplVar.header}
<link rel="stylesheet" type="text/css" href="https://cdn.datatables.net/1.13.6/css/jquery.dataTables.min.css">
<script src="https://cdn.datatables.net/1.13.6/js/jquery.dataTables.min.js"></script>

<style>
    table.dataTable {
        border-collapse: separate !important;
        border-spacing: 1px;
    }

    table.dataTable>thead>tr>th,
    table.dataTable>thead>tr>td {
        padding: 6px;
        border-bottom: 0px solid rgba(0, 0, 0, 0.3);
    }

    th.textdata.sorting {
        text-align: center;
    }
</style>


<div class="innerContent">
    <div class="tablebg">
        <h2>{$tplVar['_lang']['main_heading']}</h2>
        <div class="alert alert-secondary" role="alert">{$tplVar['_lang']['ordermanagement_note']}
            <span class="documentation"><a href="https://wiki.whmcsglobalservices.com/index.php?title=WHMCS_OVH_Module_Installation_Guide_%26_Documentation#Order_Tracking" target="_blank"> {$tplVar['_lang']['doc']}</a> </span>
        </div>
        <div id="logsdata">
            <table id="ordersTable" class="datatable" width="100%" border="0" cellspacing="1" cellpadding="3">
                <thead>
                    <tr>
                    <th class="textdata">{$tplVar['_lang']['order_th_serviceId']}</th>
                    <th class="textdata">{{$tplVar['_lang']['order_th_clientName']}}</th>
                    <th class="textdata">{{$tplVar['_lang']['order_th_productName']}}</th>
                    <th class="textdata">{{$tplVar['_lang']['whmcs_order_th_Status']}}</th>
                    <th class="textdata">{$tplVar['_lang']['order_th_OvhId']}</th>
                    <th class="textdata">{{$tplVar['_lang']['order_th_Order_Status']}}</th>
                    <th class="textdata">{$tplVar['_lang']['orderdate']}</th>
                    </tr>
                </thead>
                <tbody>
                    {foreach $tplVar['allOrders'] as $order}
                        <tr data-orderId="{$order->ovh_order_id}" data-serviceId="{$order->id}">
                         
                            <td class="text-center"><a href="clientsservices.php?id={$order->id}"
                            target="_blank">#{$order->id} </a></td>
                            <td class="text-center"> <a href="clientssummary.php?userid={$order->clientid}" target="_blank">{$order->firstname|capitalize} {$order->lastname|capitalize}</a> </td>
                            <td class="text-center"> <a href="configproducts.php?action=edit&id={$order->productId}" target="_blank">{$order->productName}</a> </td>
                            <td class="text-center"> <span class="badge {if $order->domainstatus eq "Active"} badge-success {else} badge-secondary {/if}">{$order->domainstatus}</span> </td>

                            <td class="text-center"><a href="orders.php?action=view&id={$order->orderid}" target="_blank">{$order->ovh_order_id}</a> </td>
                            <td class="text-center" id="orderStatus"> </td>
                            <td class="text-center"> {$order->regdate} </td>
                        </tr>
                    {/foreach}
                </tbody>
            </table>
        </div>
    </div>
</div>
{include file=$tplVar.footer}