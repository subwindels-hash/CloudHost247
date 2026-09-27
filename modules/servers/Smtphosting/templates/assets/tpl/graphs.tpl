<h2>Graphs</h2>

<div align="right" style="margin-top: -35px;">
    <form action="clientarea.php">
        <input type="hidden" name="id" value="{$params.serviceid}"/>
        <input type="hidden" name="action" value="productdetails"/>
        <input type="hidden" name="modop" value="custom"/>
        <input type="hidden" name="a" value="graphs"/>
        <select name="timeframe" onchange="this.form.submit()">
            {foreach from=$timeFrames key=k item=entity}
                <option value="{$k}" {if $k eq $timeframe} selected{/if}>{$entity}</option>
            {/foreach}
        </select>
    </form>
</div>
<br><br>
<!-- CPU -->
<div class="panel panel-default">
    <!-- Default panel contents -->
    <div class="panel-heading"><b>CPU Usage</b></div>
    <div class="panel-body">
        <canvas id="pr-graph-cpu" width="200" height="200"></canvas>
    </div>
</div>
<!-- Memory -->
<div class="panel panel-default">
    <div class="panel-heading"><b>Memory</b></div>
    <div class="panel-body">
        <canvas id="pr-graph-mem" width="200" height="200"></canvas>
    </div>
</div>
<!-- Net -->
<div class="panel panel-default">
    <div class="panel-heading"><b>Network Traffic</b></div>
    <div class="panel-body">
        <canvas id="pr-graph-net" width="200" height="200"></canvas>
    </div>
</div>
<!-- Disk IO -->
<div class="panel panel-default">
    <div class="panel-heading"><b>Disk IO</b></div>
    <div class="panel-body">
        <canvas id="pr-graph-disk" width="200" height="200"></canvas>
    </div>
</div>
{literal}
    <script type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/2.9.3/Chart.bundle.min.js"></script>
<script type="text/javascript">
    function mgBytesToSize(bytes)
    {
        var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        if (bytes <= 1)
        {
            if (bytes !== 0)
            {
                var bytes = Number(bytes).toFixed(1);
            }
            return bytes + ' Byte';
        }
        var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
        return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
    }

    $(document).ready(function () {
        var graphs = {/literal}{$graphs}{literal};
        //cpu
        var cpu = document.getElementById("pr-graph-cpu").getContext('2d');
        new Chart(cpu, {
            type: 'line',
            label: 'Dataset',
            data: graphs.cpu,
            options: {
                maintainAspectRatio: false,
                scales: {
                    yAxes: [
                        {
                            scaleLabel: {
                                display: true,
                                labelString: ' CPU Usage'
                            },
                            ticks: {
                                beginAtZero: true
                            }
                        }
                    ]
                },
                tooltips: {
                    callbacks: {
                        label: function (tooltipItem, data) {
                            var used = Number(tooltipItem.yLabel).toFixed(2);
                            return used + "%";
                        }
                    }
                }
            }
        });
        //mem
        var mem = document.getElementById("pr-graph-mem").getContext('2d');
        new Chart(mem, {
            type: 'line',
            label: 'Dataset',
            data: graphs.mem,
            options: {
                maintainAspectRatio: false,
                scales: {
                    yAxes: [
                        {
                            scaleLabel: {
                                display: true,
                                labelString: 'Bytes'
                            },
                            ticks: {
                                beginAtZero: true,
                                callback: function (label, index, labels) {
                                    return mgBytesToSize(label);
                                }
                            },
                        }
                    ]
                },
                tooltips: {
                    callbacks: {
                        label: function (tooltipItem, data) {
                            return mgBytesToSize(tooltipItem.yLabel);
                        }
                    }
                }
            }
        });
        //net
        var net = document.getElementById("pr-graph-net").getContext('2d');
        new Chart(net, {
            type: 'line',
            label: 'Dataset',
            data: graphs.net,
            options: {
                maintainAspectRatio: false,
                scales: {
                    yAxes: [
                        {
                            scaleLabel: {
                                display: true,
                                labelString: 'Bytes/s'
                            },
                            ticks: {
                                beginAtZero: true,
                                callback: function (label, index, labels) {
                                    return mgBytesToSize(label);
                                }
                            },
                        }
                    ]
                },
                tooltips: {
                    callbacks: {
                        label: function (tooltipItem, data) {
                            return mgBytesToSize(tooltipItem.yLabel) + "/s";
                        }
                    }
                }
            }
        });
        //disk
        var disk = document.getElementById("pr-graph-disk").getContext('2d');
        new Chart(disk, {
            type: 'line',
            label: 'Dataset',
            data: graphs.disk,
            options: {
                maintainAspectRatio: false,
                scales: {
                    yAxes: [
                        {
                            scaleLabel: {
                                display: true,
                                labelString: 'Bytes/s'
                            },
                            ticks: {
                                beginAtZero: true,
                                callback: function (label, index, labels) {
                                    return mgBytesToSize(label);
                                }
                            },
                        }
                    ]
                },
                tooltips: {
                    callbacks: {
                        label: function (tooltipItem, data) {
                            return mgBytesToSize(tooltipItem.yLabel) + "/s";
                        }
                    }
                }
            }
        });

    });
</script>
{/literal}

