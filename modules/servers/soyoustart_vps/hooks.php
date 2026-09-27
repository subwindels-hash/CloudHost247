<?php

require_once dirname(dirname(__DIR__)) . "/addons/soyoustart/classes/ApiCall.php";



// echo "ff";die;

use \WHMCS\Module\Addon\Soyoustart\Helper;
use \WGSModule\Soyoustart\classes\ApiCall;

use WHMCS\Database\Capsule;

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

add_hook('AdminAreaHeadOutput', 1, function ($vars) {

    if ($vars["filename"] == "clientsservices") {
        $style = '
        <link href="https://cdn.datatables.net/1.13.7/css/jquery.dataTables.min.css" rel="stylesheet">
        <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
        <script>
            $(document).ready(function(){
                $("#disk_vps").DataTable();
                $("#ipaddress_vps").DataTable();
                $(".ip-reverse i").on("click", function() {
                    var ipAddress = $(this).data("ipaddress");
                    $("#forip-reverse").find(`input[name="ipaddress"]`).val(ipAddress);
                });


                if($(document).find("#snapshot_vps").length > 0){
                    getSnapshotData();
                }
                if($(document).find("#serverInfo").length > 0){
                    jQuery.ajax({
                        type: "POST",
                        url: "",
                        data: { serverInfo: "serverInfo", serverInfoAction: "getServerInfo" },
                        beforeSend: function() {
                            $("#serverInfo").append(`<div class="text-center"><i class="fa fa-spinner fa-spin" style="/* width: 100%; */font-size: 40px;padding: 1px;"></i></div>`);
                        },
                        success: function(result) {
                            result = result.split("</style>");
                            $("#serverInfo").html(`${result[1]}`);
                        }
                    });
                }

                var waitForJQuery = setInterval(function () {
                    if($(document).find("#serverInfo #ip4").length > 0){
                        jQuery.ajax({
                                type: "POST",
                                url: "",
                                data: { serverInfo: "serverInfo", serverInfoAction: "getServerIp" },
                                beforeSend: function() {
                                    $("#serverInfo #ip4").html(`<i class="fa fa-spinner fa-spin" style="font-size: 40px;padding: 1px;"></i>`);
                                },
                                success: function(result) {
                                    result = result.split("</style>");
                                    $("#serverInfo #ip4").html(`${result[1]}`);
                                }
                            });
                            clearInterval(waitForJQuery);
                        
                        }
                }, 1000);
               


                if($(document).find("#disk_vps").length > 0){
                    jQuery.ajax({
                        type: "POST",
                        url: "",
                        data: { serviceDisk: "serviceDisk", serviceDiskAction: "getserviceDisk" },
                        beforeSend: function() {
                            $("#disk_vps tbody").html(`<tr> <td colspan="6" style="text-align: center;"><i class="fa fa-spinner fa-spin" style="/* width: 100%; */font-size: 40px;padding: 1px;"></i></td></tr>`);
                        },
                        success: function(result) {
                            $("#disk_vps").DataTable().destroy();
                            result = result.split("</style>");

                            if(result[1].includes("Error:")){
                                $(".diskCard .card-body").html(`${result[1]}`)
                            } else{

                                $("#disk_vps tbody").html(`${result[1]}`);
                                $("#disk_vps").DataTable({ });
                            }
                        }
                    });
                }
                if($(document).find("#ipaddress_vps").length > 0){
                    jQuery.ajax({
                        type: "POST",
                        url: "",
                        data: { ipAddress: "ipAddress", ipAddressAction: "getipAddress" },
                        beforeSend: function() {
                            $("#ipaddress_vps tbody").html(`<tr> <td colspan="7" style="text-align: center;"><i class="fa fa-spinner fa-spin" style="/* width: 100%; */font-size: 40px;padding: 1px;"></i></td></tr>`);
                        },
                        success: function(result) {
                            $("#ipaddress_vps").DataTable().destroy();
                            result = result.split("</style>");
                            if(result[1].includes("Error:")){
                                $(".cardIPs .card-body").html(`${result[1]}`)
                            } else{
                                $("#ipaddress_vps tbody").html(`${result[1]}`);
                                $("#ipaddress_vps").DataTable({ });
                            }
                        }
                    });
                }


                if($(document).find("#serviceMonitoring").length > 0){
                    jQuery.ajax({
                        type: "POST",
                        url: "",
                        data: { serviceMonitoring: "serviceMonitoring", serviceMonitoringAction: "getserviceMonitoring" },
                        beforeSend: function() {
                            $("#serviceMonitoring").append(`<div class="text-center"><i class="fa fa-spinner fa-spin" style="/* width: 100%; */font-size: 40px;padding: 1px;"></i></div>`);
                        },
                        success: function(result) {
                            result = result.split("</style>");
                            $("#serviceMonitoring").html(`${result[1]}`);
                        }
                    });
                }

                $(document).on("click", ".editSnapshot", function () {
                    let desc = $(this).data("desc");
                    $("#editSnapshot #snapshoteditDesc").val(desc)
                })
                $(document).on("click", ".snapshoteditDesc", function () {
                    let obj = this;
                    Swal.fire({
                        title: "Are you sure?",
                        text: "You want to edit snapshot",
                        icon: "question",
                        showCancelButton: true,
                        confirmButtonColor: "#3085d6",
                        cancelButtonColor: "#d33",
                        confirmButtonText: "Yes",
                    }).then(async (result) => {
                        if (result.isConfirmed) {
                            try {
                                let desc = $("#snapshoteditDesc").val();
                                $(obj).append(`<i class="fa fa-spinner fa-spin"></i>`);
                                $(obj).prop("disabled", true);
                                let result = await secureCall({ snapshot: "snapshot", snapshotAction: "snapshoteditDesc", desc }, "POST");
                                result = result.split("</style>");
                                var response = JSON.parse(result[1])
                                if (response.httpcode != 200) {
                                    jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                                    $(obj).prop("disabled", false);
                                    $(obj).find("i").remove();
                                } else {
                                    $("#editSnapshot").modal("hide");
                                    jQuery.growl.notice({ title: "Success", message: "Description has been updated successfully", duration: 5000 });
                                    setTimeout(() => { getSnapshotData()}, 3000)
                                }
                            } catch (error) {
                                console.error(error)
                            } finally {
                                $(obj).find("i").remove();
                                $(obj).prop("disabled", false);
                            }
                        }
                    });
                })

                $(document).on("click", "#revertSnapshot", function () {
                    let obj = this;
                    Swal.fire({
                        title: "Are you sure?",
                        text: "You want to revert snapshot",
                        icon: "question",
                        showCancelButton: true,
                        confirmButtonColor: "#3085d6",
                        cancelButtonColor: "#d33",
                        confirmButtonText: "Yes",
                    }).then(async (result) => {
                        if (result.isConfirmed) {
                            try {
                                $(obj).html(`<i class="fa fa-spinner fa-spin"></i>`);
                                $(obj).prop("disabled", true);
                                let result = await secureCall({ snapshot: "snapshot", snapshotAction: "revertSnapshot" }, "POST");
                                result = result.split("</style>");
                                var response = JSON.parse(result[1])
                                if (response.httpcode != 200) {
                                    jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                                    $(obj).prop("disabled", false);
                                    $(obj).find("i").remove();
                                } else {
                                    jQuery.growl.notice({ title: "Success", message: "Snapshot revert has been initiated", duration: 5000 });
                                    getTaskStatus({ snapshot: "snapshot", snapshotAction: "getStatus", taskID: response.result.id }, "#revertSnapshot", false);
                                }
                            } catch (error) {
                                console.error(error)
                            }
                        }
                    });
                })

                $(document).on("click", "#deleteSnapshot", function () {
                    let obj = this;
                    Swal.fire({
                        title: "Are you sure?",
                        text: "You want to delete snapshot.",
                        icon: "question",
                        showCancelButton: true,
                        confirmButtonColor: "#3085d6",
                        cancelButtonColor: "#d33",
                        confirmButtonText: "Yes",
                    }).then(async (result) => {
                        if (result.isConfirmed) {
                            try {
                                $(obj).html(`<i class="fa fa-spinner fa-spin"></i>`);
                                $(obj).prop("disabled", true);
                                let result = await secureCall({ snapshot: "snapshot", snapshotAction: "deleteSnapshot" }, "POST");
                                result = result.split("</style>");
                                var response = JSON.parse(result[1])
                                if (response.httpcode != 200) {
                                    jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                                    $(obj).prop("disabled", false);
                                    $(obj).find("i").remove();
                                } else {
                                    jQuery.growl.notice({ title: "Success", message: "Snapshot delete has been initiated", duration: 5000 });
                                    getTaskStatus({ snapshot: "snapshot", snapshotAction: "getStatus", taskID: response.result.id}, "#deleteSnapshot", false);
                                }
                            } catch (error) {
                                console.error(error)
                            }
                        }
                    });
                })

                $(document).on("click", ".snapshotCreate", async function () {
                    let obj = this;
                    Swal.fire({
                        title: "Are you sure?",
                        text: "You want to create snapshot",
                        icon: "question",
                        showCancelButton: true,
                        confirmButtonColor: "#3085d6",
                        cancelButtonColor: "#d33",
                        confirmButtonText: "Yes",
                    }).then(async (result) => {
                        if (result.isConfirmed) {
                            try {
                                let desc = $("#snapshotDesc").val();
                                $(obj).append(`<i class="fa fa-spinner fa-spin"></i>`);
                                $(obj).prop("disabled", true);
                                let result = await secureCall({ snapshot: "snapshot", snapshotAction: "createSnapshot", desc }, "POST");
                                result = result.split("</style>");
                                var response = JSON.parse(result[1])
                                if (response.httpcode != 200) {
                                    jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                                    $(obj).prop("disabled", false);
                                    $(obj).find("i").remove();
                                } else {
                                    jQuery.growl.notice({ title: "Success", message: "Snapshot create has been initiated", duration: 5000 });
                                    getTaskStatus({ snapshot: "snapshot", snapshotAction: "getStatus", taskID: response.result.id,}, ".snapshotCreate", false);
                                }
                            } catch (error) {
                                console.error(error)
                            }
                        }
                    });
                })


            });

                const secureCall = (data = {}, method = "GET") => {

                    return new Promise(function (resolve, reject) {
                        $.ajax({
                            url: "",
                            method: method,
                            data: data,
                            success: function (response) {
                                resolve(response);
                            },
                            error: function (error) {
                                reject(error);
                            }
                        });
                    });
                }
                
                const getTaskStatus = async (data = {}, selector, reload = true) => {
                    try {
                        let result = await secureCall(data, "POST");
                        result = result.split("</style>");
                        let taskStatus = JSON.parse(result[1])
                        let action="";
                        if(taskStatus.result.type =="deleteSnapshot"){
                            action="deleting"
                        }else if(taskStatus.result.type =="revertSnapshot"){
                            action="reverting"
                        }else if(taskStatus.result.type =="createSnapshot"){
                            action="creating"
                        }
                
                        if (taskStatus.httpcode != 200) {
                            jQuery.growl.error({ title: "Error", message: taskStatus.result.message, duration: 5000 });
                        }
                        else {
                            if (taskStatus.result.state != "done") {
                                jQuery.growl.notice({ title: "Success", message: `Snapshot ${action} is in progress.`, duration: 5000 });
                                window.setTimeout(async () => getTaskStatus(data, selector), 10000);
                            } else {
                                $("#snapshotCreateBtn").modal("hide");
                                jQuery.growl.notice({ title: "Success", message: `Snapshot ${action} has been completed.`, duration: 5000 });
                                if(selector =="#revertSnapshot" ||  selector =="#deleteSnapshot"){
                                    setTimeout(() => { getSnapshotData()}, 3000)
                                }else if(selector ==".snapshotCreate"){
                                    setTimeout(() => {window.location.href = window.location.href}, 3000)
                                }
                                $(selector).prop("disabled", false);
                                $(selector).html(`<i class="fal fa-redo"></i>`);
                            }
                        }
                    } catch (error) {
                        console.error(error);
                    }
                }
            

                const getSnapshotData = async() => {
                    jQuery.ajax({
                        type: "POST",
                        url: "",
                        data: { snapshot: "snapshot", snapshotAction: "getData" },
                        beforeSend: function() {
                            $("#snapshot_vps tbody").html(`<tr> <td colspan="4" style="text-align: center;"><i class="fa fa-spinner fa-spin" style="/* width: 100%; */font-size: 40px;padding: 1px;"></i></td></tr>`);
                        },
                        success: function(result) {
                            result = result.split("</style>");
                            let respose = JSON.parse(result[1])
                            if(respose.action == "create"){
                                $(".snapshotBody").html(`${respose.html}`);
                            } else{
                                $("#snapshot_vps tbody").html(`${respose.html}`);
                            }
                        }
                    });
                }
        </script>
        <style>
            .card {
                position: relative;
                display: -webkit-box;
                display: -ms-flexbox;
                display: flex;
                -webkit-box-orient: vertical;
                -webkit-box-direction: normal;
                -ms-flex-direction: column;
                flex-direction: column;
                min-width: 0;
                word-wrap: break-word;
                background-color: #fff;
                background-clip: border-box;
                border: 1px solid rgba(0,0,0,.125);
                border-radius: 0.25rem;
            }
            
            .card-header:first-child {
                border-radius: calc(0.25rem - 1px) calc(0.25rem - 1px) 0 0;
            }
            
            .card-header {
                margin: 0;
                padding: 1.25rem 1.25rem;
                margin-bottom: 0;
                background-color: rgba(0,0,0,.03);
                border-bottom: 1px solid rgba(0,0,0,.125);
            }
            .card-body {
                -webkit-box-flex: 1;
                -ms-flex: 1 1 auto;
                flex: 1 1 auto;
                padding: 1.25rem;
            }
            .card-title {
                margin-bottom: 0.75rem;
            }
            h5.card-header {
                font-weight:bolder;
                font-size:1.75rem;
            }
            .adminServerInfo {
                display: flex;
                flex-wrap: wrap;
                justify-content: space-between;
                padding: 10px;
                border-bottom: 1px solid #ececec;
            }
            .adminServerInfo div {
                width: 100%;
                max-width: 5-;
                max-width: 50%;
            }
            .adminServerInfo .badge.badge-success{
                background:#28a745
            }
            .adminServerInfo .badge.badge-danger{
                background:#dc3545
            }
            table#snapshot_vps th{
                padding: 10px;
                border-bottom: 1px solid #ececec;
                font-size: 14px;
                background:#f5f5f5;;
            }
            table#snapshot_vps td {
                padding: 10px;
            }
            table#disk_vps th ,td{
                padding: 10px;
                border-bottom: 1px solid #ececec;
                font-size: 14px;
            }
            table#ipaddress_vps th ,td{
                padding: 10px;
                border-bottom: 1px solid #ececec;
                font-size: 14px;
            }
            table#disk_vps td {
                padding: 10px;
            }
            table#disk_vps .badge.badge-success{
                background:#28a745;
                margin-top: 5px;
                padding: 5px
            }
            table#disk_vps .badge.badge-danger{
                background:#dc3545;
                margin-top: 5px;
                padding: 5px
            }
            table#disk_vps .badge.badge-warning{
                background:#ffc107;
                margin-top: 5px;
                padding: 5px
            }
            table.dataTable>thead>tr>th, table.dataTable>thead>tr>td {
                padding: 10px;
                border-bottom: 1px solid #ececec;!important
            }
            table.dataTable.no-footer {
                border-bottom: 1px solid #ececec;!important
            }
            p.snapshotCreateMsg {
                font-size: 14px;
                color: #1c1c1c;
                line-height: 30px;
                margin: 0px;
                text-align: left;
            }
            
            #ipaddress_vps .ip-reverse{
                cursor: pointer !important;
            }
            div#snapshot {
                padding: 10px 20px;
                background: #fff;
                /* text-align: unset; */
            }
            
        </style>    
        ';

        return $style;
    }
});





add_hook('InvoicePaid', 1, function ($vars) {

    try {
        if ($_GET['testettdttd'] == "soyoustart") {
            require_once ROOTDIR . '/includes/modulefunctions.php';
            $apiCall = new ApiCall();
            $helper = new Helper();
            $invoiceId = $vars['invoiceid'];
            $additionipDatas = $apiCall->get_data("mod_soyoustart_ips_orders", ["invoiceid" => $invoiceId], "first");
            if ($additionipDatas && $additionipDatas->status == 0) {
                $params = ModuleBuildParams($additionipDatas->service_id);
                $pid = $params['pid'];
                $serviceId = $params['serviceid'];
                $configoption2 = explode('@', $params['configoption2']);
                $ovhAccountData = explode('-', $params['configoption3']);
                $planCode = $configoption2["1"];
                $location = $ovhAccountData["1"];
                $ovhPaymentMethod = $helper->get_data("mod_soyoustart_pricesetting", ["server" => "OVH", "servertype" => "VPS"], "first");
                $paymentmethod = $ovhPaymentMethod->paymentmethod;
                $orderid = $additionipDatas->iporderid;
                $paymentresponse = $apiCall->getpaymentdetail($params, $orderid, $paymentmethod, $pid, $serviceId, $ovhAccountData, $location);

                // $paymentresponse = [
                //     'httpcode' => 200,
                //     'result' => (object) [
                //         'quantity'      => 1,
                //         'domain'        => '*001',
                //         'description'   => 'Additional IPv4 /32 installation fees',
                //         'cancelled'     => false,
                //         'detailType'    => 'INSTALLATION',
                //         'totalPrice'    => (object) [
                //             'text'         => '$0.00 USD',
                //             'currencyCode' => 'USD',
                //             'value'        => 0,
                //         ],
                //         'unitPrice'     => (object) [
                //             'value'        => 0,
                //             'currencyCode' => 'USD',
                //             'text'         => '$0.00 USD',
                //         ],
                //         'orderDetailId' => 784550421,
                //     ],
                // ];

                if (is_array($paymentresponse)) {
                    if ($paymentresponse["httpcode"] == 200) {
                        if (!empty($paymentresponse["result"]->domain)) {
                            Capsule::table("mod_soyoustart_ips_orders")->where("invoiceid", $invoiceId)->update([
                                "status" => 2,
                            ]);
                        }
                        logActivity("Payment response: " . json_encode($paymentresponse), "soyoustart");
                    } else {
                        logActivity("Payment response: " . json_encode($paymentresponse), "soyoustart");
                    }
                } else {
                    logActivity("Payment response: " . json_encode($paymentresponse), "soyoustart");
                }
            }
        }
    } catch (\Exception $e) {
        logModuleCall(
            "soyoustart",
            "InvoicePaid",
            $_GET,
            $e->getMessage(),
            $e->getTraceAsString()
        );
    }
});
