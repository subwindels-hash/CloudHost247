<div class="row">
    <div class="col-lg-12 col-sm-12">
        <div class="panel panel-default">
            <div class="panel-heading" style="margin-bottom: 1rem">
                <h4 class="panel-title">Graphs</h4>
                <div class="text-right">
                    <div class="form-inline" style="display: flex; justify-content: flex-end">
                        <div class="form-group">
                            <input type="hidden" class="form-control" name="startRangeDate" id="MGStartRangeDate"
                                   value="{$maxDateStart}">
                            <input type="text" class="form-control" name="startDate" id="MGStartDate"
                                   value="{$startDisplayDate}">
                        </div>
                        <div class="form-group" style="padding-left: 10px; padding-right: 10px; display: flex; justify-content: center; align-items: center;">
                            -
                        </div>
                        <div class="form-group">
                            <input type="hidden" class="form-control" name="endRangeDate" id="MGEndRangeDate"
                                   value="{$maxDateEnd}">
                            <input type="text" class="form-control" name="endDate" id="MGEndDate"
                                   value="{$endDisplayDate}">
                        </div>
                        <button type="button" class="btn mg-btn btn-primary blue" id="MGStartFilter" style="margin-left: 1rem;">Filter</button>
                    </div>
                </div>
            </div>

            <div class="panel-body center-block easyGraph" id="MGGraphs" style="overflow: auto;">
                <img src="{$graph}" id="MGGraphImage">
            </div>
        </div>
    </div>
</div>

<script src="{$jsDir}/bootstrap-datepicker.js"></script>

<script>
    $("document").ready(function () {
        datepickerStart = $('#MGStartDate').datepicker({
            format: 'yyyy-mm-dd', startDate: $('#MGStartRangeDate').val(), endDate: $('#MGEndRangeDate').val()
        });

        datepickerEnd = $('#MGEndDate').datepicker({
            format: 'yyyy-mm-dd', startDate: $('#MGStartRangeDate').val(), endDate: $('#MGEndRangeDate').val()
        });

        datepickerStart.on('changeDate', function (ev) {
            $('#MGStartRangeDate').val(ev.target.value);
        });

        datepickerEnd.on('changeDate', function (ev) {
            $('#MGEndRangeDate').val(ev.target.value);
        });

        $('#MGStartFilter').trigger('click');
    });


    $('#MGStartFilter').on('click', function () {
        $('#MGStartFilter').attr("disabled", true)
        const urlParams = new URLSearchParams(window.location.search);

        var graphImage = ($('#MGGraphImage'));
        var loader = document.createElement('div');
        loader.innerHTML = '<img src="admin/images/loading.gif" id="configOptionsLoader" class="configOptionsLoader" style="padding-top: 15px; padding-bottom: 20px;">';
        loader.setAttribute("style", 'display: flex; align-items: center; justify-content: center;');
        graphImage.after(loader);
        // $("#MGGraphImage").attr('style', 'display:none;');
        $("#MGGraphImage").attr('hidden', 'true');


        $.post("clientarea.php", {
            action: "productdetails",
            a: "graphs",
            id: urlParams.get('id'),
            magic: true,
            modop: "custom",
            startDate: $('#MGStartRangeDate').val(),
            endDate: $('#MGEndRangeDate').val(),
            width: $(".panel-body.center-block.easyGraph").width(),
        }).done(function (data) {
            let response = JSON.parse(data);
            $("#MGGraphImage").attr('src', response.graph);
            $('#MGStartFilter').removeAttr("disabled")
            $("#MGGraphImage").removeAttr('hidden');
            $('#configOptionsLoader').remove()

        });
    })
</script>

<style>
    @import "{$cssDir}/bootstrap-datepicker.css";
</style>
