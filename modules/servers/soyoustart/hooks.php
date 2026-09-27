<?php

use WHMCS\Database\Capsule;


if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

add_hook('AdminAreaHeadOutput', 1, function ($vars) {

    if ($vars["filename"] == "clientsservices") {
        global $CONFIG;
        global $whmcs;
    
        $serviceId =$whmcs->get_req_var("id");

        $serviceData = Capsule::table("tblhosting")
            ->join("tblproducts", "tblhosting.packageid", "=", "tblproducts.id")
            ->select("tblproducts.servertype as servertype", "tblproducts.configoption1", "tblproducts.configoption2", "tblproducts.configoption3", "tblproducts.configoption4") 
            ->where("tblhosting.id", $serviceId)->first();
    
        if(isset($serviceData->servertype) && in_array($serviceData->servertype, ["soyoustart", "soyoustart_vps"])){

            $accountId = explode("-", $serviceData->configoption3)[0];
            $location = strtolower(explode("-", $serviceData->configoption3)[1]);



            /* adding lang file according to whmcs default language */
            $language = $CONFIG['Language'];
            $langfilename = __DIR__ . '/lang/' . $language . '.php';
            if (file_exists($langfilename)) {
                require($langfilename);
            } else {
                require(__DIR__ . '/lang/english.php');
            }
            $LANG = $_ADDONLANG;

        $style = '
            <div class="modal fade" id="viewIpDetails" tabindex="-1" role="dialog" aria-labelledby="viewIpDetailsTitle"
                aria-hidden="true">
                <div class="modal-dialog" role="document">
                    <div class="modal-content">
                        <form id="viewIpDetailsForm">
                            <div class="modal-header">
                                <h2 class="modal-title" id="viewIpDetailsTitle">IP Details <span id="viewIpDetailsIpBlock"></span> </h2>
                                <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                                    <span aria-hidden="true">&times;</span>
                                </button>
                            </div>
        
                            <div class="modal-body">
                                <div class="mainSec">
                                </div>
                                <div class="modal-footer">
                                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
            <div class="modal fade" id="addIpDescriptions" tabindex="-1" role="dialog" aria-labelledby="addIpDescriptionsTitle">
                <div class="modal-dialog modal-dialog-centered" role="document">
                    <div class="modal-content">
                        <form id="addIpDescriptionsForm">
                            <div class="modal-header">
                                <h2 class="modal-title" id="addIpDescriptionsTitle">Add IP Description</h2>
                                <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                                    <span aria-hidden="true">&times;</span>
                                </button>
                            </div>
                            <div class="modal-body">
                                <div class="form-group">
                                    <label for="addIpDesc" class="col-form-label">Enter a IP description</label>
                                    <div class="modal-input">
                                        <textarea class="form-control" id="addIpDesc" rows="3"></textarea>
                                    </div>
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
                                <button type="button" class="btn btn-primary updateIPDesc">Confirm</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
            <div class="modal fade" id="addReverseIp" tabindex="-1" role="dialog" aria-labelledby="addReverseIpTitle">
                <div class="modal-dialog modal-dialog-centered" role="document">
                    <div class="modal-content">
                        <form id="addReverseIpForm">
                            <div class="modal-header">
                                <h2 class="modal-title" id="addReverseIpTitle">'.$LANG["addReverseIPModalHeading"].'</h2>
                                <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                                    <span aria-hidden="true">&times;</span>
                                </button>
                            </div>
                            <div class="modal-body">
                                <div class="alert alert-info" role="alert" style="text-align: left;font-size: 14px;">
                                    '.$LANG["addReverseMessage"].'</div>
        
                                <div class="form-group">
                                    <label for="addIpReverseIPAddress"
                                        class="col-form-label">'.$LANG["addReverseIPAddlabel"].'</label>
                                    <div class="modal-input">
                                        <input type="text" class="form-check form-control" id="addIpReverseIPAddress"
                                            style="width: 100%;" readonly>
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label for="addIpReverse" class="col-form-label">'.$LANG["addReverseIPModallabel"].'</label>
                                    <div class="modal-input">
                                        <input type="text" class="form-check form-control" id="addIpReverse" style="width: 100%;"
                                            placeholder="yourdomainname">
                                    </div>
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
                                <button type="button" class="btn btn-primary updateIPReverse">Confirm</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <div class="modal fade" id="getFirewallRules" tabindex="-1" role="dialog" aria-labelledby="getFirewallRulesTitle">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <form id="getFirewallRulesForm">
                            <div class="modal-header">
                                <h2 class="modal-title" id="getFirewallRulesTitle">'.$LANG["getRuleModalHeading"].'<span
                                        class="firewallName"> </span></h2>
                                <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                                    <span aria-hidden="true">&times;</span>
                                </button>
                            </div>
                            <button type="button" class="btn btn-primary showModal">Add Rules </button>

                            <div id="firewaAddllRules" style="display: none;">
                                <div class="form-row">
                                    <div class="form-group col-md-6">
                                        <label for="firewallSequence">'.$LANG["addRuleSequence"].'</label>
                                        <select class="form-control" id="firewallSequence" name="firewallSequence">
                                            <option value="0">0</option>
                                            <option value="1">1</option>
                                            <option value="2">2</option>
                                            <option value="3">3</option>
                                            <option value="4">4</option>
                                            <option value="5">5</option>
                                            <option value="6">6</option>
                                            <option value="7">7</option>
                                            <option value="8">8</option>
                                            <option value="9">9</option>
                                            <option value="10">10</option>
                                            <option value="11">11</option>
                                            <option value="12">12</option>
                                            <option value="13">13</option>
                                            <option value="14">14</option>
                                            <option value="15">15</option>
                                            <option value="16">16</option>
                                            <option value="17">17</option>
                                            <option value="18">18</option>
                                            <option value="19">19</option>
                                        </select>
                                    </div>

                                    <div class="form-group col-md-6">
                                        <label for="firewallAction">'.$LANG["addRuleAction"].'</label>
                                        <select class="form-control" id="firewallAction" name="firewallAction">
                                            <option value="permit">PERMIT</option>
                                            <option value="deny">DENY</option>
                                        </select>
                                    </div>

                                </div>
                                <div class="form-row">
                                    <div class="form-group col-md-6">
                                        <label for="firewallProtocol">'.$LANG["addRuleProtocol"].'</label>
                                        <select class="form-control" id="firewallProtocol" name="firewallProtocol">
                                            <option value="ah">AH</option>
                                            <option value="esp">ESP</option>
                                            <option value="gre">GRE</option>
                                            <option value="icmp">ICMP</option>
                                            <option value="ipv4">IPv4</option>
                                            <option value="tcp">TCP</option>
                                            <option value="udp">UDP</option>
                                        </select>
                                    </div>
                                    <div class="form-group col-md-6">
                                        <label for="firewallSourse">'.$LANG["addRuleSource"].'</label>

                                        <input type="text" class="form-control" id="firewallSourse" name="firewallSourse" value="all">

                                    </div>
                                </div>

                                <div class="form-row">
                                    <div class="form-group col-md-6">
                                        <label for="firewallDestinationPort">'.$LANG["addRuleDestinationPort"].'</label>
                                        <input type="number" class="form-control" name="firewallDestinationPort"
                                            id="firewallDestinationPort">
                                    </div>
                                    <div class="form-group col-md-6">
                                        <label for="firewallSourcePort">'.$LANG["addRuleSourcePort"].'</label>
                                        <input type="number" class="form-control" name="firewallSourcePort" id="firewallSourcePort">
                                    </div>

                                </div>

                                <div class="form-row onlyWithTCP" style="display: none;">

                                    <div class="form-group col-md-6">
                                        <label for="firewallOption">'.$LANG["addRuleOption"].'</label>
                                        <select class="form-control" name="firewallOption" id="firewallOption">
                                            <option value="">None</option>
                                            <option value="established">Established</option>
                                            <option value="syn">SYN</option>
                                        </select>
                                    </div>
                                    <div class="form-group col-md-6">
                                        <input type="checkbox" class="" name="firewallFragements" id="firewallFragements">
                                        <label for="firewallFragements">'.$LANG["addRuleFragements"].'</label>
                                    </div>

                                </div>

                                <div class="form-row">

                                    <div class="form-group col-md-12">
                                        <button type="button" class="btn btn-primary addDirewallRule float-right">Confirm</button>
                                    </div>
                                </div>

                            </div>

                            <div class="modal-body">

                                <table class="table table-hover" id="getFirewallRulesTable">
                                    <thead>
                                        <tr>
                                            <th>'.$LANG["getRuleTblHeadingPriotrity"].'</th>
                                            <th>'.$LANG["getRuleTblHeadingAction"].'</th>
                                            <th>'.$LANG["getRuleTblHeadingProtocol"].'</th>
                                            <th>'.$LANG["getRuleTblHeadingSourceIp"].'</th>
                                            <th>'.$LANG["getRuleTblHeadingSourcePort"].'</th>
                                            <th>'.$LANG["getRuleTblHeadingDestPort"].'</th>
                                            <th>'.$LANG["getRuleTblHeadingOptions"].'</th>
                                            <th>'.$LANG["getRuleTblHeadingStatus"].'</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                    </tbody>
                                </table>

                            </div>
                        </form>
                    </div>
                </div>
            </div>


            

        <link href="https://cdn.datatables.net/1.13.7/css/jquery.dataTables.min.css" rel="stylesheet">
        <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
        <script>
            $(document).ready(function(){
                $("#ipsDetails").DataTable();
                var dataTableObj = null;
                if($(document).find(".serviceinfo").length > 0){
                    jQuery.ajax({
                        type: "POST",
                        url: "",
                        data: { ajaxAction: true, serviceinfoAction: "getServiceInfo" },
                        beforeSend: function() {
                            $(".serviceinfo .card-body").html(`<div class="text-center"><i class="fa fa-spinner fa-spin" style="/* width: 100%; */font-size: 40px;padding: 1px;"></i></div>`);
                        },
                        success: function(result) {
                            result = result.split("</style>");
                            $(".serviceinfo .card-body").html(`${result[1]}`);
                        }
                    });
                }

                if($(document).find(".ipsInfo").length > 0){
                    jQuery.ajax({
                        type: "POST",
                        url: "",
                        data: { ajaxAction: true, serviceAction: "getIpsInfo" },
                        beforeSend: function() {
                            $(".ipsInfo tbody").html(`<tr> <td colspan="6" style="text-align: center;"><i class="fa fa-spinner fa-spin" style="/* width: 100%; */font-size: 40px;padding: 1px;"></i></td></tr>`);
                        },
                        success: function(result) {
                            $("#ipsDetails").DataTable().destroy();
                            result = result.split("</style>");
                            $(".ipsInfo tbody").html(`${result[1]}`);
                            $("#ipsDetails").DataTable({ });
                        }
                    });
                } 

                $(document).on("click", ".ipAction", function (e) {
                    e.stopPropagation();
                    if ($("#ipsDetails").hasClass(".ipActionLists.activeList")) {
                        $("#ipsDetails").find(".ipActionLists").css("display", "none");
                        $("#ipsDetails").find(".ipActionLists").removeClass("activeList");
                        $(this).parent().parent().find(".ipActionLists").addClass("activeList");
                        $(this).parent().parent().find(".ipActionLists.activeList").toggle(1000);
                    } else {
                        $("#ipsDetails").find(".ipActionLists").removeClass("activeList");
                        $(this).parent().parent().find(".ipActionLists").addClass("activeList");
                        $(this).parent().parent().find(".ipActionLists.activeList").toggle(1000);
                    }
            
                });

                $(document).on("click", "#ipsDetails", function () {
                    $(".ipActionLists").hide(500)
               });
            

                /* view ip details */

                $(document).on("click", "#ipsDetails .viewIpDetails", async function () {
                    let ipblock = $(this).closest("tr").data("ip");
                    $("#viewIpDetailsIpBlock").html(ipblock);
                    $("#viewIpDetailsForm .modal-body .mainSec").find("i").remove();
                    $("#viewIpDetailsForm .modal-body .mainSec").html(`<i class="fa fa-spinner fa-spin"></i>`);
                    let result = await secureCall({ ajaxAction: true, iPaction: "viewIpDetails", ipblock }, "POST");
                    result = result.split("</style>");
                    $("#viewIpDetailsForm .modal-body .mainSec").html(`${result[1]}`)
            
                })

                $(document).on("click", ".createFirewall", function () {
                    Swal.fire({
                        title: "Are you sure?",
                        text: "You want to create firewall!",
                        icon: "question",
                        showCancelButton: true,
                        confirmButtonColor: "#3085d6",
                        cancelButtonColor: "#d33",
                        confirmButtonText: "Yes",
                    }).then(async (result) => {
                        if (result.isConfirmed) {
                            try {
                                let ip = $(this).closest("tr").data("ip");
                                $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
                                $(this).prop("disabled", true);
                                let result = await secureCall({ ajaxAction: true, iPaction: "cretaeFirewall", ip }, "POST");
                                result = result.split("</style>");
                                let response = JSON.parse(`${result[1]}`);
                                if (response.httpcode != 200) {
                                    jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                                } else {
                                    jQuery.growl.notice({ title: "Success", message: "Firewall created successfully Status (" + response.result.state + ")", duration: 5000 });
                                    setTimeout(() => location.reload(), 3000)
                                }
                            } catch (error) {
                                console.error(error);
                                jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                            } finally {
                                $(this).find("i").remove();
                                $(this).prop("disabled", false);
                            }
                        }
                    });
                });


                $(document).on("change", ".firewallEnableDisable", function (e) {
                    e.stopPropagation();
                    if ($(this).is(":checked")) {
                        var checked = true;
                        var actionType = "enable";
                        var action = "Are you sure you want to enable firewall ?";
                    } else {
                        var checked = false;
                        var actionType = "disable";
                        var action = "Are you sure you want to disable firewall ?";
                    }
                    let obj = this;
            
                    Swal.fire({
                        title: "Are you sure?",
                        text: action,
                        icon: "question",
                        showCancelButton: true,
                        confirmButtonColor: "#3085d6",
                        cancelButtonColor: "#d33",
                        confirmButtonText: "Yes",
                        allowOutsideClick: function (element, allowed) {
                            (checked ? $(this).prop("checked", false) : $(this).prop("checked", true));
                            return true;
                        }
                    }).then(async (result) => {
                        if (result.isConfirmed) {
                            try {
                                let ip = $(this).closest("tr").data("ip");
                                $(this).closest("td").find(".switch").css("display", "none").after(`<i class="fa fa-spinner fa-spin"></i>`);
                                let result = await secureCall({ ajaxAction: true, iPaction: "enableDisableFirewall", ip, actionType }, "POST");
                                result = result.split("</style>");
                                let response = JSON.parse(`${result[1]}`);
                                if (response.httpcode != 200) {
                                    jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                                    (checked ? $(this).prop("checked", false) : $(this).prop("checked", true));
                                } else {
                                    jQuery.growl.notice({ title: "Success", message: `Firewall ${actionType} successfully!`, duration: 5000 });
                                }
                            } catch (error) {
                                console.log(error)
                                jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                               
                            }
                            finally{
                                $(this).closest("td").find(".switch").css("display", "block");
                                $(this).closest("td").find("i").remove();
                            }
                        } else {
                            (checked ? $(this).prop("checked", false) : $(this).prop("checked", true));
                        }
                    });
                });
                $(document).on("change", "#getFirewallRules #firewallProtocol", function () {
                    let protocol = $(this).val();
                    if (protocol == "tcp") {
                        $("#getFirewallRules").find(".onlyWithTCP").css("display", "flex");
                    } else {
                        $("#getFirewallRules").find(".onlyWithTCP").css("display", "none");
                    }
                })
            
            
                
                $(document).on("click", "#firewaAddllRules .addDirewallRule", async function () {
                    let obj = this;
                    Swal.fire({
                        title: "Are you sure?",
                        text: "You want to add rule",
                        icon: "question",
                        showCancelButton: true,
                        confirmButtonColor: "#3085d6",
                        cancelButtonColor: "#d33",
                        confirmButtonText: "Yes",

                    }).then(async (result) => {
                        if (result.isConfirmed) {
                            try {
                                $(obj).append(`<i class="fa fa-spinner fa-spin"></i>`);
                                $(obj).prop("disabled", true);
                                let ipblock = $("#ipsDetails .ipActionLists.activeList").data("ipblock");
                                let data = $("#getFirewallRulesForm").serialize();
                                let result = await secureCall({ ajaxAction: true, iPaction: "addFirewallRule", data, ipblock }, "POST");
                                result = result.split("</style>");
                                let response = JSON.parse(`${result[1]}`);
                                if (response.httpcode != 200) {
                                    jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                                } else {
                                    jQuery.growl.notice({ title: "Success", message: "Firewall rules has been added successfully!", duration: 5000 });
                                    dataTableObj.ajax.reload(null, true);
                                    setTimeout(() =>  dataTableObj.ajax.reload(null, true), 15000)
                                }

                            } catch (error) {
                                console.error(error)
                            }
                            finally{
                                $(obj).find("i").remove();
                                $(obj).prop("disabled", false);
                            }
                        }
                    })
                })

                /* deleting firewall rule */

                $(document).on("click", "#getFirewallRulesForm #getFirewallRulesTable .deleteFirewallRule", async function () {
                    let obj = this;
                    Swal.fire({
                        title: "Are you sure?",
                        text: "You want to delete rule",
                        icon: "question",
                        showCancelButton: true,
                        confirmButtonColor: "#3085d6",
                        cancelButtonColor: "#d33",
                        confirmButtonText: "Yes",
            
                    }).then(async (result) => {
                        if (result.isConfirmed) {
                            try {
                                $(obj).removeClass(`fas fa-trash-alt deleteFirewallRule`);
                                $(obj).addClass(`fa fa-spinner fa-spin`);
                                $(obj).prop("disabled", true);
                                let sequese = $(obj).parent().parent().find(".sorting_1").text();
                                let ipblock = $("#ipsDetails .ipActionLists.activeList").data("ipblock");
                                let result = await secureCall({ ajaxAction: true, iPaction: "deleteFirewallRule", sequese, ipblock }, "POST");
                                result = result.split("</style>");
                                let response = JSON.parse(`${result[1]}`);
                                if (response.httpcode != 200) {
                                    jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                                    $(obj).addClass(`fas fa-trash-alt deleteFirewallRule`);
                                    $(obj).removeClass(`fa fa-spinner fa-spin`);
                                    $(obj).prop("disabled", false);
                                } else {
                                    jQuery.growl.notice({ title: "Success", message: "Firewall rules has been deleted successfully!", duration: 5000 });
                                    $(obj).find("i").remove();
                                    $(obj).prop("disabled", false);
                                    dataTableObj.ajax.reload(null, true);
                                    setTimeout(() =>  dataTableObj.ajax.reload(null, true), 15000)
                                }
                            } catch (error) {
                                console.error(error);
                                jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                            }
                        }
                    })
                })
            

                $(document).on("click", "#ipsDetails .ipActionLists.activeList li", async function (e) {
                    e.stopPropagation();
                    $("#ipsDetails .ipActionLists").find(".active").removeClass("active");
                    $(this).addClass("active");
                    let obj = this;
                    let ipblock = $("#ipsDetails .ipActionLists.activeList").data("ipblock");
                    var ipblockarr = ipblock.split("/");
                    if ($(this).data("target") == "#addReverseIp") {
                        $("#addReverseIp #addIpReverseIPAddress").val(ipblockarr["0"]);
                        let reverseDns = $(this).closest("tr").find(".reverseDns").html();
                        if(reverseDns !="Not Configured"){
                            $("#addReverseIp #addIpReverse").val(reverseDns);
                        }
                    }
                    else if ($(this).data("target") == "#getFirewallRules") {

                        $("#getFirewallRules .firewallName").text(ipblockarr["0"])
                        $("#getFirewallRulesTable").dataTable().fnDestroy();
            
                        dataTableObj = $("#getFirewallRulesTable").DataTable({
                            "ajax": {
                                "url": "/modules/servers/soyoustart/ajax/ajax.php",
                                "data": { ajaxAction: true, iPaction: "getFirewallRules", ipblock, location:"' . $location . '", accountId:"' . $accountId . '" },
                                "dataSrc": "data"
                            },
                            columns: [
                                { "data": "sequence" },
                                { "data": "action" },
                                { "data": "protocol" },
                                { "data": "destination" },
                                { "data": "sourcePort" },
                                { "data": "destinationPort" },
                                { "data": "tcpOption" },
                                { "data": "state" },
                                { "data": "delete" }
                            ]
                        });
                    }
                    else if ($(this).data("mitigration")) {
                        let mitigrationIp = $("#ipsDetails .ipActionLists.activeList .active").attr("data-mitigrationip");
                        let message = "";
                        let title = "";
                        if (mitigrationIp != "") {
                            title = `Switch Network Scrubbing Centre to permanent mitigation`
                            message = `Are you sure you want to enable permanent Scrubbing Centre mitigation on the ${mitigrationIp} IP? Please use this option with caution (in most cases, using automatic mitigation is recommended)`;
                        } else {
                            title = `Switch Network Scrubbing Centre to automatic mode`
                            message = `This way, you can enable the default protection settings on the ${mitigrationIp} IP.`;
                        }
            
                        Swal.fire({
                            title: title,
                            text: message,
                            icon: "info",
                            showCancelButton: true,
                            confirmButtonColor: "#3085d6",
                            cancelButtonColor: "#d33",
                            confirmButtonText: "Yes",
            
                        }).then(async (result) => {
                            if (result.isConfirmed) {
                                try {
                                    $(obj).append(`<i class="fa fa-spinner fa-spin"></i>`);
                                    $(obj).prop("disabled", true);
                                    $(obj).css({ "cursor": "no-drop", "color": "#808080" });
                                    let result = await secureCall({ajaxAction: true, iPaction: "mitigration", ipblock, mitigrationIp }, "POST");
                                    result = result.split("</style>");
                                    let response = JSON.parse(`${result[1]}`);
                                    if (response.httpcode != 200) {
                                        jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                                        
                                    } else {
                                        jQuery.growl.notice({ title: "Success", message: "Updated successfully!", duration: 5000 });
                                        setTimeout(() => {location.reload(); }, 3000)

                                    }
                                } catch (error) {
                                    console.error(error);
                                    jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                                }
                                finally{
                                    $(obj).prop("disabled", false);
                                    $(obj).find("i").remove();
                                    $(obj).css({ "cursor": "pointer", "color": "#212529" });
                                }
                            }
                        })
                    }
                    else {
                        $("#addIpDescriptionsForm #addIpDesc").val("")
                        let desc = $(this).attr("data-desc");
                        $("#addIpDescriptionsForm #addIpDesc").val(desc)
                        if (desc != "") {
                            $("#addIpDescriptionsTitle").text("Edit IP Description")
                        } else {
                            $("#addIpDescriptionsTitle").text("Add IP Description")
                        }
                    }
                });

                $(document).on("click", "#getFirewallRules button.showModal", function () {
                    $("#firewaAddllRules").toggle(1000)
                })
                /* updating/adding IP desc */
                $(document).on("click", "#addIpDescriptionsForm .updateIPDesc", async function (e) {
                    try {
                        $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
                        $(this).prop("disabled", true);
                        let desc = $("#addIpDescriptionsForm #addIpDesc").val();
                        let ipblock = $("#ipsDetails .ipActionLists.activeList").data("ipblock");
                        let result = await secureCall({ ajaxAction: true, iPaction: "addDesc", desc, ipblock }, "POST");
                        result = result.split("</style>");
                        let response = JSON.parse(`${result[1]}`);
                        if (response.httpcode != 200) {
                            jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                           
                        } else {
                            jQuery.growl.notice({ title: "Success", message: "IP description has been updated successfully!", duration: 5000 });
                            $("#addIpDescriptions").modal("hide");
                            $("#ipsDetails .ipActionLists.activeList .active").attr("data-desc", desc);
                        }
                    } catch (error) {
                        console.error(error)
                        jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                    }
                    finally{
                        $(this).find("i").remove();
                        $(this).prop("disabled", false);
                    }
                });

                $(document).on("click", "#addReverseIp .updateIPReverse", async function () {
                    try {
                        let ipblock = $("#ipsDetails .ipActionLists.activeList").data("ipblock");
                        let reverseIp = $("#addReverseIp #addIpReverse").val();
                        if (reverseIp == "") {
                            $("#addReverseIp #addIpReverse").css("border", "1px solid red");;
                            $("#addReverseIp #addIpReverse").focus();
                            return false;
                        }
            
                        $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
                        $(this).prop("disabled", true);
                        let result = await secureCall({ ajaxAction: true, iPaction: "addReverseIp", ipblock, reverseIp }, "POST");
                        result = result.split("</style>");
                        let response = JSON.parse(`${result[1]}`);
                        if (response.httpcode != 200) {
                            jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                        } else {
                            jQuery.growl.notice({ title: "Success", message: "Reverse DNS has been added successfully!", duration: 5000 });
                            $("#addReverseIp").modal("hide");
                            setTimeout(() =>  location.reload(), 5000)
                        }
                    } catch (error) {
                        console.error(error);
                        jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                    }
                    finally{
                        $(this).find("i").remove();
                        $(this).prop("disabled", false);
                    }
            
                })
                
                $(document).on("click", ".deleteFirewall", function () {
                    Swal.fire({
                        title: "Are you sure?",
                        text: "You want to delete firewall!",
                        icon: "question",
                        showCancelButton: true,
                        confirmButtonColor: "#3085d6",
                        cancelButtonColor: "#d33",
                        confirmButtonText: "Yes",
                    }).then(async (result) => {
                        if (result.isConfirmed) {
                            try {
                                let ip = $(this).closest("tr").data("ip");
                                $(this).css({ "cursor": "no-drop", "color": "#808080" });
                                $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
                                $(this).prop("disabled", true);
                                let result = await secureCall({ ajaxAction: true, iPaction: "deleteFirewall", ip }, "POST");
                                result = result.split("</style>");
                                let response = JSON.parse(`${result[1]}`);
                                if (response.httpcode != 200) {
                                    jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                                } else {
                                    jQuery.growl.notice({ title: "Success", message: "Firewall deleted successfully", duration: 5000 });
                                    setTimeout(() => location.reload(), 3000)
                                }
                            } catch (error) {
                                console.error(error);
                                jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                            }
                            finally{
                                $(this).prop("disabled", false);
                                $(this).find("i").remove();
                                $(this).css({ "cursor": "pointer", "color": "#212529" });
                            }
                        }
                    });
                });

            })
        </script>
        <style>
            #getFirewallRulesTable span.badge.bg-success, #getFirewallRulesTable span.badge.bg-secondary, #getFirewallRulesTable span.badge.bg-danger {
                color: #fff;
            }
            .bg-success {
                background-color: #28a745 !important;
            }
            #getFirewallRulesForm #getFirewallRulesTable .deleteFirewallRule {
                color: red;
                cursor: pointer;
                font-weight: 500;
            }
            .modal-header {

                background: #e5e5e5;
            }
            .float-right {
                float:right;
            }
            
            button.btn.btn-primary.addDirewallRule.float-right {
                cursor: pointer!important;
            }
            .form-row {
                display: flex;
                flex-wrap: wrap;
                margin-right: -5px;
                margin-left: -5px;
            }
            div#firewaAddllRules {
                padding: 20px;
                margin: 20px;
                box-shadow: 0px 3px 10px #00000017;
            }

            #getFirewallRules.modal .modal-dialog {
                width: 1140px !important;
            }
            form#getFirewallRulesForm button.btn.btn-primary.showModal {
                margin: 20px 20px 10px 0px;
                display: table;
                margin-left: auto;
            }
            table#ipsDetails tbody td i.fa-spin {
                font-size:20px;
            }
            .progress {
                background-color: #d8d8d8;
                border-radius: 20px;
                position: relative;
                margin: 0;
                height: 20px;
                padding: 0;
            }
            .progress-done {
                background: linear-gradient(to left, #F2709C, #FF9472);
                box-shadow: 0 3px 3px -5px #F2709C, 0 2px 5px #F2709C;
                border-radius: 20px;
                color: #fff;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100%;
                width: 0;
                opacity: 0;
                transition: 1s ease 0.3s;
            }
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
                border-bottom: 1px solid #ddd;
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
            .progress.reinstall {
                margin: 0 auto;
                max-width: 449px;
                margin-top: 20px;
                position: relative;
            }
            .installatio_progress {
                margin-bottom: 20px;
                font-weight:bolder !important;
            }
            div#installationDetails{
                max-height: 400px;
                overflow-y: scroll;
                width: 100%;
                background: #fff;
                box-shadow: 0px 3px 10px #00000021;
            }
            
            #installationDetails tbody td {

                padding:8px !important;
                
            }
            
            div#installationDetails thead{
                color: #fff;
                background-color: #343a40;
                border-color: #454d55;
                border-radius: 5px;
            }
            div#installationDetails {
                margin-top: 15px;
            }
            div#installationDetails thead{
                position:sticky;
                top: 0 ;
            }
            .modal-footer {
                margin-top:15px;
           }

           .switch {
                position: relative;
                display: inline-block;
                width: 55px;
                height: 26px;
            }
        
            .switch input {
                opacity: 0;
                width: 0;
                height: 0;
            }
            
            .slider {
                position: absolute;
                cursor: pointer;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: #ccc;
                -webkit-transition: .4s;
                transition: .4s;
            }
            
            .slider:before {
                position: absolute;
                content: "";
                height: 21px;
                width: 23px;
                left: 2px;
                bottom: 3px;
                background-color: white;
                -webkit-transition: .4s;
                transition: .4s;
            }
            
            input:checked+.slider {
                background-color: #2196F3;
            }
            
            input:focus+.slider {
                box-shadow: 0 0 1px #2196F3;
            }
            
            input:checked+.slider:before {
                -webkit-transform: translateX(26px);
                -ms-transform: translateX(26px);
                transform: translateX(26px);
            }
            
            /* Rounded sliders */
            .slider.round {
                border-radius: 34px;
            }
            
            .slider.round:before {
                border-radius: 50%;
            }
            
            #ipsDetails button i {
                text-align: center;
                width: auto;
                font-size: 15px;
                margin-bottom: 0;
            }
            
            #ipsDetails {
                padding: 15px !important;
                background: #fff;
                margin-top: 20px;
            }
            #ipsDetails .ipActionLists {
                display: none;
                background: #ffffff;
                border-radius: 3px;
                position: absolute;
                width: 170px;
                right: 0;
                box-shadow: 0px 0px 10px #0000001c;
                z-index: 2;
            }
            #ipsDetails .ipActionLists li:hover {
                background: #f5f5f5;
            }
            
            #ipsDetails .ipActionLists li {
                background-color: #FFF;
                margin: 0;
                border-bottom: 1px solid #eee;
                border-radius: 0;
                cursor: pointer;
                font-size: 13px;
                padding: 10px 10px;
            }
            
            #ipsDetails .ipActionLists li:last-child {
                border-bottom: transparent;
            }
            
            #ipsDetails .ipActionLists ul {
                padding: 0;
            }
            
            #ipsDetails .ipActionLists ul {
                padding: 10px;
                list-style-type: none;
                margin-bottom: 0px;
            }
            
            #ipsDetails .ipActionLists .active {
                color: #4078db;
            }
            
            #ipsDetails .ipActionLists i {
                font-size: 18px;
                color: red;
            }
            .mainSec .row {
                border-bottom: 1px solid #ececec;
                width: 100%;
                margin: 0;
                padding: 11px 18px;
                text-align: left;
            }
            
            .col-3 {
                flex: 0 0 25%;
                max-width: 25%;
            }
            
            .col {
                flex-basis: 0;
                flex-grow: 1;
                max-width: 100%;
            }
            .row {
                display: flex;
                flex-wrap: wrap;
                margin-right: -15px;
                margin-left: -15px;
            }
            .col-9 {
                flex: 0 0 75%;
                max-width: 75%;
            }
            #viewIpDetailsForm .modal-body .mainSec i {
                font-size: xxx-large;
                padding: 25px;
                text-align: center;
                width: 100%;
            }
            div#installationDetails .table thead th {
                vertical-align: bottom;
                border-bottom: 2px solid #dee2e6;
                background: #f1f1f1;
                padding: 15px;
                font-weight: 800;
                color: #000;
            }
            .reInstallOuter .form-group.row.justify-content-center {
                margin: 0;
            }
            .reInstallOuter {
                background: #f5f5f5;
                padding: 30px 15px 5px 15px;
            }
        </style>    
        ';

        return $style;
    }

    }
}); 
