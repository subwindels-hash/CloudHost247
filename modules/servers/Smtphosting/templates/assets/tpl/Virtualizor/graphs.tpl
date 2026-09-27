<div class="intergation-ca-page">
    <h2>Graphs</h2>

    <div align="right" style="margin-top: -35px;">
        <form action="clientarea.php">
            <input type="hidden" name="id" value="{$params.serviceid}"/>
            <input type="hidden" name="action" value="productdetails"/>
            <input type="hidden" name="modop" value="custom"/>
            <input type="hidden" name="a" value="graphs"/>
        </form>
    </div>
    <br><br>
    <!-- Bandwidth Chart -->
    <div class="panel panel-default panel-bandwidth">
        <!-- Default panel contents -->
        <div class="panel-heading" style="display: flex; align-items: center; justify-content: space-between;">
            <b>{$MGLANG->T('Virtualizor','bandwidth')}</b>
            <div>
                <button class="btn btn-primary btn-sm" id="prevMonth">{$MGLANG->T('Virtualizor', 'prevMonth')}</button>
                <button class="btn btn-primary btn-sm" id="nextMonth">{$MGLANG->T('Virtualizor', 'nextMonth')}</button>
            </div>
        </div>
        <div class="panel-body">
            <canvas id="pr-graph-bandwidth" width="200" height="200" style="max-height: 200px;"></canvas>
        </div>
    </div>
    <!-- Monthly Chart -->
    <div class="panel panel-default">
        <div class="panel-heading"><b>{$MGLANG->T('Virtualizor','graphMonthly')}</b></div>
        <div class="panel-body">
            <canvas id="pr-graph-monthly" width="200" height="200"></canvas>
        </div>
    </div>
</div>

{literal}
<script type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/2.9.3/Chart.bundle.min.js"></script>
<script type="text/javascript">
    var date = new Date();
    var selectedMonth = date.getMonth() + 1;
    var selectedYear = date.getFullYear();

    $(document).ready(function () {
        var graphs = {/literal}{html_entity_decode($graphs)}{literal};
        var bandwidth = document.getElementById("pr-graph-bandwidth").getContext('2d');
        createGraph(bandwidth, graphs.bandwidth, graphs.labelDate, 'Bandwidth (MB)');

        var monthly = document.getElementById("pr-graph-monthly").getContext('2d');
        createGraph(monthly, graphs.monthly, 'Month', 'Bandwidth (MB)');

        $('#prevMonth').click(function () {
            toggleButtons(false);
            if (selectedMonth == 1)
            {
                selectedMonth = 12;
                selectedYear--;
            } else
            {
                selectedMonth--;
            }
            updateBandwidthChart();
        });

        $('#nextMonth').click(function () {
            toggleButtons(false);

            if (selectedMonth == 12)
            {
                selectedMonth = 0;
                selectedYear++;
            } else
            {
                selectedMonth++;
            }
            updateBandwidthChart();
        });
    });

    function toggleButtons(enable)
    {
        if (enable)
        {
            $('#prevMonth').removeAttr("disabled")
            $('#nextMonth').removeAttr("disabled")
        } else
        {
            $('#prevMonth').attr("disabled", true);
            $('#nextMonth').attr("disabled", true);
        }
    }

    function createCanvas()
    {
        child = document.createElement('canvas');
        child.setAttribute('width', 200);
        child.setAttribute('style', 'max-height: 200px;');
        child.setAttribute('height', 200);
        child.setAttribute('id', 'pr-graph-bandwidth');
        return child;
    }

    function updateBandwidthChart()
    {
        var timeframe = selectedYear + ('0' + (selectedMonth)).slice(-2)
        var bandwidthGraph = $('#pr-graph-bandwidth');

        var loader = document.createElement('div');
        loader.innerHTML = '<img src="admin/images/loading.gif" id="graphLoader" class="configOptionsLoader" style="padding-top: 104px; padding-bottom: 80px; margin: ">';
        loader.setAttribute("style", 'display: flex; align-items: center; justify-content: center;');
        bandwidthGraph.after(loader);
        var parent = bandwidthGraph.parent();
        var child = createCanvas();

        bandwidthGraph.remove();

        $.post("clientarea.php", {
            action: "productdetails",
            id: new URLSearchParams(window.location.search).get('id'),
            a: "graphs",
            magic: true,
            timeframe: timeframe
        }).done(function (data) {
            let response = JSON.parse(data);
            toggleButtons(true);
            $('#graphLoader').remove();
            parent.append(child);

            var bandwidth = document.getElementById("pr-graph-bandwidth").getContext('2d');
            createGraph(bandwidth, response.bandwidth, response.labelDate, 'Bandwidth (MB)');
        });

    }

    function createGraph(element, values, xLabel, yLabel)
    {
        new Chart(element, {
            type: 'line',
            label: 'Dataset',
            data: values,
            options: {
                maintainAspectRatio: false,
                scales: {
                    yAxes: [
                        {
                            scaleLabel: {
                                display: true,
                                labelString: yLabel
                            },
                            ticks: {
                                beginAtZero: true
                            }
                        }
                    ],
                    xAxes: [
                        {
                            scaleLabel: {
                                display: true,
                                labelString: xLabel
                            },
                            ticks: {
                                beginAtZero: true,
                            },
                        }
                    ],
                },
                tooltips: {
                    callbacks: {
                        label: function (tooltipItem, data) {
                            return Number(tooltipItem.yLabel).toFixed(6);
                        }
                    }
                }
            }
        });
    }
</script>
{/literal}
