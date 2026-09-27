
$(document).on('click', 'input[name="log"]:button', function () {

    var selectedbutton = $(this).val();
    var change = true;
    if (selectedbutton == 'Log') {
        $('#logsdata').css('display', 'block');
        $('#cronsdata').css('display', 'none');
        $('#cronlogtab').removeClass('cronlogactive');
        $('#logtab').addClass('logactive');
    } else {

        $('#logsdata').css('display', 'none');
        $('#cronsdata').css('display', 'block');
        $('#cronlogtab').addClass('cronlogactive');
        $('#logtab').removeClass('logactive');
    }
});

$(document).ready(function () {

    $(document).on('click', '#hideDepricatedProduct', function () {
        let values = [];
        $('[data-hideproducts]').each(function () {
            values.push($(this).data('hideproducts'));
        });

        if (values.length === 0) {
            jQuery.growl.error({ title: "Error", message: "No deprecated products found!", duration: 5000 });
            return;
        }

        Swal.fire({
            title: "Are you sure?",
            text: "You want to hide the product.",
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes",
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
                    $(this).prop("disabled", true);
                    let result = await secureCall({ ajaxAction: "hideDepricatedProduct", values }, 'POST');

                    response = JSON.parse(result);
                    console.log("result", response);
                    if (response.status == "success") {
                        jQuery.growl.notice({ title: "Success", message: response.status, duration: 5000 });
                    } else {
                        jQuery.growl.error({ title: "Error", message: response.status, duration: 5000 });
                    }
                } catch (error) {
                    console.error(error);
                    jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                }
                finally {
                    $(this).find("i").remove();
                    $(this).prop("disabled", false);
                }
            }
        });
    });

    $('#crondata').DataTable();
    $('#logdata').DataTable({
        ajax: {
            url: window.location.href,
            type: "GET",
            data: { getLogs: true },
            dataSrc: 'data'
        },
        processing: true,
        serverSide: true,
        columns: [
            { "data": 'date' },
            { "data": 'type' },
            { "data": 'action' },
            { "data": 'request' },
            { "data": 'response' }
        ]
    });
    $('#ordersTable').DataTable();


    $('#serverStaus').DataTable({
        "ordering": false
    });


    $("#checkLicense").on("click", async function () {
        Swal.fire({
            title: "Are you sure? You want to refresh the license!",
            text: "This will forcefully verify the license.",
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes",
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    licenseKey = $(this).data("licensekey");
                    $(this).html(`<i class="fa fa-spinner fa-spin"></i>`);
                    $(this).prop("disabled", true);
                    let result = await secureCall({ ajaxAction: "refreshLicense", licenseKey }, 'POST');

                    response = JSON.parse(result);
                    console.log("result", response);
                    if (response.status == "Active") {
                        jQuery.growl.notice({ title: "Success", message: response.status, duration: 5000 });
                    } else {
                        jQuery.growl.error({ title: "Error", message: response.status, duration: 5000 });
                    }

                    setTimeout(() => location.reload(), 2000)
                    // jQuery.growl.notice({ title: "Success", message: "Database has been upgraded successfully. please see the logActivity!", duration: 5000 });
                } catch (error) {
                    console.error(error);
                    jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                }
                finally {
                    $(this).html(`<i class="fas fa-sync-alt"></i>`);
                    $(this).prop("disabled", false);
                }
            }
        });


    })
    $("#module_upgrade").on("click", async function () {
        Swal.fire({
            title: "Are you sure?",
            text: "You want to upgrade the database!",
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes",
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    $(this).find("img").hide();
                    $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
                    $(this).prop("disabled", true);
                    let result = await secureCall({ ajaxAction: "upgradeDB" }, 'POST');
                    jQuery.growl.notice({ title: "Success", message: "Database has been updraded successfully. please see the logActivity!", duration: 5000 });
                } catch (error) {
                    console.error(error);
                    jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                }
                finally {
                    $(this).find("i").remove();
                    $(this).prop("disabled", false);
                }
            }
        });


    })



    /* generate consumer key page  */
    /* checking status */

    $("#servicetyp1").prop('checked', true);

    $("#employeetable > tbody > tr").each(function () {
        var auth_id = $(this).data("auth-id");
        $.ajax({
            url: window.location.href,
            type: "POST",
            async: false,
            data: { getStatus: "getStatus", auth_id },
            success: function (data) {
                var response = JSON.parse(data);
                if (response.status == "success") {
                    $(".status" + response.auth_id).html(`<span class="badge badge-success">Active</span>`);
                    $(".expiry_date" + response.auth_id).html(`${response.expiry_date}`);
                } else {
                    $(".status" + response.auth_id).html(`<span class="badge badge-secondary">Expired</span>`);
                    $(".expiry_date" + response.auth_id).html(`--`);
                }
            }
        });
    });

    /* re-generating consumer keys */
    $(".re_generate").on("click", function () {
        let auth_id = $(this).closest("tr").data("auth-id");

        $(this).html(`<i class="fas fa-sync fa-spin"></i>`);
        $.ajax({
            url: window.location.href,
            type: "POST",
            data: { reGenerateKey: "reGenerateKey", auth_id },
            success: function (data) {
                var response = JSON.parse(data);
                if (response.status == "success") {

                    window.location.href = response.message;

                }
                else {
                    $(".add_hdr").after(`<div class="alert alert-warning" role="alert">${response.message}</div>`);
                    // setTimeout(function () {
                    //     location.href = location.href;
                    // }, 2000);
                }
            },
            complete: function (data) {
                $(".re_generate").html(`<i class="fas fa-sync"></i>`);

            }
        })
    });

    /* view credentials */
    $(".viewCredentials").on("click", function () {
        let auth_id = $(this).closest("tr").data("auth-id");
        $.ajax({
            url: window.location.href,
            type: "POST",
            data: { viewCredentials: "viewCredentials", auth_id },
            beforeSend() {

                $("#viewCredentials").find(".loading-overlay").addClass('is-active').append('<i class="fas fa-spinner fa-pulse"></i>');
                $("#view_consumer_key").val("")
                $("#view_secret_key").val("")
                $("#view_app_key").val("")
            },
            success: function (data) {

                var response = JSON.parse(data);
                $("#view_consumer_key").val(response.consumer_key)
                $("#view_secret_key").val(response.secret_key)
                $("#view_app_key").val(response.application_key)
            },
            complete: function (data) {
                $("#viewCredentials").find('.loading-overlay').removeClass('is-active').find('.fas').remove();
            }
        })
    })


    /* deleting API credential */

    $(document).on("click", "#employeetable .deleteCredentials", async function () {
        let id = $(this).data("id");
        Swal.fire({
            title: "Are you sure?",
            text: "You want to delete the API credential!",
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes",
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    let authId = $(this).closest("tr").data("auth-id");
                    $(this).removeClass(`fas fa-trash-alt`).addClass(`fa fa-spinner fa-spin`);
                    $(this).prop("disabled", true);
                    let result = await secureCall({ tab: "deleteCredential", authId }, 'POST');
                    var response = JSON.parse(result)
                    if (response.status == "exist") {
                        if ('authId' in response == false) {
                            jQuery.growl.error({ title: "Error", message: response.message, duration: 5000 });
                            return;
                        }
                        $("#authIdToDelete").val(response.authId);
                        $("#chose_account option[value='" + response.authId + "']").remove();
                        $("#deleteMerzeCredentials").modal('show');
                    } else {
                        jQuery.growl.notice({ title: "Success", message: response.message, duration: 5000 });
                        setTimeout(() => location.reload(), 2000)
                    }
                } catch (error) {
                    console.error(error);
                    jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                } finally {
                    $(this).removeClass(`fa fa-spinner fa-spin`).addClass(`fas fa-trash-alt`);
                    $(this).prop("disabled", false);
                }
            }
        });
    })

    $(document).on("click", ".confirmDeleteCredentials", async function () {
        let merge_account = $("#chose_account").val();
        let authId = $("#authIdToDelete").val();
        $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
        $(this).prop("disabled", true);

        let result = await secureCall({ tab: "mergeAndDeleteCredential", authId, merge_account }, 'POST');
        var response = JSON.parse(result)
        if (response.status == "success") {
            jQuery.growl.notice({ title: "Success", message: response.message, duration: 5000 });
            setTimeout(() => location.reload(), 2000)
        } else {
            jQuery.growl.error({ title: "Error", message: response.message, duration: 5000 });
        }
        $("#deleteMerzeCredentials").modal('hide');
        $(this).find('i.fa-spinner').remove();
        $(this).prop("disabled", false);
    });
    /* generate consumer key page end  */

    $("#hideOS").select2();
    $(".select2").select2();
    $("#productSetting").select2();

    /*  location  */
    $("#soyoulocation").change(function () {
        if ($(this).val() == 'europe') {
            var location_url = 'https://eu.api.ovh.com/createApp/';
        } else if ($(this).val() == 'canada') {
            var location_url = 'https://ca.api.ovh.com/createApp/';
        } else if ($(this).val() == 'us') {
            var location_url = 'https://api.ovh.us/createApp/';
        } else if ($(this).val() == 'uk') {
            var location_url = 'https://api.ovh.com/createApp/';
        } else if ($(this).val() == 'singapore') {
            var location_url = 'https://api.ovh.com/createApp/';
        } else if ($(this).val() == 'world') {
            var location_url = 'https://api.ovh.com/createApp/';
        }
        $("#set_ser_pro").attr('href', location_url);
    });

    /* 
      generation API url on onChange of service provider (Company)
      set service provider */
    $("#set_service_provider").change(function () {
        var value = $(this).val();
        if ($("#soyoulocation").val() == 'europe') {
            var location_url = 'https://eu.api.ovh.com/createApp/';
        } else if ($("#soyoulocation").val() == 'canada') {
            //var location_url = 'ca';
            var location_url = 'https://ca.api.ovh.com/createApp/';
        } else if ($(this).val() == 'us') {
            var location_url = 'https://api.ovh.us/createApp/';
        } else if ($(this).val() == 'uk') {
            var location_url = 'https://api.ovh.com/createApp/';
        } else if ($(this).val() == 'singapore') {
            var location_url = 'https://api.ovh.com/createApp/';
        } else if ($(this).val() == 'world') {
            var location_url = 'https://api.ovh.com/createApp/';
        }
        $("#set_ser_pro").attr('href', location_url);
    });

    /* tab ajax */

    $(".tabs li").on("click", async function () {
        let tab_menu = $(this).data("tabmenu");

        if (tab_menu == "priceSettings") {
            $('#priceSettings i.fa-spin').remove();
            $("#priceSettingForm").hide()
            $(".btn_section.addprice button").prop("disabled", true);
            $('#priceSettings table tbody').html(`<tr>
                <td colspan="8"><i class="fa fa-spinner fa-spin"></i> </td>
                </tr>`);

            let result = await secureCall({ tabAction: "priceSettings" }, 'POST');
            $('#priceSettings table tbody').html(`${result}`);
            $(".btn_section.addprice button").prop("disabled", false);
            $(this).addClass("loaded");
        } else if (tab_menu == "imap") {
            $('#imapACLSettings i.fa-spin').remove();
            $("#imapACLSettings").html(`<i class="fa fa-spinner fa-spin"></i>`);
            let result = await secureCall({ tabAction: "imapNotificationSettings" }, 'POST');
            $('#imapACLSettings').html(`${result}`);
        }

        else if (tab_menu == "general") {
            $('#generalACLSettings i.fa-spin').remove();
            $("#generalACLSettings").html(`<i class="fa fa-spinner fa-spin"></i>`);
            let result = await secureCall({ tabAction: "generalACLSettings" }, 'POST');
            $('#generalACLSettings').html(`${result}`);
        }
        else if (tab_menu == "orderformSettings") {
            $('#orderformACLSettings i.fa-spin').remove();
            $("#orderformACLSettings").html(`<i class="fa fa-spinner fa-spin"></i>`);
            let result = await secureCall({ tabAction: "orderformACLSettings" }, 'POST');
            $('#orderformACLSettings').html(`${result}`);
        }
        else if (tab_menu == "aclSettings") {
            $('#aclSettings i.fa-spin').remove();
            $(".UpdateAclSettings").hide();
            $('#aclSettings table tbody').html(`<tr>
            <td colspan="3"><i class="fa fa-spinner fa-spin"></i> </td>
            </tr>`);
            let result = await secureCall({ tabAction: "aclSettings" }, 'POST');
            result = result.length != 0 ? result : `<tr><td class="text-center" colspan="2">No Record Found!</td></tr>`;
            $("#aclSettings table.datatable tbody").html(`${result}`);
            $(".UpdateAclSettings").show().prop("disabled", false);;
            $(document).find(".select2").select2();
        }

    });


    $(document).on("click", "#priceSettings .editPrice", async function () {
        let id = $(this).data("id");

        $("#sameMargin").css("display", "none")
        $("#priceSettingForm").find("i").remove();

        $("#priceSettingForm .addPriceMargin").hide();
        $("#priceSettingForm .EditPriceMargin").show();

        $("#priceSettingForm").css("display", "block");
        $("#priceSettings").find(".price-settings-loader").addClass("active").append(`<i class="fa fa-spinner fa-spin"></i>`);
        let result = await secureCall({ tabAction: "editPrice", id }, 'POST');
        let response = JSON.parse(result);

        $("#servertype").val(`${response.servertype}`);
        $("#productprice").val(`${response.productprice}`);
        $("#additionalIPprice").val(`${response.additionalIPprice}`);
        $("#autobackupprice").val(`${response.autobackupprice}`);
        $("#imageprice").val(`${response.imageprice}`);
        $("#setupprice").val(`${response.setupprice}`);
        $("#snapshotprice").val(`${response.snapshotprice}`);
        $("#additionaldiskprice").val(`${response.additionaldiskprice}`);
        $("#snapprice").val(`${response.snapprice}`);
        $("#backupspaceprice").val(`${response.backupspaceprice}`);
        $("#snapprice").val(`${response.snapprice}`);
        $("#publicNetwork").val(`${response.publicnetworkprice}`);
        $("#privateNetwork").val(`${response.privateetworkprice}`);
        $("#storage").val(`${response.storageprice}`);
        $("#plesk").val(`${response.pleskprice}`);
        $("#priceId").val(`${response.id}`);
        $("#cpanelsoftprice").val(`${response.cpanelsoftprice}`);
        $("#productpaymentmethod").val(`${response.paymentmethod}`);
        $("#priceSettings").find(".price-settings-loader").removeClass("active");
        $("#priceSettings").find("i").remove("i");
    })

    $(document).on("click", "#priceSettingForm .addPriceMargin", async function () {
        let data = $("#priceSettingForm").serialize();
        $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
        $(this).prop("disabled", true);
        $(".tabs-content").find(".errorbox").remove();
        $(".tabs-content").find(".successbox").remove();
        let result = await secureCall({ tabAction: "addPriceMargin", data }, 'POST');
        if (result != "1") {
            $("#priceSettings").find(".alert.alert-secondary").before(`<div class="errorbox"><strong><span class="title">Oops...</span></strong><br>${result}</div>`);
        } else {
            $("#priceSettings").find(".alert.alert-secondary").before(`<div class="successbox"><strong><span class="title">Changes Saved Successfully!</span></strong><br>Price has been added Successfully</div>`);
            $(".tabs").find(".active-tab").trigger("click");
            $("#priceSettingForm").trigger("reset").slideUp(1000);
        }
        $(this).find("i").remove();
        $(this).prop("disabled", false);

    })


    $(document).on("click", "#priceSettingForm .EditPriceMargin", async function () {

        let data = $("#priceSettingForm").serialize();
        $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
        $(this).prop("disabled", true);
        let result = await secureCall({ tabAction: "updatePrice", data }, 'POST');
        let response = JSON.parse(result);
        $(".tabs-content").find(".errorbox").remove();
        $(".tabs-content").find(".successbox").remove();
        if (response.exist) {
            $("#priceSettings").find(".alert.alert-secondary").before(`<div class="errorbox"><strong><span class="title">Oops...</span></strong><br>${response.message}</div>`);
        } else {
            $("#priceSettings").find(".alert.alert-secondary").before(`<div class="successbox"><strong><span class="title">Changes Saved Successfully!</span></strong><br>Price has been updated Successfully</div>`);
        }
        $(this).find("i").remove();
        $(this).prop("disabled", false);
        $(".tabs").find(".active-tab").trigger("click");
        $("#priceSettingForm").trigger("reset").slideUp(1000);
    })

    $(document).on("click", "#priceSettings .deletePrice", async function () {
        let id = $(this).data("id");
        Swal.fire({
            title: "Are you sure?",
            text: "You want to delete the product!",
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes",

        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    $(this).find("img").hide();
                    $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
                    $(this).prop("disabled", true);
                    $(".tabs-content").find(".errorbox").remove();
                    $(".tabs-content").find(".successbox").remove();
                    let result = await secureCall({ tabAction: "deletePrice", id }, 'POST');
                    if (result != "1") {
                        $("#priceSettings").find(".alert.alert-secondary").before(`<div class="errorbox"><strong><span class="title">Oops...</span></strong><br>${result}</div>`);
                    } else {
                        $("#priceSettings").find(".alert.alert-secondary").before(`<div class="successbox"><strong><span class="title">Changes Saved Successfully!</span></strong><br>Price has been deleted successfully!</div>`);
                    }
                    $(".tabs").find(".active-tab").trigger("click");
                } catch (error) {
                    console.error(error);
                    $("#priceSettings").find(".alert.alert-secondary").before(`<div class="errorbox"><strong><span class="title">Oops...</span></strong><br>${error}</div>`);
                }
            }
        });

    })

    $(document).on("click", "#imapACLSettings .updateImapAclSettings", async function () {
        $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
        $(this).prop("disabled", true);
        $(".tabs-content").find(".errorbox").remove();
        $(".tabs-content").find(".successbox").remove();
        let data = $("#imapACLSettings").serialize();
        let result = await secureCall({ tabAction: "updateImapAclSettings", data }, 'POST');
        if (result == "Data has been updated successfully!" || "Data has been inserted successfully!") {
            $("#imapNotificationSetting").find(".alert.alert-secondary").before(`<div class="successbox"><strong><span class="title">Changes Saved Successfully!</span></strong><br>${result}</div>`);
        } else {
            $("#imapNotificationSetting").find(".alert.alert-secondary").before(`<div class="errorbox"><strong><span class="title">Oops...</span></strong><br>${result}</div>`);
        }
        $(".tabs").find(".active-tab").trigger("click");
    })


    $(document).on("click", "#generalACLSettings .updateGeneralAclSettings", async function () {
        $(".tabs-content").find(".errorbox").remove();
        $(".tabs-content").find(".successbox").remove();
        $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
        $(this).prop("disabled", true);
        let data = $("#generalACLSettings").serialize();
        let result = await secureCall({ tabAction: "updateGeneralAclSettings", data }, 'POST');
        if (result == "Data has been updated successfully!" || "Data has been inserted successfully!") {
            $("#generalSettings").find(".alert.alert-secondary").before(`<div class="successbox"><strong><span class="title">Changes Saved Successfully!</span></strong><br>${result}</div>`);
        } else {
            $("#generalSettings").find(".alert.alert-secondary").before(`<div class="errorbox"><strong><span class="title">Oops...</span></strong><br>${result}</div>`);
        }
        $(".tabs").find(".active-tab").trigger("click");
    })
    $(document).on("click", "#aclSettings .UpdateAclSettings", async function () {
        $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
        $(this).prop("disabled", true);
        let data = $("#aclSettings form").serialize();
        $(".tabs-content").find(".errorbox").remove();
        $(".tabs-content").find(".successbox").remove();
        let result = await secureCall({ tabAction: "UpdateAclSettings", data }, 'POST');
        if (result == "1" || result == "") {
            $("#aclSettings").find(".alert.alert-secondary").before(`<div class="successbox"><strong><span class="title">Changes Saved Successfully!</span></strong><br> Data has been update successfully!</div>`);
            $(".tabs").find(".active-tab").trigger("click");
        } else {
            $("#aclSettings").find(".alert.alert-secondary").before(`<div class="errorbox"><strong><span class="title">Oops...</span></strong><br>${result}</div>`);
        }
    })
    $(document).on("click", "#orderformACLSettings .updateOrderformACLSettings", async function () {
        $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
        $(this).prop("disabled", true);
        let data = $("#orderformSettings form").serialize();
        $(".tabs-content").find(".errorbox").remove();
        $(".tabs-content").find(".successbox").remove();
        let result = await secureCall({ tabAction: "updateOrderformACLSettings", data }, 'POST');
        if (result == "Data has been updated successfully!" || "Data has been inserted successfully!") {
            $("#orderformSettings").find(".alert.alert-secondary").before(`<div class="successbox"><strong><span class="title">Changes Saved Successfully!</span></strong><br>${result}</div>`);
        } else {
            $("#orderformSettings").find(".alert.alert-secondary").before(`<div class="errorbox"><strong><span class="title">Oops...</span></strong><br>${result}</div>`);
        }
        $(".tabs").find(".active-tab").trigger("click");
    })


    $(document).on("click", "#orderformACLSettings .activateDeactiveTheme", async function () {
        let action = $(this).data("action");
        let message = (action == "deactive" ? "This will set the default order form!" : "This will assign the OVH order form with all OVH product groups!")
        Swal.fire({
            title: "Are you sure?",
            text: `${message}`,
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes",
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
                    $(this).prop("disabled", true);
                    $(".tabs-content").find(".errorbox").remove();
                    $(".tabs-content").find(".successbox").remove();
                    let result = await secureCall({ tabAction: "activateDeactiveTheme", themeAction: action }, 'POST');
                    if (result == "Order form has been deactivated successfully!" || "Order form has been activated successfully!") {
                        $("#orderformSettings").find(".alert.alert-secondary").before(`<div class="successbox"><strong><span class="title">Changes Saved Successfully!</span></strong><br>${result}</div>`);
                    } else {
                        $("#orderformSettings").find(".alert.alert-secondary").before(`<div class="errorbox"><strong><span class="title">Oops...</span></strong><br>${result}</div>`);
                    }
                    setTimeout(() => $(".tabs").find(".active-tab").trigger("click"), 1000)
                } catch (error) {
                    console.error(error);
                    jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                }
                finally {
                    $(this).find("i").remove();
                    $(this).prop("disabled", false);
                }
            }
        });



    })






    /* // check uncheck all check box in manage email template page  */
    $("#checkall0").click(function () {
        if ($('#checkall0').prop("checked") == false) {
            $("#displayRec .checkall").prop('checked', false);
        } else {
            $("#displayRec .checkall").prop('checked', true);
        }
    });

    /*  toggle button webmail and gmail */
    $(document).on('click', 'input[name="mailsettigs"]:button', function () {

        var selectebutton = $(this).val();
        if (selectebutton == 'Gmail') {
            $('#imapform').css('display', 'none');
            $('#gmaildiv').css('display', 'block');
            $('#webtab').removeClass('webactive');
            $('#gmailtab').addClass('gmailactive');
        } else {
            $('#imapform').css('display', 'block');
            $('#gmaildiv').css('display', 'none');
            $('#webtab').addClass('webactive');
            $('#gmailtab').removeClass('gmailactive');
        }
    });

    $(document).on('click', 'editcolor', function () {
        $('#gmailtab').addClass('gmailactive');
    });


    /* Existing server page start*/
    $(document).on('change', '.userselectexist', function () {
        var id = jQuery('#useridexist').val();
        $("#service-list").html('<option value="">Loading...</option>');
        $.ajax({
            url: window.location.href,
            type: "POST",
            data: { serverList: "getServiceList", userId: id },
            dataType: "json",
            success: function (data) {
                $("#service-list").html(data);
            }
        });

    });

    $(document).on('click', 'input[name="existingsetting"]:button', function () {
        var selectedbutton = $(this).val();
        $("body").removeClass("activeButton");
        $(this).addClass("activeButton");
        var change = true;
        if (selectedbutton == 'New') {
            $('#existingform').css('display', 'none');
            $('#newform').css('display', 'block');
            $('#existtab').removeClass('existactive');
            $('#newtab').addClass('newactive');
            $('.tab-pane-new').addClass('newtabactive');
            $('.tab-pane-exist').removeClass('existingactive');
            $("#servicetyp1").removeClass("activeButton");
            $("#servicetyp2").addClass("activeButton");
            $('.existingserver_existing_note').css('display', 'none');
            $('.existingserver_new_note').css('display', 'block');

        } else {
            $("#servicetyp2").removeClass("activeButton");
            $("#servicetyp1").addClass("activeButton");

            $('#existingform').css('display', 'block');
            $('#newform').css('display', 'none');
            $('.existingserver_existing_note').css('display', 'block');
            $('.existingserver_new_note').css('display', 'none');
            $('#newtab').removeClass('newactive');
            $('#existtab').addClass('existactive');
            $('.tab-pane-exist').addClass('existingactive');
            $('.tab-pane-new').removeClass('newtabactive');
        }
    });



    $(document).on("change", "#product-list, #billing-list", function () {
        let productId = $("#product-list").val();

        if (productId == '') {
            $("#newform #product-list").closest(".form-group").append(
                `<span class="validationError">* Please select product first! </span>`);
            return false;
        }

        let billingCycle = $('#billing-list').val();

        $.ajax({
            url: window.location.href,
            type: "POST",
            data: { getProductConfOption: "true", productId, billingCycle },
            beforeSend() {
                $("#productConfigoptions").empty();
                $("#productConfigoptions").siblings("label").remove();
                $(".validationError").remove();
                $("#productConfigoptions").css("display", "block").before(
                    `<label for="">Configurable Options</label>`);
                $("#productConfigoptions").append(
                    `<i class="fa fa-spinner fa-spin fa-3x fa-fw" style="position: relative;top: 0px;left: 47%;"></i>`
                );
            },
            success: function (data) {
                $("#productConfigoptions").append(data);
            },
            complete: function (data) {
                $("#productConfigoptions i").remove();
            }
        })
    })


    $(document).on("click", "#newform #newServer", async function () {

        try {
            if (validateProductOrder()) {
                console.log("ddd", validateProductOrder());
                return false;
            }

            let formData = $("#existingserver").serialize();
            $(this).append(`<i class="fas fa-sync fa-spin"></i>`);
            $(this).prop("disabled", true);

            let result = await secureCall({ ajaxAction: "createNewOrder", data: formData }, 'POST');
            result = JSON.parse(result)
            if (result.hasOwnProperty("error") || (result.hasOwnProperty("result") && result.result == "error")) {
                let errorMessage = result.hasOwnProperty("result") ? result.message : result.error;
                $("#existingserver .newtabactive").find(".alert.alert-secondary").before(`<div class="errorbox"><strong><span class="title">Oops...</span></strong><br>${errorMessage}</div>`);
                $(this).find("i").remove();
                $(this).prop("disabled", false);
            } else {
                $("#existingserver .newtabactive").find(".alert.alert-secondary").before(`<div class="successbox"><strong><span class="title">Changes Saved Successfully!</span></strong><br>Order has been created successfully!</div>`);
                setTimeout(() => window.location.reload(), 1000)
            }
        } catch (error) {
            console.error(error)
            $("#existingserver .newtabactive").find(".alert.alert-secondary").before(`<div class="errorbox"><strong><span class="title">Oops...</span></strong><br>${error}</div>`);
        }
    })



    /* Existing server page end */


    $(document).on("change", "#googleAuthentication", async function () {

        if ($(this).val() == "oauth2") {
            $("#googlePassword").closest("div.col-md-6").css("display", "none")

            $("#redirectionUrl").closest("div.col-md-6").css("display", "block")
            $("#googleClientID").closest("div.col-md-6").css("display", "block")
            $("#clientSecret").closest("div.col-md-6").css("display", "block")
            $("#googleConnectionToken").closest("div.col-md-6").css("display", "block")
            $("#btnConfigureOauth2").show();
            ($("#googleConnectionToken").val() == '' ? $("#btnTestAuth2Connection").prop("disabled", true) : $("#btnTestAuth2Connection").prop("disabled", false));
        } else {
            $("#googlePassword").closest("div.col-md-6").css("display", "block")

            $("#redirectionUrl").closest("div.col-md-6").css("display", "none")
            $("#googleClientID").closest("div.col-md-6").css("display", "none")
            $("#clientSecret").closest("div.col-md-6").css("display", "none")
            $("#googleConnectionToken").closest("div.col-md-6").css("display", "none")
            $("#btnConfigureOauth2").hide();
            $("#btnTestAuth2Connection").prop("disabled", false)
        }


    })

    /* google test connection */
    $(document).on("click", "#btnTestAuth2Connection", async function (e) {
        try {
            e.preventDefault();

            $(this).find("i").remove();
            $("#Google").find("#mailProviderError").remove();
            $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
            $(this).prop("disabled", true);
            const data = $("#googleForm").serialize().split('&').reduce((acc, keyValue) => {
                const [key, value] = keyValue.split('=');
                acc[key] = decodeURIComponent(value);
                return acc;
            }, {});

            let result = await secureCall(
                {
                    token: data.token,
                    service_provider: "Google",
                    host: data.googleHostName,
                    port: data.googleEmailPort,
                    auth_type: "plain",
                    login: data.googleEmailAddress,
                    oauth2_client_id: "",
                    oauth2_client_secret: "",
                    oauth2_refresh_token: "",
                    password: data.googlePassword,
                    addfieldname: "",
                    addsortorder: 0,
                    addfieldtype: "text",
                    addcfdesc: "",
                    addregexpr: "",
                    addfieldoptions: ""
                },
                'POST', "https://ovh-new.shinedezign.pro/admin/index.php?rp=/admin/setup/support/mail/test_connection");


            if (result.hasOwnProperty("error")) {

                $("#googleForm").before(`<div class="alert alert-warning" id="mailProviderError" role="alert">The Mail Import test failed: ${result.error}</div>`)

            } else {
                console.log(result);
            }


        } catch (error) {
            console.error(error);
        } finally {
            $(this).find("i").remove();
            $(this).prop("disabled", false);
        }

    })
    /* IMAP test connection */

    $(document).on("click", "#testWebMail", async function (e) {
        try {
            $(this).find("i").remove();
            $("#mailProviderError").remove();
            $("#imapform").find(".errors").remove();
            const data = $("#imapform").serialize();
            if ($("#hostname").val() == "") {
                $("#hostname").after(`<span class="errors"> *This field is required! </span>`);
                return false;
            }
            else if ($("#portnumber").val() == "") {
                $("#portnumber").after(`<span class="errors"> *This field is required! </span>`);
                return false;
            }
            else if ($("#username").val() == "") {
                $("#username").after(`<span class="errors"> *This field is required! </span>`);
                return false;
            }
            else if ($("#password").val() == "") {
                $("#password").after(`<span class="errors"> *This field is required! </span>`);
                return false;
            }

            $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
            $(this).prop("disabled", true);
            let result = await secureCall({ ajaxaction: "imapTestConnection", data }, 'POST');
            if (result == "Connection success!") {
                $(".nav.nav-tabs").before(`<div class="alert alert-success" id="mailProviderError" role="alert">Webmail connected successfully!</div>`)
            } else {
                $(".nav.nav-tabs").before(`<div class="alert alert-danger" id="mailProviderError" role="alert">${result}</div>`)
            }
        } catch (error) {
            console.error(error);
        } finally {
            $(this).find("i").remove();
            $(this).prop("disabled", false);
        }

    })


    $(document).on("click", "#addWebmail", async function () {
        try {
            $(this).find("i").remove();
            $("#mailProviderError").remove();
            $("#imapform").find(".errors").remove();
            const data = $("#imapform").serialize();
            const type = $("#addWebmail").html();
            if ($("#hostname").val() == "") {
                $("#hostname").after(`<span class="errors"> *This field is required! </span>`);
                return false;
            }
            else if ($("#portnumber").val() == "") {
                $("#portnumber").after(`<span class="errors"> *This field is required! </span>`);
                return false;
            }
            else if ($("#username").val() == "") {
                $("#username").after(`<span class="errors"> *This field is required! </span>`);
                return false;
            }
            else if ($("#password").val() == "") {
                $("#password").after(`<span class="errors"> *This field is required! </span>`);
                return false;
            }

            $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
            $(this).prop("disabled", true);
            let result = await secureCall({ ajaxaction: "addWebmail", data, type }, 'POST');

            if (result == "Connection success!") {
                $(".nav.nav-tabs").before(`<div class="alert alert-success" id="mailProviderError" role="alert">Webmail connected successfully!</div>`)
            } else {
                $(".nav.nav-tabs").before(`<div class="alert alert-danger" id="mailProviderError" role="alert">${result}</div>`)
            }


        } catch (error) {
            console.error(error);
        } finally {
            $(this).find("i").remove();
            $(this).prop("disabled", false);
        }

    })


    $(document).on('change', '.location_provider', function () {
        var location = $(this).val();
        var provider = "ovh";
        $(".account-list").html('<option value="">Loading...</option>');
        $.ajax({
            url: window.location.href,
            type: "POST",
            data: { accountNumber: "getAccountNumber", location: location, provider: provider },
            dataType: "json",
            success: function (data) {
                $(".account-list").html('');
                $(".account-list").html(data);
            }
        });

    });


    /*  product setting page  */
    /*  hidding loader */
    $("#cover-spin").css("display", "none");
    if ($('#product_setup').length) {
        ovhsubsidiarytype();
        ovhlocationtype();
    }

    $(document).on("click", ".type", function () {
        $(".type").removeClass("active");
        $(this).addClass("active");
        var productType = $(this).data("producttype");
        var locationType = $(document).find("#ovhlocationtype").val();
        if (locationType == "Ovh") {
            $(".subsidiaryclass").show();
            ovhsubsidiarytype();
        } else {
            $(".subsidiaryclass").hide();
        }

        $("#ovhproductgroupname").val(productType);
        if (productType == "Dedicated") {
            getProductGroup("soyoustart");
        } else if (productType == "VPS") {
            getProductGroup("soyoustart_vps");
        } else {
            getProductGroup("soyoustart_eco");
        }

    });


    $("#inputModule").change(function () {
        ovhsubsidiarytype();
        // ovhPaymentMethod();
    });


    $("#ovhsubsidiarytype").change(function () {
        ovhlocationtype();
    });

    $("#inputovhgroup").change(function () {
        getProducts();
    });


    $(document).on("click", '.productsync', function () {
        swal({
            title: "Are you sure?",
            text: "Do you want to sync the product",
            icon: "warning",
            dangerMode: true,
            buttons: true,
        })
            .then((willclient) => {
                if (willclient) {
                    $(this).prop("disabled", true);
                    $(this).find("#mapText").addClass("hidden");
                    $(this).find("#mapLoading").removeClass("hidden");
                    let clientId = $(this).val();
                    if (clientId) {
                        $.ajax({
                            method: "POST",
                            data: {
                                "action": "ClientAdd",
                                "clientid": clientId
                            },
                            // url: "../modules/addons/zohobook/ajax/ajax.php",
                            success: function (data) {
                                let response = JSON.parse(data);
                                if (response.status == true) {
                                    swal("Client Mapping", "Client mapped Successfully", "success");
                                    window.location.reload();
                                }

                            },
                        })
                    }
                }
            })
    });


    $(document).on("click", "#saveHideOs", function () {

        Swal.fire({
            title: "Are you sure?",
            text: "You want to hide the os name, this may take 1-2 minutes!",
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes",

        }).then(async (result) => {
            if (result.isConfirmed) {

                let selectedOs = $('#hideOS').val();
                $(this).html(`Save Os <i class="fas fa-sync fa-spin"></i>`);
                $(this).prop("disabled", true);

                $.ajax({
                    url: window.location.href,
                    type: "POST",
                    data: { saveHideOs: "saveHideOs", selectedOs },
                    success: function (data) {
                        if (data == "Data has been inserted successfully!" || data == "Data has been updated successfully!") {
                            jQuery.growl.notice({ title: "Success", message: "OS name has been successfully hidden!", duration: 5000 });
                        } else {
                            jQuery.growl.error({ title: "Error", message: data, duration: 5000 });
                        }
                    },
                    complete: function (data) {
                        $("#saveHideOs i").remove();
                        $("#saveHideOs").prop("disabled", false);
                    }
                });
            }
        })

    })


    $(document).on("click", ".delete_product", async function () {
        Swal.fire({
            title: "Are you sure?",
            text: "You want delete the product!",
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes",

        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    let Id = $(this).data("id");
                    $(this).html(`<i class="fas fa-sync fa-spin"></i>`);
                    $(this).prop("disabled", true);
                    let result = await secureCall({ ajaxAction: "deleteProduct", Id }, 'POST');
                    if (result == "success") {
                        jQuery.growl.notice({ title: "Success", message: "Product has been deleted successfully!", duration: 5000 });
                        $(this).closest("tr").css("display", "none");
                    } else {
                        jQuery.growl.error({ title: "Error", message: result, duration: 5000 });
                        $(this).html(`Delete`);
                        $(this).prop("disabled", false);
                    }
                } catch (error) {
                    console.error(error)
                }
            }
        })


    })
    $(document).on("click", ".enableDisablePriceSync", async function () {

        let actionType = $(this).data("type");
        Swal.fire({
            title: "Are you sure?",
            text: `You want ${actionType} the product!`,
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes",

        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    let Id = $(this).data("id");
                    $(this).append(`<i class="fas fa-sync fa-spin"></i>`);
                    $(this).prop("disabled", true);
                    let result = await secureCall({ ajaxAction: "enableDisablePriceSync", actionType, Id }, 'POST');
                    result = JSON.parse(result)
                    if (result.status == "success") {
                        jQuery.growl.notice({ title: "Success", message: `Price sync has been ${result.actionType} successfully!`, duration: 5000 });
                        if (result.actionType == "disable") {
                            $(this).removeClass("btn-info").addClass("btn-primary").html("Enable Price Sync");
                            $(this).data("type", "enable");
                        } else {
                            $(this).removeClass("btn-primary").addClass("btn-info").html("Disable Price Sync");
                            $(this).data("type", "disable");
                        }

                    } else {
                        jQuery.growl.error({ title: "Error", message: result.status, duration: 5000 });
                    }
                    $(this).prop("disabled", false);
                    $(this).find("i").remove();
                } catch (error) {
                    console.error(error)
                }
            }
        })


    })


    $(document).on("click", ".createProduct", async function () {

         if (($("#ovhproducthtml table input[type='checkbox']:checked").length) === 0) {
            jQuery.growl.error({ title: "Error", message: "Please select at least one product to import/create!", duration: 5000 });
            return;
        }
        Swal.fire({
            title: "Are you sure?",
            text: `You want to import/create the product!`,
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes",

        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    let data = $("#product_setup").serialize();
                    $(this).append(`<i class="fas fa-sync fa-spin"></i>`);
                    $(this).prop("disabled", true);
                    let result = await secureCall({ ajaxAction: "soyouStartproductSetup", data }, 'POST');
                    // result = JSON.parse(result)
                    if (result == "Product has been created successfully!") {
                        $(".innerContent").find(".alert.alert-secondary").before(`<div class="successbox"><strong><span class="title">Success!</span></strong><br>Product has been created successfully!</div>`);
                        // $(".tabs").find(".active-tab").trigger("click");
                    } else if (result) {
                        $(".innerContent").find(".alert.alert-secondary").before(`<div class="errorbox"><strong><span class="title">Oops...</span></strong><br>${result}</div>`);
                    }
                    $(this).prop("disabled", false);
                    $(this).find("i").remove();
                    $("html, body").animate({
                        scrollTop: 0
                    }, 10)
                    setTimeout(() => window.location.href = window.location.href, 3000)

                } catch (error) {
                    console.error(error)
                    $(".innerContent").find(".alert.alert-secondary").before(`<div class="errorbox"><strong><span class="title">Oops...</span></strong><br>${error}</div>`);
                }
            }
        })



    });







    // if(!$("#ovhproducthtml table input[type='checkbox']:checked").length){
    //     $(".createProduct").prop("disabled", "true");
    //     $(".createProduct").after(`<p class="errors">Select at least one product to import/create</p>`);
    // } else{
    //     $(".createProduct").prop("disabled", "false");
    //     $("#product_setup").find(".errors").remove();
    // } 


    // $(document).on("click", "#ovhproducthtml table input[type='checkbox']", function (e) {
    //     if(!$("#ovhproducthtml table input[type='checkbox']:checked").length){
    //         $(".createProduct").prop("disabled", "true");
    //         $(".createProduct").after(`<p class="errors">Select at least one product to import/create</p>`);
    //     } else{
    //         $(".createProduct").prop("disabled", "false");
    //         $("#product_setup").find(".errors").remove();
    //     } 
    // })


    /* orders page js */

    if ($(document).find("#ordersTable").length > 0) {

        getorderStatus();
    }
    $(document).on("click", "#ordersTable_wrapper .paginate_button", function () {
        if (!$(this).hasClass("disabled")) {
            getorderStatus()
            window.setTimeout(async () => $("#ordersTable_wrapper .paginate_button.curent").trigger("click"), 1000);
        }
    })



    /* orders page js end */


    /* server status page start */


    $(document).on("click", "#terminateServer", function () {

        Swal.fire({
            title: "Are you sure?",
            text: "You want to terminate the server!",
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes",

        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    let serverName = $(this).closest("tr").data("servername");
                    let serverType = $(this).closest("tr").data("servertype");
                    let id = $(this).data("id");
                    $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
                    $(this).prop("disabled", true);

                    let result = await secureCall({ ajaxAction: "terminateServer", serverName, serverType, id }, 'POST');
                    var response = JSON.parse(result)
                    $(this).prop("disabled", false);
                    $(this).find("i").remove();
                    if (response.httpcode != 200) {
                        jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                    } else {
                        jQuery.growl.notice({ title: "Success", message: response.result, duration: 5000 });
                    }

                } catch (error) {
                    console.error(error)
                }
            }
        });


    })



    /* server status page end */


    // if ($(document).find("#serverStaus").length > 0) {

    //     getServerDetails();
    // }



    $(document).on("click", "#clearLog", async function () {
        Swal.fire({
            title: "Are you sure?",
            text: "You want to clear the log!",
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes",
        }).then(async (result) => {
            if (result.isConfirmed) {

                $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
                $(this).prop("disabled", true);
                let result = await secureCall({ deleteLog: true }, 'POST');
                jQuery.growl.notice({ title: "Success", message: "Log has been deleted successfully!", duration: 5000 });

                window.location.href = window.location.href;

            }
        });
    })


});


const validateProductOrder = () => {
    const activeForm = $('.serverBproperty.activeButton').val();
    if (activeForm == "Existing") {
        let useridexist = $("#existingform #useridexist").val();
        let services = $("#existingform #service-list").val();
        let location = $("#existingform #location-list").val();
        let account = $("#existingform #account-list").val();
        let ovhservernameexist = $("#existingform .ovhservernameexist").val();
        let ovhCustomHostName = $("#existingform .ovhCustomHostName").val();

        var error = false;
        $(".validationError").remove();
        if (useridexist == "" || useridexist == null) {
            var error = true;
            $("#existingform #useridexist").closest(".form-group").append(
                `<span class="validationError">* This field is required! </span>`);
        }
        if (services == "" || services == null) {
            var error = true;
            $("#existingform #service-list").closest(".form-group").append(
                `<span class="validationError">* This field is required! </span>`);
        }
        if (location == "none" || location == null) {
            var error = true;
            $("#existingform #location-list").closest(".form-group").append(
                `<span class="validationError">* This field is required! </span>`);
        }
        if (account == "" || account == null) {
            var error = true;
            $("#existingform #account-list").closest(".form-group").append(
                `<span class="validationError">* This field is required! </span>`);
        }
        if (ovhservernameexist == "" || ovhservernameexist == null) {
            var error = true;
            $("#existingform .ovhservernameexist").closest(".form-group").append(
                `<span class="validationError">* This field is required! </span>`);
        }
        if (ovhCustomHostName == "" || ovhCustomHostName == null) {
            var error = true;
            $("#existingform .ovhCustomHostName").closest(".form-group").append(
                `<span class="validationError">* This field is required! </span>`);
        }
        return error;
    } else {

        let useridexist = $("#newform .userselectew").val();
        let product = $("#newform #product-list").val();
        let payment = $("#newform #payment-list").val();
        let billing = $("#newform #billing-list").val();
        let location = $("#newform #location-list").val();
        let account = $("#newform #account-listnew").val();
        let validate_servernew = $("#newform .validate_servernew").val();
        let validate_server = $("#newform .validate_server").val();
        var error = false;
        $(".validationError").remove();

        if (useridexist == "" || useridexist == null) {
            var error = true;
            $("#newform .userselectew").closest(".form-group").append(
                `<span class="validationError">* This field is required! </span>`);
        }
        if (product == "" || product == null) {
            var error = true;
            $("#newform #product-list").closest(".form-group").append(
                `<span class="validationError">* This field is required! </span>`);
        }
        if (payment == "" || payment == null) {
            var error = true;
            $("#newform #payment-list").closest(".form-group").append(
                `<span class="validationError">* This field is required! </span>`);
        }
        if (billing == "" || billing == null) {
            var error = true;
            $("#newform #billing-list").closest(".form-group").append(
                `<span class="validationError">* This field is required! </span>`);
        }
        if (location == "" || location == null) {
            var error = true;
            $("#newform #location-list").closest(".form-group").append(
                `<span class="validationError">* This field is required! </span>`);
        }
        if (account == "" || account == null) {
            var error = true;
            $("#newform #account-listnew").closest(".form-group").append(
                `<span class="validationError">* This field is required! </span>`);
        }
        if (validate_servernew == "" || validate_servernew == null) {
            var error = true;
            $("#newform .validate_servernew").closest(".form-group").append(
                `<span class="validationError">* This field is required! </span>`);
        }
        if (validate_server == "" || validate_server == null) {
            var error = true;
            $("#newform .validate_server").closest(".form-group").append(
                `<span class="validationError">* This field is required! </span>`);
        }

        return error;

    }
}



const getorderStatus = () => {
    $("#ordersTable tr").each(async function (index, value) {
        try {
            if ($(this).data("orderid")) {
                let orderId = $(this).data("orderid");
                let serviceId = $(this).data("serviceid");

                $(this).find("#orderStatus").html(`<i class="fa fa-spinner fa-spin"></i>`);
                let result = await secureCall({ orderStatus: true, orderId, serviceId }, 'POST');

                let response = JSON.parse(result);
                if (response.httpcode == 200) {
                    // string.charAt(0).toUpperCase() + string.slice(1);
                    let message = response.result.charAt(0).toUpperCase() + response.result.slice(1);
                    $(this).find("#orderStatus").html(`${message}`);
                } else {
                    let message = response.result.message.charAt(0).toUpperCase() + response.result.message.slice(1);
                    $(this).find("#orderStatus").html(`${message}`);
                }
            }
        } catch (error) {
            console.error(error);
            jQuery.growl.notice({ title: "Error", message: error, duration: 5000 });
        }
    })
}
const getServerDetails = () => {
    $("#serverStaus tbody tr").each(async function (index, value) {
        try {
            let serverName = $(this).data("servername");
            let serviceId = $(this).data("serviceid");
            let serverType = $(this).data("servertype");

            $(this).find("#orderStatus").html(`<i class="fa fa-spinner fa-spin"></i>`);
            let result = await secureCall({ orderStatus: true, serverName, serviceId, serverType }, 'POST');
            $(this).find("#orderStatus").html(`${result}`);
        } catch (error) {
            console.error(error);
            jQuery.growl.notice({ title: "Error", message: error, duration: 5000 });
        }
    })
}


const secureCall = (data = {}, method = "GET", url = '') => {

    return new Promise(function (resolve, reject) {
        $.ajax({
            url: url,
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

const ovhsubsidiarytype = async () => {
    $("#ovhsubsidiarytype").html(`<option value="" class="waitingmsg" disabled selected> loading..</option>`);
    var account = $("#inputModule").val();
    var moduletype = $(".type.active").data("producttype");

    let result = await secureCall({ subsidiarytype: "getSubsidiaryType", account: account, moduletype: moduletype }, 'POST');

    $("#ovhsubsidiarytype").html(result);
}

function getProductGroup(moduleName) {
    $("#inputovhgroup").html(`<option value="" class="waitingmsg" disabled selected> loading..</option>`);
    var locationtype = $(document).find("#ovhlocationtype").val();
    var account = $(document).find("#inputModule").val();
    $.ajax({
        url: window.location.href,
        type: "POST",
        data: { productgroup: "getproductgroup", account: account, locationtype: locationtype, modulename: moduleName },
        success: function (data) {
            $("#inputovhgroup").html(data);
            $("#ovhproducttypeloader").hide();
            $(".select-grpname").append(`<i class="fa fa-spinner fa-spin"></i>`);
        },
        complete: function (data) {
            getProducts();
            // $("#ovhproducttypeloader").hide();
        }
    });
}

function ovhlocationtype() {

    var account = $("#inputModule").val();
    $.ajax({
        url: window.location.href,
        type: "POST",
        data: { location: "getLocation", account: account },
        dataType: "json",
        success: function (data) {
            if ($.trim(data) == "Ovh") {
                $(".subsidiaryclass").show();
            } else if ($.trim(data) == 'Soyoustart') {
                $(".subsidiaryclass").hide();
            } else if ($.trim(data) == 'Kimsufi') {
                $(".subsidiaryclass").hide();
            }
        },
        complete: function (data) {
            var moduletype = $(".type.active").data("producttype");
            if (moduletype == "Dedicated") {
                var module = 'soyoustart';
            }
            else if (moduletype == "ECO") {
                var module = 'soyoustart_eco';
            }
            else {
                var module = 'soyoustart_vps';
            }
            getProductGroup(module);
        }
    });
}

const getProducts = async () => {
    $("#ovhproducthtml").html(`<i class="fa fa-spinner fa-spin"></i>`);

    $(".createProduct").prop("disabled", true);

    var ovhgroup = $(document).find("#inputovhgroup").val();

    var moduletype = $(".type.active").data("producttype");
    var locationurl = $(document).find("#ovhsubsidiarytype").val();

    if (moduletype == "Dedicated") {
        var module = 'soyoustart';
    } else if (moduletype == "VPS") {
        var module = 'soyoustart_vps';
    } else {
        var module = 'soyoustart_eco';
    }
    var locationtype = $(document).find("#ovhlocationtype").val();
    var account = $("#inputModule").val();
    var ovhsubsidiarytype = $(document).find("#ovhsubsidiarytype").val();
    if (ovhgroup) {
        $(".select-grpname").empty();
        var text = $("#" + ovhgroup).text();
        $("#ovhgroupnamewhmcs").val(text + ' Group');
    }
    if (typeof locationurl === "undefined" || typeof ovhsubsidiarytype === "undefined" || locationurl === null || ovhsubsidiarytype === null) {
        window.setTimeout(async () => getProducts(), 2000);
        return false;
    }

    $.ajax({
        url: window.location.href,
        method: "POST",
        data: { getproduct: "getproduct", 'locationurl': locationurl, "ovhsubsidiarytype": ovhsubsidiarytype, 'ovhgroupname': ovhgroup, 'locationtype': locationtype, 'modulename': module, 'account': account },
        dataType: "json",
        success: function (data) {
            $("#ovhproducts").find("i").remove();
            $("#ovhproducthtml").html(data);

            $(".createProduct").prop("disabled", false);

        }
    });
}


/* email template page start */
/* // disable selected templates  */
function disableSelected() {
    var selected = [];
    $('input:checked').each(function () {
        if ($(this).val() != "on") {
            selected.push($(this).val());
        }
    });
    $("#disable").html("wait..")
    $.ajax({
        url: window.location.href,
        type: "POST",
        data: { manageEmailTemplate: "manageEmailTemplate", templateID: selected },
        dataType: "json",
        beforeSend() {
            $("#disable").html(`Disabling <i class="fas fa-sync fa-spin"></i>`);
        },
        success: function (data) {
            if (data == "success") {
                $(".message").replaceWith('<div class="alert alert-success">Selected email template has been disabled successfully!</div>');
                window.setTimeout(function () { location.reload() }, 3000);
                $("#disable").html("Disable");
            } else {
                $(".message").replaceWith('<div class="alert alert-danger">Please select atleast one email template!</div>');
                // window.setTimeout(function () { location.reload() }, 3000);
                $("#disable").html("Disable");
            }
        },
        complete: function (data) {
            window.setTimeout(function () {
                $("#disable").html(`Disable`);
            }, 1000);
        },
    });
}

/*  disable single email template */
function disableTemplate(obj, id) {
    $.ajax({
        url: window.location.href,
        type: "POST",
        data: { disableTemplate: "disableEmailTemplate", templateID: id },
        dataType: "json",
        beforeSend() {
            $(obj).css("display", "none");
            $(obj).closest('td').append(`<i class="fas fa-sync fa-spin"></i>`);
        },
        success: function (data) {
            $(".message").replaceWith('<div class="alert alert-success">Template has been disabled successfully!</div>');
            window.setTimeout(function () { location.reload() }, 1000);
        },
        complete: function (data) {
            window.setTimeout(function () {
                $(obj).css("display", "block");
                $(obj).closest('td').find("i").remove();
            }, 1000);

        }
    });
}

//enable single email template
function enableTemplate(obj, id) {
    $.ajax({
        url: window.location.href,
        type: "POST",
        data: { enableTemplate: "enableEmailTemplate", templateID: id },
        dataType: "json",
        beforeSend() {
            $(obj).css("display", "none");
            $(obj).closest('td').append(`<i class="fas fa-sync fa-spin"></i>`);
        },
        success: function (data) {
            $(".message").replaceWith('<div class="alert alert-success">Template has been enabled successfully!</div>');
            window.setTimeout(function () { location.reload() }, 1000);
        },
        complete: function (data) {
            window.setTimeout(function () {
                $(obj).css("display", "block");
                $(obj).closest('td').find("i").remove();
            }, 1000);
        }
    });
}

/* email template page end */