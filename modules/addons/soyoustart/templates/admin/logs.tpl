{include file=$tplVar.header}

<link rel="stylesheet" type="text/css" href="https://cdn.datatables.net/1.13.6/css/jquery.dataTables.min.css">
<script src="https://cdn.datatables.net/1.13.6/js/jquery.dataTables.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

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

    th.textdata.sorting,
    table.dataTable thead th {
        text-align: center;
    }
</style>

<div class="innerContent">
    <div class="tablebg">

        <div class="row">
            <div class="col-md-6">
                <h2>{$tplVar['_lang']['logs']}</h2>
            </div>
            <div class="col-md-6">
                <button class="btn btn-primary" style="float: right;" id="clearLog" > Clear Logs </button>
            </div>

        </div>
        <div class="alert alert-secondary" role="alert">{$tplVar['_lang']['logs_note']}
            <span class="documentation"><a href="https://wiki.whmcsglobalservices.com/index.php?title=WHMCS_OVH_Module_Installation_Guide_%26_Documentation#Logs" target="_blank"> {$tplVar['_lang']['doc']}</a> </span>
        </div>

        <ul class="nav nav-tabs">
            <li class="tab logactive" id="logtab">
                <input id="logs" name="log" type="button" value="Log" class="logbproperty">
            </li>&nbsp;&nbsp;&nbsp;
            <li class="tab" id="cronlogtab"> <input id="cronlogs" name="log" type="button" value="Cron Log"
                    class="logbproperty"></li>&nbsp;&nbsp;
        </ul>
        <br>
        <div id="logsdata">
            <table id="logdata" class="datatable" width="100%" border="0" cellspacing="1" cellpadding="3">
                <thead>
                    <tr>
                        <th class="textdata" style="width: 150px;">{$tplVar['_lang']['logsdate']}</th>
                        <th class="textdata" style="width: 100px;">{$tplVar['_lang']['method']}</th>
                        <th class="textdata" style="width: 200px;">{$tplVar['_lang']['action']}</th>
                        <th class="textdata">{$tplVar['_lang']['request']}</th>
                        <th class="textdata">{$tplVar['_lang']['response']}</th>

                    </tr>
                </thead>
                {* <tbody>
                    {foreach $tplVar['moduleLogs'] as $logdata}
                        <tr>
                            <td class="text-center">{$logdata->datetime}</td>
                            <td class="text-center">{$logdata->type}</td>
                            <td class="text-center">{$logdata->action}</td>
                            <td><textarea rows="5" class="form-control">{$logdata->request}</textarea></td>
                            <td><textarea rows="5" class="form-control">{$logdata->response}</textarea></td>
                        </tr>
                    {/foreach}
                </tbody> *}
            </table>
        </div>
        <div id="cronsdata" style="display:none;">
            <table class="datatable" id="crondata" width="100%" border="0" cellspacing="1" cellpadding="3">
                <thead>
                    <tr class="text-center">
                        <th>{$tplVar['_lang']['cronlogsdate']}</th>
                        <th>{$tplVar['_lang']['user_name_email_id']}</th>
                        <th>{$tplVar['_lang']['language']}</th>
                        <th>{$tplVar['_lang']['mailtemplate']}</th>
                        <th>{$tplVar['_lang']['cronlogsmessage']}</th>
                    </tr>
                </thead>

                {* <tbody>
                    {foreach $tplVar['cronLogs'] as $logdata}
                        <tr class="text-center">
                            <td> {$logdata->datetime} </td>
                            <td> {$logdata->account_user} </td>
                            <td> {$logdata->language} </td>
                            <td> {$logdata->email_subject} </td>
                            <td> {$logdata->message} </td>
                        </tr>

                    {/foreach}

                </tbody> *}
            </table>
        </div>

    </div>
</div>
{include file=$tplVar.footer}