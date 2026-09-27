
$(document).ready(function () {
    localStorage.removeItem('ip');
    $.get("https://ipinfo.io", (response) => {
        var ip = response.ip;
        localStorage.setItem('ip', ip);
    }, "jsonp");

    var dataTableObj = null;

    $(document).on("click", ".getIpInfo", async function (event) {
        try {
            let ip = $(this).data("ip");
            if ($(this).hasClass("active")) {
                $(this).removeClass("active").find(".ipDetails").slideUp();
            } else {
                $(".accordion-list li.active .ipDetails").slideUp();
                $(".accordion-list li.active").removeClass("active");
                $(this).addClass("active").find(".ipDetails").slideDown();
                $(this).find('.ipDetails').html(`<i class="fa fa-spinner fa-spin"></i>`);
                let result = await secureCall({ manage_ips: true, getIpDetails: true, ip }, 'POST');
                $(this).find('.ipDetails').html(result);
            }
            event.stopPropagation();
        } catch (error) {
            console.error(error);
            jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
        }
    });

    $(document).on("click", "#clientAreaIpmang", function (e) {
        e.stopPropagation();
    })
    $(document).on("click", ".getFtpIpDetails .card-body", function (e) {
        e.stopPropagation();
    })
    $(document).on("click", "#clientAreaIpmang .credit-card", function (e) {
        e.stopPropagation();
    })

    $('.mrtg').on('change', async function () {
        let mrtg01 = $('#mrtg1').val();
        let mrtg02 = $('#mrtg2').val();
        let period = $('#mrtg3').val();
        let type = mrtg01 + ":" + mrtg02
        $('#graphdivmain i').remove();
        $('#graphdivmain').append(`<i class="fa fa-spinner fa-spin"></i>`);
        $('#containerGraph').remove();
        try {
            let result = await secureCall({ graph: "mrtggraph", period, type }, 'POST');
            $('#graphdivmain i').remove();
            $("#mrtggraphdiv").append(`<div id="containerGraph" style="min-width: 310px; width:100%; height: 400px;"></div>`);
            let data = JSON.parse(result);
            mtrGraph(data, capitalizeFirstLetter(mrtg02));
        } catch (error) {
            console.error(error);
            jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
        }
    });


    /*  new design js*/
    $(".Access-cards-wrapper #detail .subTab a").on("click", async function () {
        $(".Access-cards-wrapper #detail .subTab li").removeClass("active");
        $(this).parent("li").addClass("active");
        let tabContentContainer = $(this).closest("div").find(".tab-content");
        tabContentContainer.children().removeClass("in active show");
        let selected = $(this).attr("href");
        tabContentContainer.find(selected).addClass("in active show");

    })
    $(".Access-cards-wrapper #power .subTab a").on("click", async function () {
        $(".Access-cards-wrapper #power .subTab li").removeClass("active");
        $(this).parent("li").addClass("active");
        let tabContentContainer = $(this).closest("div").find(".tab-content");
        tabContentContainer.children().removeClass("in active show");
        let selected = $(this).attr("href");
        tabContentContainer.find(selected).addClass("in active show");
    })
    $(".Access-cards-wrapper #impi .subTab a").on("click", async function () {
        $(".Access-cards-wrapper #impi .subTab li").removeClass("active");
        $(this).parent("li").addClass("active");
        let tabContentContainer = $(this).closest("div").find(".tab-content");
        tabContentContainer.children().removeClass("in active show");
        let selected = $(this).attr("href");
        tabContentContainer.find(selected).addClass("in active show");
    })
    $(".Access-cards-wrapper #netBoot a").on("click", async function () {
        $(".Access-cards-wrapper #netBoot li").removeClass("active");
        $(this).parent("li").addClass("active");
        let tabContentContainer = $(this).closest("div").find(".tab-content");
        tabContentContainer.children().removeClass("in active show");
        let selected = $(this).attr("href");
        tabContentContainer.find(selected).addClass("in active show");
    })
    $(".Access-cards-wrapper .mainTab a").on("click", async function () {
        $(".Access-cards-wrapper .mainTab li").removeClass("active");
        $(this).parent("li").addClass("active");
        let tab_menu = $(this).data("menuname");
        $(".Access-cards-wrapper .tab-content:first").children().each(function (index) {
            $(this).removeClass("in active show");
        });
        $(`#${tab_menu}`).addClass("in active show");


        if (tab_menu == "usage") {
            try {
                $('#graphdivmain i').remove();
                $('#graphdivmain').append(`<i class="fa fa-spinner fa-spin"></i>`);
                $('#containerGraph').remove();

                let result = await secureCall({ graph: "mrtggraph" }, 'POST');
                $('#graphdivmain i').remove();
                $("#mrtggraphdiv").append(`<div id="containerGraph" style="min-width: 310px; width:100%; height: 400px;"></div>`);
                let data = JSON.parse(result);
                mtrGraph(data);
            } catch (error) {
                console.error(error)
                jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
            }
        }
        else if (tab_menu == "interventions") {
            try {
                $('#interventions i').remove();
                $('#interventions').html(`<i class="fa fa-spinner fa-spin"></i>`);
                let result = await secureCall({ intervention: "intervention" }, 'POST');
                $('#interventions').html(result);
            } catch (error) {
                console.error(error);
                jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
            }
        }
        else if (tab_menu == "ftp_backup") {
            try {
                $('#ftp_backup i').remove();
                $('#ftp_backup').html(`<i class="fa fa-spinner fa-spin"></i>`);
                let result = await secureCall({ ftp_backup: "ftp_backup" }, 'POST');
                $('#ftp_backup').html(result);
                let width = $('.progress-done').data('done') + '%';
                $('.progress-done').css({ "width": width, "opacity": "1" });
            } catch (error) {
                console.error(error);
                jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
            }
        }
        else if (tab_menu == "manage_ips") {
            try {
                $('#manage_ips').html(`<i class="fa fa-spinner fa-spin"></i>`);
                let result = await secureCall({ manage_ips: "manage_ips" }, 'POST');
                $('#manage_ips').html(result);
                $('.accordion-list > li > .ipDetails').hide();
                $("#manage_ips .getIpInfo.first").trigger("click");
            } catch (error) {
                console.error(error)
                jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
            }
        }
    })
    /* reboot */
    $(document).on("click", ".rebootBtn", async function () {
        let obj = this;
        let type = $("#power .parrentTab").find(".active").closest("div").data("type");
        Swal.fire({
            title: "Are you sure?",
            text: "You want to hard reboot!",
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
                    let result = await secureCall({ power: "power", boot: "hardreboot", type }, 'POST');
                    var response = JSON.parse(result)
                    $(obj).prop("disabled", false);
                    $(obj).find("i").remove();
                    if (response.httpcode != 200) {
                        jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                    } else {
                        jQuery.growl.notice({ title: "Success", message: "Reboot " + response.result.status, duration: 5000 });
                        getTaskStatus({ power: "power", boot: "hardrebootConf", taskID: response.result.taskId }, ".rebootBtn", false);
                    }

                } catch (error) {
                    console.error(error);
                    jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                }
            }
        });
    })

    /* netboot */

    $(document).on("change", "#netBootType", function () {
        let val = $("#netBootType").val();
        if (val == "hardDisk") {
            $("#netBoot .nav.nav-tabs").find('a[href="#hardDisk"]').trigger('click')
        } else {
            $("#netBoot .nav.nav-tabs").find('a[href="#network"]').trigger('click')
        }
    })


    $(document).on("click", ".netbootBtn", async function () {
        let type = $(this).parent("div").attr("id");
        let bootid;
        let rootdevice;
        if (type == "hardDisk") {
            bootid = 1;
            rootdevice = 'none';
        } else if (type == "rescue") {
            if ($("#rescuelist").val() == '') {
                $('#rescuelist').css("border", "1px solid red");
                $('#rescuelist').focus();
                return false;
            } else {
                $('#rescuelist').css("border", "1px solid #ced4da");
            }
            bootid = $("#rescuelist").val();
            rootdevice = 'none';
        } else if (type == "network") {
            if ($("#networklist").val() == '') {
                $('#networklist').css("border", "1px solid red");
                $('#networklist').focus();
                return false;
            } else {
                $('#networklist').css("border", "1px solid #ced4da");
            }
            if ($("#rootdevice").val() == '') {
                $('#rootdevice').focus();
                $('#rootdevice').css("border", "1px solid red");
                return false;
            } else {
                $('#rootdevice').css("border", "1px solid #ced4da");
            }
            bootid = $("#networklist").val();
            rootdevice = $("#rootdevice").val();
        }

        Swal.fire({
            title: "Are you sure?",
            text: "You want to reboot.",
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes",

        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    $(`#${type} .netbootBtn`).append(`<i class="fa fa-spinner fa-spin"></i>`);
                    $(`#${type} .netbootBtn`).prop("disabled", true);
                    let result = await secureCall({ power: "power", boot: "netBoot", bootid, rootdevice, type }, 'POST');
                    var response = JSON.parse(result)
                    if (response.httpcode != 200) {
                        jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                    } else {
                        jQuery.growl.notice({ title: "Success", message: "Booted successfully!", duration: 5000 });
                    }
                    $(`#${type} .netbootBtn`).find("i").remove();
                    $(`#${type} .netbootBtn`).prop("disabled", false);

                } catch (error) {
                    console.error(error);
                    jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                }
            }
        });
    });


    /* re-install */

    $(document).on("click", ".reInstall", async function () {
        let obj = this;
        Swal.fire({
            title: "Are you sure?",
            text: "You want to re-install the os.",
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
                    let templateName = ($("#inputState").val() == null ? $("#installOs .inputState").val() : $("#inputState").val());
                    console.log(templateName)
                    let result = await secureCall({ power: "power", boot: "re-install os", templateName }, 'POST');
                    var response = JSON.parse(result);
                    $(obj).prop("disabled", false);
                    $(obj).find("i").remove();
                    if (response.httpcode != 200) {
                        jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                    } else {
                        jQuery.growl.notice({ title: "Success", message: "OS installation has started successfully! This may take about 5-10 minutes Status(" + response.result.status + ")", duration: 5000 });
                        $(".progress.reinstall").css("display", "block");
                        $(".cancleReinstall").css("display", "block");
                        $("button.reInstall ").prop("disabled", true);
                        $("#inputState").attr("disabled", "disabled");
                        /* getting re-installation status */
                        setTimeout(() => getInstallationStatus(), 5000);
                    }

                } catch (error) {
                    console.error(error)
                    jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                }
            }
        })
    })

    /* cancle re-intallation */

    $(document).on("click", ".cancleReinstall", async function () {
        let obj = this;
        Swal.fire({
            title: "Are you sure?",
            text: "You want to cancle re-install.",
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
                    $(".reInstall").find("i").remove();
                    let result = await secureCall({ power: "power", type: "cancleReinstallation" }, 'POST');
                    var response = JSON.parse(result);
                    $(obj).prop("disabled", false);
                    $(obj).find("i").remove();
                    if (response.httpcode != 200) {
                        jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                    } else {
                        jQuery.growl.notice({ title: "Success", message: "OS Re-installation cancel in progress..!", duration: 5000 });
                        /* getting re-installation status */
                        setTimeout(() => getInstallationStatus(calculatePercentage = false), 5000);
                    }
                } catch (error) {
                    console.error(error);
                    jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                }
            }
        })
    })
    /* getting compatible os */
    $(document).on("click", ".installOsbtn", async function () {
        try {
            $("#installOs .reInstall").prop("disabled", true);
            $("#installOs").find("select").html(`<option value="" disabled selected> loading...</option>`);
            let installedOs = $("#osName").html();
            let result = await secureCall({ power: true, type: "reInstall", installedOs }, 'POST');
            let response = JSON.parse(result);

            if (response?.installationStatus) {
                if (response.installationStatus.httpcode == 200) {
                    $(".progress.reinstall").css("display", "block")
                    $(".cancleReinstall").css("display", "block")
                    $("#installOs #inputState").attr("disabled", "disabled");
                    let data = response.installationStatus.result.progress;
                    /* calulating percentage  */
                    calculateReinstallPercentage(data)
                    /* getting re-installation status */
                    setTimeout(() => getInstallationStatus(), 5000);
                } else {
                    $("#installOs .reInstall").prop("disabled", false);
                }
                $("#installOs").find("select").html(`${response.html}`);
            }
        } catch (error) {
            console.error(error);
            jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
        }
    })


    /* ftp  */

    $(document).on("click", ".enableACL", async function () {
        try {
            if ($("#ipBlock").val() == "") {
                $('#ipBlock').css("border", "1px solid red");
                $('#ipBlock').focus();
                return false;
            } else if (!$("#Cifs").is(':checked')) {
                $("#Cifs").parent().parent().find(".error").remove()
                $("#Cifs").closest("div").after('<span class="error"> This field is required </span>')
                return false;
            }
            else if (!$("#Nfs").is(':checked')) {
                $("#Nfs").parent().parent().find(".error").remove()
                $("#Nfs").closest("div").after('<span class="error"> This field is required </span>')
                return false;
            }
            let data = $("#ftpEnableForm").serialize();
            $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
            $(this).prop("disabled", true);
            let result = await secureCall({ ftp_backup: "ftp_backup", ftpAction: "enableACL", data }, 'POST');

            var response = JSON.parse(result)
            if (response.httpcode != 200) {
                jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                $(this).prop("disabled", false);
                $(this).find("i").remove();
            } else {
                jQuery.growl.notice({ title: "Success", message: response.result.comment + " Status(" + response.result.status + ")", duration: 5000 });
                getTaskStatus({ ftp_backup: "ftp_backup", ftpAction: "FTPBackupStaus", taskID: response.result.taskId, reloadTabClass: ".Access-cards-wrapper .mainTab a.active" }, ".enableACL", false);
            }
        } catch (error) {
            console.error(error);
            jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
        }
    })


    $(document).on("click", "#ftpbkup", async function () {
        try {
            $("#enableACLFtp #ftpEnableForm #inputState").html(`<option value="" disabled selected>loading...</option>`);
            $("#enableACLFtp #ftpEnableForm .enableACL").prop("disabled", true);

            let result = await secureCall({ ftp_backup: "ftp_backup", ftpAction: "getAuthorizableBlocks" }, 'POST');
            var response = JSON.parse(result)
            if (response.httpcode != 200) {
                jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
            } else {
                $("#enableACLFtp #ftpEnableForm #inputState").html(response.response);
                $("#enableACLFtp #ftpEnableForm .enableACL").prop("disabled", false);
                // jQuery.growl.notice({ title: "Success", message: response.result.comment + " Status(" + response.result.status + ")", duration: 5000 });
                // getTaskStatus({ ftp_backup: "ftp_backup", ftpAction: "FTPBackupStaus", taskID: response.result.taskId }, "#impi", false);
            }

        } catch (error) {
            console.error(error);
            jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
        }

    })


    $(document).on("click", ".getFtpIpDetails", async function (event) {
        try {
            let ip = $(this).data("ip");
            if ($(this).hasClass("active")) {
                $(this).removeClass("active").find(".ftpIpDetails").slideUp();
            } else {
                $(".accordion-list li.active .ftpIpDetails").slideUp();
                $(".accordion-list li.active").removeClass("active");
                $(this).addClass("active").find(".ftpIpDetails").slideDown();
                $(this).find('.ftpIpDetails').html(`<i class="fa fa-spinner fa-spin"></i>`);
                if ($(this).hasClass("active")) {
                    let result = await secureCall({ ftp_backup: "ftp_backup", ftpAction: "getIpBlockData", ip }, 'POST');
                    $(".ftpIpDetails").html(result);
                }
            }
            event.stopPropagation();
        } catch (error) {
            console.error(error);
            jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
        }
    });

    $(document).on("click", ".editFTP", function () {
        $('#editFTP').trigger("reset");
        let ftp = $(this).closest("tr").find(".ftp").data("ftp");
        let nfs = $(this).closest("tr").find(".nfs").data("nfs");
        let cifs = $(this).closest("tr").find(".cifs").data("cifs");
        let editFtpIpBlock = $(this).closest("tr").find(".ipBlock").data("ipblock");
        $("#editFTP #editFtpIpBlock").html(editFtpIpBlock);
        (ftp == "enabled" ? $("#editFTPForm  #FTP").prop('checked', true) : $("#editFTPForm  #FTP").prop('checked', false));
        (cifs == "enabled" ? $("#editFTPForm  #Cifs").prop('checked', true) : $("#editFTPForm  #Cifs").prop('checked', false));
        (nfs == "enabled" ? $("#editFTPForm  #Nfs").prop('checked', true) : $("#editFTPForm  #Nfs").prop('checked', false));
    })

    $(document).on("click", ".updateFTP", async function () {
        Swal.fire({
            title: "Are you sure?",
            text: "You want to update.",
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes",

        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    let ipBlock = $("#editFTPForm #editFtpIpBlock").html();
                    let data = $("#editFTPForm").serialize();
                    $(".updateFTP").append(`<i class="fa fa-spinner fa-spin"></i>`);
                    $(".updateFTP").prop("disabled", true);
                    let result = await secureCall({ ftp_backup: "ftp_backup", ftpAction: "updateFTPBackup", data, ipBlock }, 'POST');
                    var response = JSON.parse(result)
                    if (response.httpcode != 200) {
                        jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                    } else {
                        jQuery.growl.notice({ title: "Success", message: "Updated successfully!", duration: 5000 });
                        $("#editFTP").modal('hide');
                        $(".Access-cards-wrapper .mainTab a.active").trigger("click");
                    }
                } catch (error) {
                    console.error(error);
                    jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                } finally {
                    $(".updateFTP").prop("disabled", false);
                    $(".updateFTP").find("i").remove();
                }
            }
        })

    })

    $(document).on("click", ".deleteFTP", function () {
        let obj = this;
        let ipBlock = $(this).closest("tr").find(".ipBlock").data("ipblock");
        Swal.fire({
            title: "Are you sure?",
            text: "You want to delete.",
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes",
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    $(obj).closest("button").html(`<i class="fa fa-spinner fa-spin deleteFTP"></i>`);
                    let result = await secureCall({ ftp_backup: "ftp_backup", ftpAction: "deleteFTPBackupIPBlock", ipBlock }, 'POST');
                    var response = JSON.parse(result)
                    if (response.httpcode != 200) {
                        jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                    } else {
                        jQuery.growl.notice({ title: "Success", message: response.result.comment + " Status(" + response.result.status + ")", duration: 5000 });
                        getTaskStatus({ ftp_backup: "ftp_backup", ftpAction: "FTPBackupStaus", taskID: response.result.taskId, reloadTabClass: ".Access-cards-wrapper .mainTab a.active" }, "", false);
                    }
                } catch (error) {
                    console.error(error);
                    jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                }
            }
        })
    })


    /* IMPI Tab */

    $(document).on("click", ".getImpi", async function () {

        var type = $(this).data("type");
        var text = '';
        if (type == "rebootImpi") {
            text = "You want to reboot IPMI.";
        } else if (type == "browserImpi") {
            text = "You want to initiate console from browser.";
        } else if (type == "htmlImpi") {
            text = "You want to initiate html5 console.";
        } else if (type == "javaImpi") {
            text = "You want to initiate java applet(KVM) console.";
        }

        if (type == "rebootImpi") {
            Swal.fire({
                title: "Are you sure?",
                text: text,
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
                        let result = await secureCall({ impi: "impi", impiAction: "rebootImpi" }, 'POST');
                        var response = JSON.parse(result)
                        if (response.httpcode != 200) {
                            jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                        } else {
                            jQuery.growl.notice({ title: "Success", message: response.result.comment + " Status(" + response.result.status + ")", duration: 5000 });
                            getTaskStatus({ ftp_backup: "ftp_backup", ftpAction: "FTPBackupStaus", taskID: response.result.taskId }, this, false);
                        }
                    } catch (error) {
                        console.error(error);
                        jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                    }
                }
            })
        }
        else if (type == "browserImpi" || type == "htmlImpi" || type == "javaImpi") {
            Swal.fire({
                title: "Are you sure?",
                text: text,
                icon: "question",
                showCancelButton: true,
                confirmButtonColor: "#3085d6",
                cancelButtonColor: "#d33",
                confirmButtonText: "Yes",
            }).then(async (result) => {
                if (result.isConfirmed) {
                    try {
                        let ip = localStorage.getItem('ip');
                        $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
                        $(this).prop("disabled", true);
                        let result = await secureCall({ impi: "impi", impiAction: "openImpi", type, ip }, 'POST');
                        var response = JSON.parse(result)
                        if (response.httpcode != 200) {
                            jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                            $(this).find("i").remove();
                            $(this).prop("disabled", false);
                        } else {
                            jQuery.growl.notice({ title: "Success", message: response.result.comment + " Status(" + response.result.status + ")", duration: 5000 });
                            getTaskStatus({ impi: "impi", impiAction: "impiTaskStaus", taskID: response.result.taskId, type }, "#impi", false);
                        }
                    } catch (error) {
                        console.error(error);
                        jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                    }
                }
            })
        }
    })


    $(document).on("click", ".impiTest", async function () {
        try {
            if ($("#ttl").val() == 'Select') {
                $('#ttl').focus();
                return false;
            } else if ($('#impiType').val() == "Select") {
                $('#impiType').focus();
                return false;
            }
            $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
            $(this).prop("disabled", true);

            let data = $("#impiTestForm").serialize();
            let result = await secureCall({ impi: "impi", impiAction: "testImpi", data }, 'POST');
            var response = JSON.parse(result)
            if (response.httpcode != 200) {
                jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                $(this).prop("disabled", false);
                $(this).find("i").remove();
            } else {
                jQuery.growl.notice({ title: "Success", message: response.result.comment + " Status(" + response.result.status + ")", duration: 5000 });
                getTaskStatus({ ftp_backup: "ftp_backup", ftpAction: "FTPBackupStaus", taskID: response.result.taskId }, ".impiTest", false);
            }
        } catch (error) {
            console.error(error);
            jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
        }
    })

    /* manage IPs tab */

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
                    let ip = $(this).closest('tr').data('ip');
                    $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
                    $(this).prop("disabled", true);
                    let result = await secureCall({ manage_ips: true, iPaction: "cretaeFirewall", ip }, 'POST');
                    var response = JSON.parse(result)
                    if (response.httpcode != 200) {
                        jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                    } else {
                        jQuery.growl.notice({ title: "Success", message: "Firewall created successfully Status (" + response.result.state + ")", duration: 5000 });
                        setTimeout(() => location.reload(), 2000)
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
                    let ip = $(this).closest('tr').data('ip');
                    $(".deleteFirewall").closest("button").html(`<i class="fa fa-spinner fa-spin deleteFirewall"></i>`);
                    $(".deleteFirewall").prop("disabled", true);
                    let result = await secureCall({ manage_ips: true, iPaction: "deleteFirewall", ip }, 'POST');
                    var response = JSON.parse(result)
                    if (response.httpcode != 200) {
                        jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                    } else {
                        jQuery.growl.notice({ title: "Success", message: "Firewall deleted successfully", duration: 5000 });
                        setTimeout(() => location.reload(), 2000)
                    }
                } catch (error) {
                    console.error(error);
                    jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                }
                finally {
                    $(".deleteFirewall").closest("button").html(`<i class="fas fa-trash-alt deleteFirewall"></i>`);
                    $(".createFiredeleteFirewallwall").prop("disabled", false);
                }
            }
        });
    });

    $(document).on("change", ".firewallEnableDisable", function (e) {
        e.stopPropagation();
        if ($(this).is(':checked')) {
            var checked = true;
            var actionType = "enable";
            var action = "Are you sure you want to enable firewall ?";
        } else {
            var checked = false;
            var actionType = "disable";
            var action = "Are you sure you want to disable firewall ?";
        }

        Swal.fire({
            title: "Are you sure?",
            text: action,
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes",
            allowOutsideClick: function (element, allowed) {
                (checked ? $(this).prop('checked', false) : $(this).prop('checked', true));
                return true;
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    let ip = $(this).closest('tr').data('ip');
                    $(this).closest("td").find(".switch").css("display", "none").after(`<i class="fa fa-spinner fa-spin"></i>`);
                    $("#firewallEnableDisable").prop("disabled", true);
                    let result = await secureCall({ manage_ips: true, iPaction: "enableDisableFirewall", ip, actionType }, 'POST');
                    let response = JSON.parse(result)
                    if (response.httpcode != 200) {
                        jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                        (checked ? $(this).prop('checked', false) : $(this).prop('checked', true));
                    } else {
                        jQuery.growl.notice({ title: "Success", message: `Firewall ${actionType} successfully!`, duration: 5000 });
                    }
                } catch (error) {
                    console.error(error);
                    jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                } finally {
                    $(this).closest("td").find(".switch").css("display", "block");
                    $(this).closest("td").find("i").remove();
                }
            } else {
                (checked ? $(this).prop('checked', false) : $(this).prop('checked', true));
            }
        });
    });

    $(document).on("click", ".ipAction", function (e) {
        e.stopPropagation();
        if ($("#clientAreaIpmang").hasClass(".ipActionLists.activeList")) {
            $("#clientAreaIpmang").find(".ipActionLists").css("display", "none");
            $("#clientAreaIpmang").find(".ipActionLists").removeClass("activeList");
            $(this).parent().parent().find(".ipActionLists").addClass("activeList");
            $(this).parent().parent().find(".ipActionLists.activeList").toggle(1000);
        } else {
            $("#clientAreaIpmang").find(".ipActionLists").removeClass("activeList");
            $(this).parent().parent().find(".ipActionLists").addClass("activeList");
            $(this).parent().parent().find(".ipActionLists.activeList").toggle(1000);
        }
    });

    $(document).on("click", "#clientAreaIpmang", function () {
        $(".ipActionLists").hide(500)
    });

    $(document).on("click", "#clientAreaIpmang .ipActionLists.activeList li", async function (e) {
        e.stopPropagation();
        $("#clientAreaIpmang .ipActionLists").find(".active").removeClass("active");
        $(this).addClass("active");
        let obj = this;
        let ipblock = $("#manage_ips .ipActionLists.activeList").data("ipblock");
        var ipblockarr = ipblock.split("/");
        if ($(this).data("target") == "#addReverseIp") {
            $("#addReverseIp #addIpReverseIPAddress").val(ipblockarr["0"]);
            let reverseDns = $(this).closest("tr").find(".reverseDns").html();
            if (reverseDns != "Not Configured") {
                $("#addReverseIp #addIpReverse").val(reverseDns);
            }
        }
        else if($(this).data("target") == "#addReverseIp6"){
            $("#addReverseIp6 #addIpReverseIP6Address").val(ipblock);

        }
        else if ($(this).data("target") == "#getFirewallRules") {

            $("#getFirewallRules .firewallName").text(ipblockarr["0"])
            $("#getFirewallRulesTable").dataTable().fnDestroy();

            dataTableObj = $("#getFirewallRulesTable").DataTable({
                responsive: true,
                "ajax": {
                    "url": "",
                    "data": { manage_ips: true, iPaction: "getFirewallRules", ipblock },
                    "dataSrc": "data"
                },
                columns: [
                    { "data": 'sequence' },
                    { "data": 'action' },
                    { "data": 'protocol' },
                    { "data": 'destination' },
                    { "data": 'sourcePort' },
                    { "data": 'destinationPort' },
                    { "data": 'tcpOption' },
                    { "data": 'state' },
                    { "data": 'delete' }
                ]
            });
        }

        else if ($(this).data("mitigration")) {
            let mitigrationIp = $(this).data("mitigrationip");

            let message = '';
            let title = '';
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
                        let result = await secureCall({ manage_ips: true, iPaction: "mitigration", ipblock, mitigrationIp }, 'POST');
                        let response = JSON.parse(result)
                        $(obj).prop("disabled", false);
                        $(obj).find("i").remove();
                        if (response.httpcode != 200) {
                            jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                            $(obj).css({ "cursor": "pointer", "color": "#212529" });
                        } else {
                            jQuery.growl.notice({ title: "Success", message: "Updated successfully!", duration: 5000 });
                            $(obj).css({ "cursor": "pointer", "color": "#212529" });
                            setTimeout(() => {
                                $(".Access-cards-wrapper .mainTab a.active").trigger("click");
                            }, 3000)
                        }
                    } catch (error) {
                        console.error(error);
                        jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                    }
                }
            })
        }
        else {
            $("#addIpDescriptionsForm #addIpDesc").val('')
            let desc = $(this).data("desc");
            $("#addIpDescriptionsForm #addIpDesc").val(desc)
            if (desc != "") {
                $("#addIpDescriptionsTitle").text("Edit IP Description")
            } else {
                $("#addIpDescriptionsTitle").text("Add IP Description")
            }
        }
    });

    /* validating ip */

    $(document).on("click", "#addReverseIp6 .updateIP6Reverse", async function(){
        
        try {
            let ip = $("#addReverseIp6 #ipAddress6").val();
            let ipblock = $("#manage_ips .ipActionLists.activeList").data("ipblock");
            let reverseDNS = $("#addReverseIp6 #addIp6Reverse").val();
            if(ip == ''){
                $("#addReverseIp6 #ipAddress6").css("border", "1px solid red");;
                $("#addReverseIp6 #ipAddress6").focus();
                return false;
            }else{
                $("#addReverseIp6 #ipAddress6").css("border", "1px solid #ced4da")
            }
            if (reverseDNS == "") {
                $("#addReverseIp6 #addIp6Reverse").css("border", "1px solid red");;
                $("#addReverseIp6 #addIp6Reverse").focus();
                return false;
            }else{
                $("#addReverseIp6 #addIp6Reverse").css("border", "1px solid #ced4da")
            }
            $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
            $(this).prop("disabled", true);

            let result = await secureCall({ manage_ips: true, iPaction: "updateIP6Reverse", ip, ipblock, reverseDNS }, 'POST');
            var response = JSON.parse(result)
            if (response.httpcode != 200) {
                jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                $(this).find("i").remove();
                $(this).prop("disabled", false);
            } else {
                jQuery.growl.notice({ title: "Success", message: "Reverse DNS has been updated successfully!", duration: 5000 });
            }
        } catch (error) {
            console.error(error)
            jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
        }

    })


    $(document).on("click", "#getFirewallRules button.showModal", function () {
        $("#firewaAddllRules").toggle(1000)
    })

    /* updating/adding IP desc */
    $(document).on("click", "#addIpDescriptionsForm .updateIPDesc", async function (e) {
        try {
            $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
            $(this).prop("disabled", true);
            let desc = $("#addIpDescriptionsForm #addIpDesc").val();
            let ipblock = $("#manage_ips .ipActionLists.activeList").data("ipblock");
            let result = await secureCall({ manage_ips: true, iPaction: "addDesc", desc, ipblock }, 'POST');
            var response = JSON.parse(result)
            if (response.httpcode != 200) {
                jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
            } else {
                jQuery.growl.notice({ title: "Success", message: "IP description has been updated successfully!", duration: 5000 });
                setTimeout(() => {
                    $("#addIpDescriptions").modal('hide');
                    $(".Access-cards-wrapper .mainTab a.active").trigger("click");
                }, 2000)
            }
        } catch (error) {
            console.error(error);
            jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
        } finally {
            $(this).find("i").remove();
            $(this).prop("disabled", false);
        }
    });

    $(document).on("click", "#addReverseIp .updateIPReverse", async function () {
        try {
            let ipblock = $("#manage_ips .ipActionLists.activeList").data("ipblock");
            let reverseIp = $("#addReverseIp #addIpReverse").val();
            if (reverseIp == "") {
                $("#addReverseIp #addIpReverse").css("border", "1px solid red");;
                $("#addReverseIp #addIpReverse").focus();
                return false;
            }

            $(this).append(`<i class="fa fa-spinner fa-spin"></i>`);
            $(this).prop("disabled", true);
            let result = await secureCall({ manage_ips: true, iPaction: "addReverseIp", ipblock, reverseIp }, 'POST');
            var response = JSON.parse(result)
            if (response.httpcode != 200) {
                jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                $(this).find("i").remove();
                $(this).prop("disabled", false);
            } else {
                jQuery.growl.notice({ title: "Success", message: "Reverse DNS has been updated successfully!", duration: 5000 });
            }
        } catch (error) {
            console.error(error)
            jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
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

                    let ipblock = $("#manage_ips .ipActionLists.activeList").data("ipblock");
                    let data = $("#getFirewallRulesForm").serialize();
                    let result = await secureCall({ manage_ips: true, iPaction: "addFirewallRule", data, ipblock }, 'POST');
                    var response = JSON.parse(result)
                    if (response.httpcode != 200) {
                        jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                    } else {
                        jQuery.growl.notice({ title: "Success", message: "Firewall rules has been added successfully!", duration: 5000 });
                        dataTableObj.ajax.reload(null, true);
                    }
                } catch (error) {
                    console.error(error);
                    jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                } finally {
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
                    let ipblock = $("#manage_ips .ipActionLists.activeList").data("ipblock");
                    let result = await secureCall({ manage_ips: true, iPaction: "deleteFirewallRule", sequese, ipblock }, 'POST');
                    var response = JSON.parse(result)
                    $(obj).find("i").remove();
                    $(obj).prop("disabled", false);
                    if (response.httpcode != 200) {
                        jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                        $(obj).removeClass(`fa fa-spinner fa-spin`);
                        $(obj).addClass(`fas fa-trash-alt deleteFirewallRule`);
                        $(obj).prop("disabled", false);
                    } else {
                        jQuery.growl.notice({ title: "Success", message: "Firewall rules has been deleted successfully!", duration: 5000 });
                        dataTableObj.ajax.reload(null, true);
                    }
                } catch (error) {
                    console.error(error)
                    jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                }
            }
        })
    })

    $(document).on("change", "#getFirewallRules #firewallProtocol", function () {
        let protocol = $(this).val();
        if (protocol == "tcp") {
            $("#getFirewallRules").find(".onlyWithTCP").css("display", "flex");
        } else {
            $("#getFirewallRules").find(".onlyWithTCP").css("display", "none");
        }
    })


    $(document).on("change", "#additionalIp", function () {
        let numberOfIp = $(this).val();
        let perIpPrice = $(this).data("peripprice");
        if (numberOfIp < 1) {
            $(this).css("border", "1px solid red");
            $("#additinalIpModalCenter .addAdditionalIp").prop("disabled", true);
            $(this).focus();
            return false;
        } else {
            $(this).css("border", "1px solid #ced4da")
            $("#additinalIpModalCenter .addAdditionalIp").prop("disabled", false);
        }
        $("#noOfIps").html(`${numberOfIp}`)
        $("#ipPrices").html(`${perIpPrice * numberOfIp}`)
    });


    $(document).on("click", "#additinalIpModalCenter .addAdditionalIp", async function () {
        let obj = this;
        let numberOfIp = $("#additionalIp").val();

        Swal.fire({
            title: "Are you sure?",
            text: "You want to add additional ip.",
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
                    let result = await secureCall({ manage_ips: true, iPaction: "addAdditionalIp", numberOfIp }, 'POST');
                    var response = JSON.parse(result)
                } catch (error) {
                    console.error(error)
                    jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
                }
            }
        })
    })

    /* view ip details */

    $(document).on("click", "#clientAreaIpmang .viewIpDetails", async function () {

        let ipblock = $(this).closest("tr").data("ip");
        $("#viewIpDetailsIpBlock").html(ipblock);
        $("#viewIpDetailsForm .modal-body .mainSec").find("i").remove();
        $("#viewIpDetailsForm .modal-body .mainSec").html(`<i class="fa fa-spinner fa-spin"></i>`);
        let result = await secureCall({ manage_ips: true, iPaction: "viewIpDetails", ipblock }, 'POST');
        $("#viewIpDetailsForm .modal-body .mainSec").html(result)

    })
    /* monitoring*/

    $(document).on("click", ".monitoring-custom-inner", function () {
        $("#monitoring .monitoring-custom").find(".active").removeClass("active");
        $(this).addClass("active");
    })

});


// function debounce(func, timeout = 3000){
//     let timer;
//     return (...args) => {
//       clearTimeout(timer);
//       timer = setTimeout(() => { func.apply(this, args); }, timeout);
//     };
//   }
//   function saveInput(obj){
//     console.log('Saving data', $(obj).html());
//   }
//   const processChange  = (obj) => debounce(() => saveInput(obj));



const capitalizeFirstLetter = (str) => {
    return str.charAt(0).toUpperCase() + str.slice(1);
}


const reBootServer = async () => {
    Swal.fire({
        title: "Are you sure?",
        text: "You want to reboot server!",
        icon: "question",
        showCancelButton: true,
        confirmButtonColor: "#3085d6",
        cancelButtonColor: "#d33",
        confirmButtonText: "Yes",
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                $(".client-btns.c-reset-btn").find(".rebootBtnLoader").remove();
                $(".client-btns.c-reset-btn").append(`<div class="rebootBtnLoader"><i class="fa fa-spinner fa-spin"></i></div>`);
                $(".client-btns.c-reset-btn").css({ 'pointer-events': 'none' });
                let result = await secureCall({ power: "power", boot: "hardreboot", type: "reboot" }, 'POST');
                var response = JSON.parse(result)
                if (response.httpcode != 200) {
                    jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                    $(this).prop("disabled", false);
                    $(this).find("i").remove();
                } else {
                    jQuery.growl.notice({ title: "Success", message: "Reboot " + response.result.status, duration: 5000 });
                    getTaskStatus({ power: "power", boot: "hardrebootConf", taskID: response.result.taskId }, ".client-btns.c-reset-btn", false);
                }
            } catch (error) {
                console.error(error)
                jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
            }
        }
    })
}

const getTaskStatus = async (data = {}, selector, reload = true) => {
    try {
        let result = await secureCall(data, 'POST');
        let taskStatus = JSON.parse(result)
        if (taskStatus.httpcode != 200) {
            jQuery.growl.error({ title: "Error", message: taskStatus.result.message, duration: 5000 });
        } else if (data.hasOwnProperty("type")) {
            if (taskStatus.result.hasOwnProperty("status") && taskStatus.result.status != "done") {
                jQuery.growl.notice({ title: "Success", message: taskStatus.result.comment + " Status(" + taskStatus.result.status + ")", duration: 5000 });
                window.setTimeout(async () => getTaskStatus(data, selector), 10000);
            } else {
                let message = "";
                if (data.type == "javaImpi") {
                    message = "Downloading the file(kvm.jnlp)";
                } else if (data.type == "htmlImpi") {
                    message = "IPMI connection is available, redirecting...";
                } else if (data.type == "browserImpi") {
                    message = "IPMI connection is available, redirecting...";
                } else if (data.type == "rebootImpi") {
                    message = "IPMI has been rebooted successfully!";
                } else if (data.type == "impiTest") {
                    message = "IPMI tested successfully!";
                }
                jQuery.growl.notice({ title: "Success", message: message, duration: 5000 });

                $(selector).find(".tab-pane.fade.active.show button").prop("disabled", false);
                $(selector).find("i").remove();
                $("#testImpi").modal('hide');
                if (data.type == "javaImpi") {
                    download("kvm.jnlp", taskStatus.result.value)
                }
                else {
                    console.log(taskStatus)
                    setTimeout(() => window.open(taskStatus.result.value), 3000);
                }
            }
        } else {
            if (taskStatus.result.status == "done" && taskStatus.result.function == "changePasswordBackupFTP") {
                jQuery.growl.notice({ title: "Success", message: "Password has been changed Status(" + taskStatus.result.status + ")", duration: 5000 });
            } else {
                jQuery.growl.notice({ title: "Success", message: taskStatus.result.comment + " Status(" + taskStatus.result.status + ")", duration: 5000 });
            }

            if (taskStatus.result.status != "done") {
                window.setTimeout(async () => getTaskStatus(data, selector), 10000);
            } else {
                $(selector).prop("disabled", false);
                $(selector).find("i").remove();
                $("#testImpi").modal('hide');

                $(selector).css({ 'pointer-events': 'auto' });
                $(selector).find(".rebootBtnLoader").remove();
                /* reloading a specific tab */
                if (data.hasOwnProperty("reloadTabClass")) {
                    $("#enableACLFtp").modal('hide');
                    $(data.reloadTabClass).trigger("click");
                    return false;
                }
            }
        }
    } catch (error) {
        console.error(error);
        jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
    }
}

function download(filename, text) {
    var element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}

const deleteFTPBackup = async () => {
    try {
        Swal.fire({
            title: "Are you sure?",
            text: "You want to delete.",
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes",
        }).then(async (result) => {
            if (result.isConfirmed) {
                $("#deleteBkup").append(`<i class="fa fa-spinner fa-spin"></i>`);
                $("#deleteBkup").prop("disabled", true);
                let result = await secureCall({ ftp_backup: "ftp_backup", ftpAction: "deleteFTPBackup" }, 'POST');
                var response = JSON.parse(result)
                if (response.httpcode != 200) {
                    jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                    $("#deleteBkup").prop("disabled", false);
                    $("#deleteBkup").find("i").remove();
                } else {
                    jQuery.growl.notice({ title: "Success", message: response.result.comment + " Status(" + response.result.status + ")", duration: 5000 });
                    getTaskStatus({ ftp_backup: "ftp_backup", ftpAction: "FTPBackupStaus", taskID: response.result.taskId, reloadTabClass: ".Access-cards-wrapper .mainTab a.active" }, "#deleteBkup", false);
                }
            }
        })
    } catch (error) {
        console.error(error);
        jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
    }
}
const changepass = async () => {
    try {
        Swal.fire({
            title: "Are you sure?",
            text: "You want to change the FTP password.",
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Yes",
            footer: '<span style="color: red;font-size: 14px;font-weight: 600;">Note: Change FTP password could take some time and you will get it on your email address.</span>',

        }).then(async (result) => {
            if (result.isConfirmed) {
                $("#changeFtppass").append(`<i class="fa fa-spinner fa-spin"></i>`);
                $("#changeFtppass").prop("disabled", true);
                let result = await secureCall({ ftp_backup: "ftp_backup", ftpAction: "changeFtppass" }, 'POST');
                var response = JSON.parse(result)
                if (response.httpcode != 200) {
                    jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                    $("#changeFtppass").prop("disabled", false);
                    $("#changeFtppass").find("i").remove();
                } else {
                    jQuery.growl.notice({ title: "Success", message: response.result.comment + " Status(" + response.result.status + ")", duration: 5000 });
                    getTaskStatus({ ftp_backup: "ftp_backup", ftpAction: "FTPBackupStaus", taskID: response.result.taskId }, "#changeFtppass", false);
                }
            }
        })

    } catch (error) {
        console.error(error);
        jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
    }
}
const enableFTPBackup = async () => {
    try {
        $("#enableFTPBackup").append(`<i class="fa fa-spinner fa-spin"></i>`);
        $("#enableFTPBackup").prop("disabled", true);
        let result = await secureCall({ ftp_backup: "ftp_backup", ftpAction: "enableFTPBackup" }, 'POST');
        var response = JSON.parse(result)
        if (response.httpcode != 200) {
            jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
            $("#enableFTPBackup").prop("disabled", false);
            $("#enableFTPBackup").find("i").remove();
        } else {
            jQuery.growl.notice({ title: "Success", message: response.result.comment + " Status(" + response.result.status + ")", duration: 5000 });
            getTaskStatus({ ftp_backup: "ftp_backup", ftpAction: "FTPBackupStaus", taskID: response.result.taskId, reloadTabClass: ".Access-cards-wrapper .mainTab a.active" }, "#enableFTPBackup", false);
        }
    } catch (error) {
        console.error(error);
        jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
    }
}

const enableDisablMonitoring = async () => {
    let event = '';
    let message = '';
    let action = $("#monitoring .monitoring-custom-inner.active").data("action");
    if (action == "disable") {
        event = "You want to disable monitoring";
        message = "Monitoring disable successfully!";
    } else if (action == "EnableWithProactive") {
        event = "You want to enable monitoring with proactive intervention";
        message = "Monitoring with proactive intervention enable successfully!"
    } else if (action == "EnableWithoutProactive") {
        event = "You want to enable monitoring Without active intervention";
        message = "Monitoring Without proactive intervention enable successfully!"
    }

    Swal.fire({
        title: "Are you sure?",
        text: event,
        icon: "question",
        showCancelButton: true,
        confirmButtonColor: "#3085d6",
        cancelButtonColor: "#d33",
        confirmButtonText: "Yes",
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                $("#monitoring").find("button").append(`<i class="fa fa-spinner fa-spin"></i>`);
                $("#monitoring").find("button").prop("disabled", true);
                let result = await secureCall({ monitoring: "monitoring", monitoringAction: action }, 'POST');
                var response = JSON.parse(result)
                if (response.httpcode != 200) {
                    jQuery.growl.error({ title: "Error", message: response.result.message, duration: 5000 });
                } else {
                    jQuery.growl.notice({ title: "Success", message: message, duration: 5000 });
                }
                $("#monitoring").find("i").remove();
                $("#monitoring").find("button").prop("disabled", false);
                setTimeout(() => location.reload(), 3000)

            } catch (error) {
                console.error(error)
                jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
            }
        }
    })
}

const getImpi = async (e) => {
    $("#impi .impi.parrentTab").removeClass("active");
    $(e).parent("li").addClass("active");
}

const mtrGraph = (data, type = "Download") => {
    $('#containerGraph').highcharts({
        chart: {
            zoomType: 'x'
        },
        title: {
            text: ''
        },
        subtitle: {
            text: ''
        },
        xAxis: {
            type: 'datetime',
            tickPixelInterval: 250,
            labels: {
                format: '{value:%e %b %Y %H:%M:%S}',
                rotation: -65,
                align: 'right'
            },
            tickInterval: 20 * 60 * 100
        },
        yAxis: {
            title: {
                text: 'Kb/s'
            },
            min: 0,
            tickInterval: 1
        },
        legend: {
            enabled: false
        },
        plotOptions: {
            area: {
                fillColor: {
                    linearGradient: {
                        x1: 0,
                        y1: 0,
                        x2: 0,
                        y2: 1
                    },
                    stops: [
                        [0, Highcharts.getOptions().colors[0]],
                        [1, Highcharts.getOptions().colors[0]]
                    ]
                },
                marker: {
                    radius: 2
                },
                lineWidth: 1,
                states: {
                    hover: {
                        lineWidth: 1
                    }
                },
                threshold: null
            }
        },
        series: [{
            type: 'area',
            name: type,
            data: data
        }]
    });
}


const getServerDetails = async (obj) => {
    let type = $(obj).data("type");
    $(".sub_box a").removeClass("active");
    $(obj).find("a").addClass("active");
    $('.serverDetailInfo').html(`<i class="fa fa-spinner fa-spin"></i>`);
    try {
        let result = await secureCall({ getServerDetails: type }, 'POST');
        $('.serverDetailInfo').html(result);
    } catch (error) {
        console.error(error)
        jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
    }
}

const getPowerDetails = (obj) => {
    let type = $(obj).data("type");
    let selector = "#" + type;
    let installedOs = $("#osName").html();
    if (!$(obj).hasClass("loaded")) {
        $(selector).find("button.btn-success").prop("disabled", true);
        $(selector).find("select").html(`<option value="" disabled selected> loading...</option>`);
        try {
            $.ajax({
                url: "",
                type: "POST",
                data: { power: true, type, installedOs },
                success: function (results) {
                    let result = JSON.parse(results);
                    $(selector).find("select").html(`${result.html}`);
                    if (result?.installationStatus) {
                        if (result.installationStatus.httpcode == 200) {
                            $(".progress.reinstall").css("display", "block")
                            $(".cancleReinstall").css("display", "block")
                            $("#inputState").attr("disabled", "disabled");
                            $(selector).find("button").prop("disabled", true);
                            $(".cancleReinstall").attr("disabled", false);
                            let data = result.installationStatus.result.progress;
                            /* calulating percentage  */
                            calculateReinstallPercentage(data)
                            /* getting re-installation status */
                            setTimeout(() => getInstallationStatus(), 5000);
                        } else {
                            $(selector).find("button").prop("disabled", false);
                            $("#inputState").attr("disabled", false);
                        }
                    } else {
                        $(selector).find("button").prop("disabled", false);
                    }
                    $(obj).addClass("loaded");
                }
            });
        } catch (error) {
            console.error(error)
            jQuery.growl.error({ title: "Error", message: error, duration: 5000 });
        }
    }
}


const calculateReinstallPercentage = (data = {}, clientarea = true) => {
    let completedTask = 0;
    let pendingTask = 0;
    const totalProgressItems = data.length;

    let html = '';

    data.forEach((step, index) => {
        html += `<tr><td>${step.comment}</td><td>${step.status}</td></tr>`;

        if (step.status == "done") {
            completedTask += 1;
        } else {
            pendingTask += 1;
        }
    });

    $("span.installatio_progress").remove()
    $("button.seeMore").remove()
    $(".progress.reinstall").after(`<span class="installatio_progress">Installation progress is running (${completedTask}/${completedTask + pendingTask})</span> <button type="button" class="btn btn-primary seeMore" onclick="jQuery('#installationDetails').fadeToggle(1000); jQuery('#installationDetail').fadeToggle(1000)"> See more details</button>`)

    $("#installationDetails tbody").html(`${html}`);
    $("#installationDetail tbody").html(`${html}`);


    const percentageDone = ((completedTask / totalProgressItems) * 100).toFixed(2);
    $('.progress-done').css('width', `${percentageDone}%`);
    $(".progress.reinstall").find("span").html(`${percentageDone}%`);
}

const getInstallationStatus = async (calculatePercentage = true) => {
    try {
        let results = await secureCall({ power: true, type: "getInstallationStatus" }, 'POST');
        let result = JSON.parse(results);
        if (result.httpcode == 200) {
            if (calculatePercentage) {
                calculateReinstallPercentage(result.result.progress);
            } else {
                jQuery.growl.notice({ title: "Success", message: "OS Re-installation cancel in progress...!", duration: 5000 });
            }
            /* getting re-installation status */
            setTimeout(() => getInstallationStatus(calculatePercentage), 5000);
        } else {
            $(".progress.reinstall").css("display", "none")
            $("button.reInstall ").prop("disabled", false);
            $("button.reInstall ").find("i").remove();
            if (calculatePercentage) {
                jQuery.growl.notice({ title: "Success", message: "OS Re-installation has been completed!", duration: 5000 });
            } else {
                jQuery.growl.notice({ title: "Success", message: "OS Re-installation has been cancelled successfully!", duration: 5000 });
            }
            setTimeout(() => location.reload(), 3000);
        }
    } catch (error) {
        console.error(error)
    }
}

/* copy to clipboard with tooltip */
function copyText() {
    var copyText = document.getElementById("myInput");
    copyText.type = 'text';
    copyText.select();
    copyText.setSelectionRange(0, 99999);
    document.execCommand("copy");
    var tooltip = document.getElementById("myTooltip");
    tooltip.innerHTML = "Copied: " + copyText.value;
    copyText.type = 'hidden';
}

function updateText() {
    var tooltip = document.getElementById("myTooltip");
    tooltip.innerHTML = "Copy to clipboard";
}

const secureCall = (data = {}, method = "GET") => {
    return new Promise(function (resolve, reject) {
        $.ajax({
            url: '',
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
