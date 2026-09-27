<?php

namespace WHMCS\Module\Server\SoyoustartVps;

require_once __DIR__ . '/../../../addons/soyoustart/classes/ApiCall.php';

use WGSModule\Soyoustart\classes\ApiCall;

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

use WHMCS\Module\Addon\Soyoustart\Helper;
use WHMCS\Database\Capsule;

class SoyoustartServer extends Helper
{
    public $addonHelper;
    public function __construct()
    {
        $this->addonHelper = new Helper();
    }

    public function getServiceConfigs($serviceID)
    {
        try {
            $serviceConfigs = Capsule::table('tblhostingconfigoptions')
                ->join('tblproductconfigoptionssub', 'tblhostingconfigoptions.optionid', '=', 'tblproductconfigoptionssub.id')
                ->join('tblproductconfigoptions', 'tblhostingconfigoptions.configid', '=', 'tblproductconfigoptions.id')
                ->select('tblhostingconfigoptions.optionid', 'tblhostingconfigoptions.qty', 'tblproductconfigoptions.optionname as opname', 'tblproductconfigoptions.optiontype', 'tblproductconfigoptionssub.optionname')
                ->where('tblhostingconfigoptions.relid', $serviceID)->get();

            return $serviceConfigs;
        } catch (\Throwable $th) {
            //throw $th;
        }
    }

    public function serviceInfoHtml($serverInfo, $LANG, $ovhCustomHostname, $cardBody = true)
    {

        $html = '
        <div class="card">
            <h5 class="card-header">' . $LANG["serviceInfo"] . '</h5>
            <div class="card-body " id="serverInfo">';
        if (isset($serverInfo["httpcode"]) && $serverInfo["httpcode"] != 200) {
            $html = '<div class="alert alert-danger" role="alert">Error: ' . $serverInfo["result"]->message . '</div>';
            return $html;
        } elseif ($cardBody) {
            $serverInfo = $serverInfo["result"];
            $html = '
                <div class="adminServerInfo">
                        <div class="">Server ' . $LANG["vpsservide_name"] . '</div>
                        <div class="">' . ucwords($ovhCustomHostname == "" ? $serverInfo->name : $ovhCustomHostname) . '</div>
                </div>
                <div class="adminServerInfo">
                <div class="">' . $LANG["vpsservide_ipaddress"] . '</div>
                    <div class="getIps " id="ip4"></div>
                </div>

                <div class="adminServerInfo">
                        <div class="">' . $LANG["vpsservide_cluster"] . '</div>
                        <div class="">' . $serverInfo->cluster . '</div>
                </div>  
                <div class="adminServerInfo">
                        <div class="">' . $LANG["vpsservide_netboot"] . '</div>
                        <div class="">' . ucfirst($serverInfo->netbootMode) . '</div>
                </div>
                <div class="adminServerInfo">
                        <div class="">' . $LANG["vpsservide_zone"] . '</div>
                        <div class="">' . $serverInfo->zone . '</div>
                </div>
                
                <div class="adminServerInfo">
                        <div class="">' . ucfirst($LANG["vpsservide_state"]) . '</div>';

            if ($serverInfo->state == "ok" || $serverInfo->state == "running") {
                $html .= '<div><span class="badge badge-success">' . ucfirst($serverInfo->state) . '</span></div>';
            } else {
                $html .= '<div><span class="badge badge-danger">' . ucfirst($serverInfo->state) . '</span></div>';
            }
            $html .= '
                </div>
                <div class="adminServerInfo">
                        <div class="">' . $LANG["vpsservide_vcore"] . '</div>
                        <div class="">' . $serverInfo->model->vcore . '</div>
                </div>
                <div class="adminServerInfo">
                        <div class="">' . $LANG["vpsservide_offtertype"] . '</div>
                        <div class="">' . strtoupper($serverInfo->offerType) . '</div>
                </div>
                <div class="adminServerInfo">
                <div class="">' . $LANG["vpsservide_slamonitoring"] . '</div>
                ';
            if ($serverInfo->slaMonitoring) {
                $html .= '<div><span class="badge badge-success">' . $LANG["monitoring_enable"] . '</span></div>';
            } else {
                $html .= '<div><span class="badge badge-danger">' . $LANG["monitoring_disable"] . '</span></div>';
            }
            $html .= '
                </div>
            
                <div class="adminServerInfo">
                        <div class="">' . $LANG["vpsservide_reverse_address"] . '</div>
                        <div class=""></div>
                </div>
                <div class="adminServerInfo">
                        <div class="">' . $LANG["vpsservide_memory_limit"] . '</div>
                        <div class="">' . ($serverInfo->memoryLimit > 1024 ? $serverInfo->memoryLimit / 1024 . "GB" : $serverInfo->memoryLimit . "MB") . '</div>
                </div>
                <div class="adminServerInfo">
                        <div class="">' . $LANG["vpsservide_disk"] . '</div>
                        <div class="">' . $serverInfo->model->disk . 'GB</div>
                </div>';
            return $html;
        }

        $html .= ' </div>
        </div>';

        return $html;
    }

    public function serviceMonitoringHtml($monitoringStatus, $LANG, $cardBody = true)
    {
        $html = '
        <div class="card">
            <h5 class="card-header">' . $LANG["service_monitoring"] . '</h5>
            <div class="card-body" id="serviceMonitoring">';

        if (isset($monitoringStatus["httpcode"]) && $monitoringStatus["httpcode"] != 200) {
            $html= '<div class="alert alert-danger" role="alert">Error: ' . $monitoringStatus["result"]->message . '</div>';
            return $html;
        } elseif ($cardBody) {
            $monitoringStatus = $monitoringStatus["result"];
            $html = '<div class="adminServerInfo">
                         <div class="">' . $LANG["status_ssh"] . '</div>';
            if (!isset($monitoringStatus->ssh) || $monitoringStatus->ssh->state == "down") {
                $html .= '<div><span class="badge badge-danger">' . $LANG["status_down"] . '</span></div>';
            } else {
                $html .= '<div><span class="badge badge-success">' . $LANG["status_up"] . '</span></div>';
            }
            $html .= '
                         </div>  
                         <div class="adminServerInfo">
                             <div class="">' . $LANG["status_dns"] . '</div>';
            if (!isset($monitoringStatus->dns) || $monitoringStatus->dns->state == "down") {
                $html .= '<div><span class="badge badge-danger">' . $LANG["status_down"] . '</span></div>';
            } else {
                $html .= '<div><span class="badge badge-success">' . $LANG["status_up"] . '</span></div>';
            }
            $html .= '
                         </div>
                         <div class="adminServerInfo">
                                 <div class="">' . $LANG["status_tools"] . '</div>';
            if (!isset($monitoringStatus->tools) || $monitoringStatus->tools->state == "down") {
                $html .= '<div><span class="badge badge-danger">' . $LANG["status_down"] . '</span></div>';
            } else {
                $html .= '<div><span class="badge badge-success">' . $LANG["status_up"] . '</span></div>';
            }
            $html .= '
                         </div>
                         <div class="adminServerInfo">
                                 <div class="">' . $LANG["status_smtp"] . '</div>';
            if (!isset($monitoringStatus->smtp) || $monitoringStatus->smtp->state == "down") {
                $html .= '<div><span class="badge badge-danger">' . $LANG["status_down"] . '</span></div>';
            } else {
                $html .= '<div><span class="badge badge-success">' . $LANG["status_up"] . '</span></div>';
            }
            $html .= '
                         </div>
                         <div class="adminServerInfo">
                                 <div class="">' . $LANG["status_https"] . '</div>';
            if (!isset($monitoringStatus->https) || $monitoringStatus->https->state == "down") {
                $html .= '<div><span class="badge badge-danger">' . $LANG["status_down"] . '</span></div>';
            } else {
                $html .= '<div><span class="badge badge-success">' . $LANG["status_up"] . '</span></div>';
            }
            $html .= '
                         </div>
                         <div class="adminServerInfo">
                                 <div class="">' . $LANG["status_http"] . '</div>';
            if (!isset($monitoringStatus->http) || $monitoringStatus->http->state == "down") {
                $html .= '<div><span class="badge badge-danger">' . $LANG["status_down"] . '</span></div>';
            } else {
                $html .= '<div><span class="badge badge-success">' . $LANG["status_up"] . '</span></div>';
            }
            $html .= '
                         </div>
                         <div class="adminServerInfo">
                                 <div class="">' . $LANG["status_ping"] . '</div>';
            if (!isset($monitoringStatus->ping) || $monitoringStatus->ping == "down") {
                $html .= '<div><span class="badge badge-danger">' . $LANG["status_down"] . '</span></div>';
            } else {
                $html .= '<div><span class="badge badge-success">' . $LANG["status_up"] . '</span></div>';
            }
            $html .= '
         </div>';
            return $html;
        }
        $html .= ' </div>
       </div>';

        return $html;
    }
    public function snapshotInfoHtml($LANG)
    {
        $html = '
        <div class="card">
            <h5 class="card-header">' . $LANG["snapshot"] . '</h5>
            <div class="card-body snapshotBody">
                <table id="snapshot_vps" style="width:100%;border: 1px solid #ddd; ">
                    <thead>
                        <tr>
                            <th>Region</th>
                            <th>' . $LANG["create_date"] . '</th>
                            <th>' . $LANG["status_descrition"] . '</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>

                    </tbody>
                </table>';

        $html .= ' </div>
            </div>
            <div class="modal fade" id="editSnapshot" tabindex="-1" role="dialog"
                aria-labelledby="editSnapshotTitle" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered" role="document">
                    <div class="modal-content">
                        <form id="snapshotedit">
                            <div class="modal-header">
                                <h5 class="modal-title">' . $LANG["snapshoteditDesc"] . '</h5>
                                <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span> </button>
                            </div>

                            <div class="modal-body">

                                <div class="form-group">
                                    <label for="snapshoteditDesc" class="col-form-label">' . $LANG["snapshotDesc"] . '</label>
                                    <div class="modal-input">
                                        <textarea class="form-control" id="snapshoteditDesc" rows="3"></textarea>
                                    </div>
                                </div>


                                <div class="modal-footer">
                                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
                                    <button type="button" class="btn btn-primary snapshoteditDesc">Confirm</button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <div class="modal fade" id="snapshotCreateBtn" tabindex="-1" role="dialog"
                aria-labelledby="snapshotCreateBtnTitle" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered" role="document">
                    <div class="modal-content">
                        <form id="snapshotCreate">
                            <div class="modal-header">
                                <h5 class="modal-title" id="additinalIpModalLongTitle">Create snapshot</h5>
                                <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span> </button>
                            </div>

                            <div class="modal-body">

                                <div class="form-group">
                                    <label for="snapshotDesc" class="col-form-label">' . $LANG["snapshotDesc"] . '</label>
                                    <div class="modal-input">
                                        <textarea class="form-control" id="snapshotDesc" rows="3"></textarea>
                                    </div>
                                </div>


                                <div class="modal-footer">
                                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
                                    <button type="button" class="btn btn-primary snapshotCreate">Confirm</button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>';


        return $html;
    }
    public function diskInfoHtml($sdisktInfo, $diskErrors, $LANG, $cardBody = true)
    {

        $html = '
        <div class="card diskCard">
            <h5 class="card-header">' . $LANG["disk"] . '</h5>
            <div class="card-body">';
        if ($diskErrors != "") {
            $html = '<div class="alert alert-danger" role="alert">Error: ' . $diskErrors . '</div>';
            return $html;
        } else {
            $html .= '<table id="disk_vps" style="width:100%">
                   <thead>
                       <tr>
                           <th>' . $LANG["disk_id"] . '</th>
                           <th>' . $LANG["type"] . '</th>
                           <th>' . $LANG["disk_size"] . '</th>
                           <th>' . $LANG["disk_bandwidth"] . '</th>
                           <th>' . $LANG["disk_threshhold"] . '</th>
                           <th>' . $LANG["disk_state"] . '</th>
                       </tr>
                   </thead>
                   <tbody>';
            if ($cardBody) {
                $html = '';
                foreach ($sdisktInfo as $key => $sdisktInfo) {
                    $html .= '
                                   <tr>
                                       <td>' . $sdisktInfo->id . '</td>
                                       <td>' . $sdisktInfo->type . ' </td>
                                       <td>' . $sdisktInfo->size . '</td>
                                       <td>' . $sdisktInfo->bandwidthLimit . ' </td>
                                       <td>' . $sdisktInfo->lowFreeSpaceThreshold . '</td>';
                    if ($sdisktInfo->state == "connected") {
                        $html .= '<td class="badge badge-success mt-2">' . $LANG["disk_connected"] . ' </td>';
                    } elseif ($sdisktInfo->state == "disconnected") {
                        $html .= '<td class="badge badge-danger mt-2 p-1">' . $LANG["disk_disconnected"] . ' </td>';
                    } else {
                        $html .= '<td class="badge badge-warning mt-2 p-1">' . $LANG["disk_pending"] . ' </td>';
                    }
                    $html .= '</tr>';
                }
                return $html;

            }
            $html .= '</tbody>
               </table>';
        }
        $html .= ' </div>
        </div>';


        return $html;
    }
    public function ipInfoHtml($iptInfo, $ipsErrors, $LANG, $cardBody = true)
    {
        $html = '<div class="modal fade suspension-modal" id="forip-reverse">
            <div class="modal-dialog vps-ip-reverse">
                <div class="modal-content">
                    <div class="modal-header">
                        <h4 class="modal-title">' . $LANG["vpsservide_reverse_address"] . '</h4>
                        <button type="button" class="close" data-dismiss="modal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label for="ip">' . $LANG["vpsservide_ipaddress"] . '</label>
                            <input type="text" name="ipaddress" class="form-control" value="" readonly>
                        </div>
                        <div class="form-group">
                            <label for="">' . $LANG["reverse"] . '</label>
                            <input type="text" name="reverseip" class="form-control" id="">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <div class="partial-buttons">
                            <button type="button" class="btn btn-success reverse_ip" data-ipAddress="' . $iptInfo->ipAddress . '" id="" >' . $LANG["save_change"] . '</button>
                            <button type="button" class="btn btn-secondary" data-dismiss="modal">' . $LANG["close"] . '</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="card cardIPs">
            <h5 class="card-header">' . $LANG["vps_ip_head"] . '</h5>
            <div class="card-body">';
        if ($ipsErrors != "") {
            $html = '<div class="alert alert-danger" role="alert">Error: ' . $ipsErrors . '</div>';
            return $html;
        } else {
            $html .= '<table id="ipaddress_vps" style="width:100%">
                    <thead>
                        <tr>
                            <th>' . $LANG["vps_ip"] . '</th>
                            <th>' . $LANG["ipVersion"] . '</th>
                            <th>' . $LANG["type"] . '</th>
                            <th>' . $LANG["geo_location"] . '</th>
                            <th>' . $LANG["mac_address"] . '</th>
                            <th>' . $LANG["reverseDns"] . '</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>';
            if ($cardBody) {
                $html = '';
                foreach ($iptInfo as $key => $iptInfo) {
                    $html .= '
                                            <tr>
                                                <td>' . $iptInfo->ipAddress . '</td>
                                                <td>' . $iptInfo->version . ' </td>
                                                <td>' . $iptInfo->type . '</td>
                                                <td>' . $iptInfo->geolocation . ' </td>';
                    if ($iptInfo->macAddress != "") {
                        $html .= '<td>' . $iptInfo->macAddress . ' </td>';
                    } else {
                        $html .= '<td> - </td>';
                    }
                    if ($iptInfo->reverse != "") {
                        $html .= '<td>' . $iptInfo->reverse . ' </td>';
                    } else {
                        $html .= '<td> - </td>';
                    }
                    $html .= '<td><a class="ip-reverse" data-target="#forip-reverse" data-toggle="modal" data-ipAddress="' . $iptInfo->ipAddress . '"><i class="fas fa-exchange-alt"></i>
                        </a></td>
                            </tr>';
                }
                return $html;

            }
            $html .= '</tbody>
                </table>';
        }
        $html .= '</div>
        </div>';


        return $html;
    }

    public function featureHtml($features, $serviceId)
    {
        $enableSettings = $this->addonHelper->get_data("mod_acl_settings", ["key" => "servicePageAclSettings_$serviceId"]);


        $enableSettingsResult = [];
        foreach ($enableSettings as $key => $value) {
            $enableSettingsResult[$value->key] = !empty($value) ? json_decode($value->value, true) : [];
        }
        $enableSettingsResult = $enableSettingsResult["servicePageAclSettings_$serviceId"];
        $html = '
        <div class="card">
            <h5 class="card-header">Hide clientarea features for this service</h5>
            <div class="card-body">
                <div class="row">';
        foreach ($features as $key => $value) {
            $checked = (($enableSettingsResult[str_replace(' ', '_', $value)] == "on") ? "checked" : "");
            $html .= '
                            <div class="col-md-4">
                                <div class="form-group"><input type="checkbox" name="' . $value . '" ' . $checked . '> ' . $value . '
                                </div>
                            </div>';
        }
        $html .= '
                </div>
            </div>
        </div>';

        return $html;
    }



    public function getDiskData($diskid, $ovhServerName, $accountId, $location)
    {
        $apiCall = new ApiCall();
        $diskdata = [];
        foreach ($diskid["result"] as $value) {
            $diskInfo = $apiCall->get("/vps/{$ovhServerName}/disks/$value", $accountId, $location, "Get diskInfo Status", true);
            if ($diskInfo["httpcode"] != 200) {
                $diskErrors = $diskInfo["result"]->message;
            }
            $diskdata[$value] = $diskInfo["result"];
        }
        $result = ($diskErrors != "") ? $diskErrors : $diskdata;

        return $result;
    }
    public function getipData($ips, $ovhServerName, $accountId, $location)
    {
        $apiCall = new ApiCall();
        $ipdata = [];
        foreach ($ips as $value) {
            $iptInfo = $apiCall->get("/vps/{$ovhServerName}/ips/$value", $accountId, $location, "Get IP Address Info", true);
            if ($iptInfo["httpcode"] != 200) {
                $ipsErrors = $iptInfo["result"]->message;
            }
            $ipdata[$value] = $iptInfo["result"];
        }
        $result = ($ipsErrors != "") ? $ipsErrors : $ipdata;

        return $result;
    }

   

    public function cretateBackupHtml($backupInfo, $orderStatus, $LANG)
    {

        $html = '';
        // if (!empty($orderStatus) && !isset($backupInfo["result"]->creationDate)) {
        //     if ($orderStatus["httpcode"] != 200) {
        //         $html .= '<div class="alert alert-warning" role="alert">Order has been placed. order status(' . ($orderStatus["result"]->message) . ')</div>';
        //     } else {
        //         if ($orderStatus["result"] != "delivered") {
        //             $html .= '<div class="alert alert-success" role="alert">Order has been placed. order status(' . ($orderStatus["result"]) . ')</div>';
        //         } else {
        //             $html .= ' <p class="snapshotCreateMsg">' . $LANG["snapshotCreateMsg"] . ' </p>
        //             <button class="btn btn-success snapshotCreateBtn"  data-toggle="modal" data-target="#snapshotCreateBtn">' . $LANG["snapshotCreateBtn"] . '
        //             </button>';
        //         }
        //     }
        // } 
        if ($backupInfo) {
            if ($backupInfo["httpcode"] != 200) {
                $html .= ' <p class="hardDiskNotes">Backup Message</p>
                 <button class="btn btn-success createbackup">Order Backup
                 </button>';
            }
            // else {
            //     $creationDate = $backupInfo["result"]->creationDate;
            //     $dateTime = new \DateTime("$creationDate");
            //     $readableFormat = $dateTime->format('D, Y-m-d H:i:s');
            //     $html .= '
            //      <ul class="accordion-list" style="padding: 0;">
            //      <div class="table-responsive">
            //      <table id="manageSnapshot" class="display" style="width:100%; text-align: center;">
            //      <thead>
            //          <tr>
            //              <th>Region</th>
            //              <th>' . $LANG["create_date"] . '</th>
            //              <th>' . $LANG["status_descrition"] . '</th>
            //              <th>Action</th>
            //          </tr>
            //      </thead>
            //      <tbody>
            //          <tr >
            //              <td>' . $backupInfo["result"]->region . '</td>
            //              <td>' . $readableFormat . '</td>
            //              <td>' . $backupInfo["result"]->description . '</td>
            //              <td>
            //                  <button><i class="fas fa-pen editSnapshot" data-desc="' . $backupInfo["result"]->description . '" data-toggle="modal" data-target="#editSnapshot"></i></button>
            //                  <button><i class="fas fa-redo revertSnapshot" data-toggle="modal" data-target="#revertSnapshot"></i></button>
            //                  <button><i class="fas fa-trash deleteSnapshot" data-toggle="modal" data-target="#deleteSnapshot"></i></button>
            //              </td>
            //          </tr>

            //      </tbody>
            //      </table>
            //      </div></ul>

            //      ';
            // }
        }

        return $html;
    }
    public function cretateSnapshotHtml($snapshotInfo, $orderStatus, $LANG)
    {
        $html = '';
        if (!empty($orderStatus) && !isset($snapshotInfo["result"]->creationDate)) {
            if ($orderStatus["httpcode"] != 200) {
                $html .= '<div class="alert alert-warning" role="alert">Order has been placed. order status(' . ($orderStatus["result"]->message) . ')</div>';
            } else {
                if ($orderStatus["result"] != "delivered") {
                    $html .= '<div class="alert alert-success" role="alert">Order has been placed. order status(' . ($orderStatus["result"]) . ')</div>';
                } else {
                    $html .= ' <p class="snapshotCreateMsg">' . $LANG["snapshotCreateMsg"] . ' </p>
                    <button class="btn btn-success snapshotCreateBtn"  data-toggle="modal" data-target="#snapshotCreateBtn">' . $LANG["snapshotCreateBtn"] . '
                    </button>';
                }
            }
        } else {
            if ($snapshotInfo["httpcode"] != 200) {
                $html .= ' <p class="hardDiskNotes">' . $LANG["snapshotMsg"] . ' </p>
                 <button class="btn btn-success createSnapshot">' . $LANG["snapshotBtn"] . '
                 </button>';
            } else {
                $creationDate = $snapshotInfo["result"]->creationDate;
                $dateTime = new \DateTime("$creationDate");
                $readableFormat = $dateTime->format('D, Y-m-d H:i:s');
                $html .= '
                 <ul class="accordion-list" style="padding: 0;">
                 <div class="table-responsive">
                 <table id="manageSnapshot" class="display" style="width:100%; text-align: center;">
                 <thead>
                     <tr>
                         <th>Region</th>
                         <th>' . $LANG["create_date"] . '</th>
                         <th>' . $LANG["status_descrition"] . '</th>
                         <th>Action</th>
                     </tr>
                 </thead>
                 <tbody>
                     <tr >
                         <td>' . $snapshotInfo["result"]->region . '</td>
                         <td>' . $readableFormat . '</td>
                         <td>' . $snapshotInfo["result"]->description . '</td>
                         <td>
                             <button><i class="fas fa-pen editSnapshot" data-desc="' . $snapshotInfo["result"]->description . '" data-toggle="modal" data-target="#editSnapshot"></i></button>
                             <button><i class="fas fa-redo revertSnapshot" data-toggle="modal" data-target="#revertSnapshot"></i></button>
                             <button><i class="fas fa-trash deleteSnapshot" data-toggle="modal" data-target="#deleteSnapshot"></i></button>
                         </td>
                     </tr>
                     
                 </tbody>
                 </table>
                 </div></ul>
                 
                 ';
            }
        }

        return $html;
    }


    public function createIpListHtml($ipDetail = [], $apiCall =null, $location ='', $ovhServerName ='', $accountId ='', $LANG =[])
    {
        if (empty($ipDetail)) {
            return '<div class="alert alert-warning" role="alert">
                No IPs assing with the server!
          </div>';
        }

        $html = '
        <button class="btn btn-primary mb-4" data-toggle="modal" data-target="#additinalIpModalCenter" style="float: right;"> Additional IP <i class="fa fa-plus"></i></button>
        <ul class="accordion-list" style="padding: 0;">';
        $html .= '
        <div class="table-responsive">
        <table id="clientAreaIpmang" class="display table-hover" style="width:100%; text-align: center;">
        <thead>
            <tr>
                <th>' . $LANG["ip"] . '</th>
                <th>' . $LANG["reverseDns"] . '</th>
                <th>' . $LANG["firewall"] . '</th>
                <th>' . $LANG["action"] . '</th>
            </tr>
        </thead>
        <tbody>';
        foreach ($ipDetail as $key => $ips) {
            $response = $apiCall->get("/vps/{$ovhServerName}/ips/$ips", $accountId, $location, "Get IP Address Info", true);
            $ip_detail = $apiCall->getIpDetails($location, $ovhServerName, $accountId, $ips);

            if ($response["httpcode"] != 200) {
                $html .= '<tr><td colspan="4">' . $response["result"]->message . '</td></tr>';
                continue;
            }
            $ipDetail = $response["result"];
            $ip_details = $ip_detail["result"];

            $html .= '<tr data-ip="' . $ipDetail->ipAddress . '">
            <td>' . $ipDetail->ipAddress . '</td>';
            if ($ipDetail->reverse != "") {
                $html .= '<td>' . $ipDetail->reverse . ' </td>';
            } else {
                $html .= '<td> - </td>';
            }
            if ($ipDetail->version != "v6") {
                if (isset($ip_details->firewallDetails->message)) {
                    $html .= '<td><button class="btn btn-primary createFirewall">' . $LANG["btnCreateFirewall"] . '</button></td>';
                } else if ($ip_details->firewallDetails->enabled) {
                    $html .= '<td class="disable_firewall"><label class="switch">
                                    <input type="checkbox" id="firewallEnableDisable" data-action="enable" checked>
                                    <span class="slider round"></span>
                                </label></td>';
                } else {
                    $html .= '<td class="disable_firewall">
                                <label class="switch" >
                                <input type="checkbox" id="firewallEnableDisable" data-action="disable">
                                <span class="slider round"></span>
                                </label>
                            </td>';
                }
            } else {
                $html .= '<td> </td>';
            }
            $html .= '
            <td>';
            if ($ipDetail->version == "v6") {
                $html .= '
                <button><i class="fa fa-eye viewIpDetails" data-toggle="modal" data-target="#viewIpDetails"></i></button>
                <button><i class="fas fa-ellipsis-h ipAction"></i></button>
        
                <div class="ipActionLists" data-ipBlock="' . $ip_details->ip . '">
                    <ul>';
                if ($ip_details->description) {
                    $html .= '<li data-toggle="modal" data-target="#addIpDescriptions" data-desc="' . $ip_details->description . '">Edit a description</li>';
                } else {
                    $html .= '<li data-toggle="modal" data-target="#addIpDescriptions" data-desc="' . $ip_details->description . '" >Add a description</li>';
                }
                $html .= '
                        <li ata-toggle="modal" data-target="#addReverseIp6">Select an IPv6</li>
                    </ul>
                </div>';
            } else {
                $html .= ' 
                <button><i class="fa fa-eye viewIpDetails" data-toggle="modal" data-target="#viewIpDetails"></i></button>
                <button><i class="fas fa-ellipsis-h ipAction"></i></button>
                <div class="ipActionLists" data-ipBlock="' . $ip_details->ip . '">
                <ul>';
                if ($ip_details->description) {
                    $html .= '<li data-toggle="modal" data-target="#addIpDescriptions" data-desc="' . $ip_details->description . '">Edit a description</li>';
                } else {
                    $html .= '<li data-toggle="modal" data-target="#addIpDescriptions" data-desc="' . $ip_details->description . '">Add a description</li>';
                }
                $html .= '
                        <li data-toggle="modal" data-target="#addReverseIp">Modify the reverse path</li>
                        <li class="enableMitigration" data-mitigration="enableMitigration" data-mitigrationIp="' . $ip_details->mitigationIp . '">Scrubbling Center: permanent</li>';

                if (!isset($ip_details->firewallDetails->message)) {
                    $html .= ' <li class="deleteFirewall">Delete Network Firewall</li>
                        <li data-toggle="modal" data-target="#getFirewallRules" role="button">Edge Network Firewall configuration</li>';
                }
                $html .= '
                        
                    </ul>
                </div>';
            }

            $html .= '</td>
            </tr>';
        }
        $html .= '</tbody>
        </table>
        </div>';
        return $html;
    }
    public function createIpDetailsHtmlvps($ipDetail, $ipfirewall, $LANG)
    {

        if ($ipDetail["httpcode"] != 200) {
            return '<div class="alert alert-warning" role="alert">' . $ipDetail["result"]->message . '</div>';
        } elseif ($ipfirewall["httpcode"] != 200) {
            return '<div class="alert alert-warning" role="alert">' . $ipfirewall["result"]->message . '</div>';
        }

        $ipDetail = $ipDetail["result"];
        $ipfirewall = $ipfirewall["result"];

        $html = '<div class="row">
            <div class="col-3"><strong>' . $LANG["ipDetailModalIp"] . '</strong></div>
            <div class="col"><span>' . $ipfirewall->ip . '</span></div>
        </div>
        <div class="row">
            <div class="col-3"><strong>' . $LANG["ipDetailModalVersion"] . '</strong></div>
            <div class="col"><span>IP' . $ipDetail->version . '</span></div>
        </div>
        <div class="row">
            <div class="col-3"><strong>' . $LANG["ipDetailModalDesc"] . '</strong></div>
            <div class="col"><span>' . $ipfirewall->description . '</span></div>
        </div>
        <div class="row">
            <div class="col-3"><strong>' . $LANG["ipDetailModalCampus"] . '</strong></div>
            <div class="col"><span>' . $ipfirewall->campus . '</span></div>
        </div>
        <div class="row">
            <div class="col-3"><strong>' . $LANG["ipDetailModalResion"] . '</strong></div>
            <div class="col"><span>' . $ipfirewall->regions[0] . '</span></div>
        </div>
        <div class="row">
            <div class="col-3"><strong>' . $LANG["ipDetailModalType"] . '</strong></div>
            <div class="col"><span>' . strtoupper($ipfirewall->type) . '</span></div>
        </div>
        <div class="row">
            <div class="col-3"><strong>' . $LANG["ipDetailModalMacaddress"] . '</strong></div>
            <div class="col"><span>' . (empty($ipDetail->macaddress) ? "No Mac Address" : ($ipDetail->macaddress)) . '</span></div>
        </div>
        <div class="row">
            <div class="col-3"><strong>' . $LANG["ipDetailModalFirewall"] . '</strong></div>';

        if (isset($ipfirewall->firewallDetails->message)) {
            $html .= '<div class="col"><span class="label label-danger">' . "Firewall not created" . '</span></div>';
        } else {
            if ($ipfirewall->firewallDetails->enabled)
                $html .= '<div class="col"><span class="label label-success">Enable</span></div>';
            else
                $html .= '<div class="col"><span class="label label-danger">Disable</span></div>';
        }

        $html .= '</div>
        
        
        ';

        return $html;
    }
    public function formateBillingCycle($billingCycle)
    {

        $data = [];

        if ($billingCycle == "Monthly") {
            $data['durationVal'] = "P1M";
            $data['pricingModeVal'] = "default";
        } elseif ($billingCycle == "Quarterly") {
            $data['durationVal'] = "P3M";
            $data['pricingModeVal'] = "default";
        } elseif ($billingCycle == "Semi-Annually") {
            $data['durationVal'] = "P6M";
            $data['pricingModeVal'] = "default";
        } elseif ($billingCycle == "Annually") {
            $data['durationVal'] = "P1Y";
            $data['pricingModeVal'] = "degressivity12";
        } elseif ($billingCycle == "Biennially") {
            $data['durationVal'] = "P2Y";
            $data['pricingModeVal'] = "degressivity24";
        } else {
            $data['durationVal'] = "P1M";
            $data['pricingModeVal'] = "default";
        }
        return $data;
    }

    public function createDiskListHtml($diskDetail, $LANG)
    {
        $html = ' <table id="clientAreaIpmang" class="display" style="width:100%">
        <thead>
            <tr>
                <th>' . $LANG["disk_id"] . '</th>
                <th>' . $LANG["type"] . '</th>
                <th>' . $LANG["disk_size"] . '</th>
                <th>' . $LANG["disk_bandwidth"] . '</th>
                <th>' . $LANG["disk_threshhold"] . '</th>
                <th>' . $LANG["disk_state"] . '</th>
            </tr>
        </thead>
        <tbody>
        ';
        foreach ($diskDetail as $key => $sdisktInfo) {
            $html .= '
                                <tr>
                                    <td>' . $sdisktInfo->id . '</td>
                                    <td>' . $sdisktInfo->type . ' </td>
                                    <td>' . $sdisktInfo->size . '</td>
                                    <td>' . $sdisktInfo->bandwidthLimit . ' </td>
                                    <td>' . $sdisktInfo->lowFreeSpaceThreshold . '</td>';
            if ($sdisktInfo->state == "connected") {
                $html .= '<td class="badge badge-success mt-2 p-1">' . $LANG["disk_connected"] . ' </td>';
            } elseif ($sdisktInfo->state == "disconnected") {
                $html .= '<td class="badge badge-danger mt-2 p-1">' . $LANG["disk_disconnected"] . ' </td>';
            } else {
                $html .= '<td class="badge badge-warning mt-2 p-1">' . $LANG["disk_pending"] . ' </td>';
            }
            $html .= '</tr>';
        }
        $html .= '</tbody>
    </table>';
        return $html;
    }
 
    public function createAdditionalIpInvoice($userId, $quantity, $additionalIpPrice)
    {
        $additionalIpTotal = $additionalIpPrice->additionalIPprice * $quantity;
        $command = 'CreateInvoice';
        $postData = array(
            'userid' => $userId,
            'status' => 'Unpaid',
            'paymentmethod' => 'mailin',
            'itemdescription1' => "Additional ip $additionalIpPrice->additionalIPprice*$quantity = $additionalIpTotal",
            'itemamount1' => $additionalIpTotal,
        );
        $results = localAPI($command, $postData);
        return $results;
    }
    public function InsertIpData($table_name, $data)
    {
        try {
            $response = Capsule::table($table_name)->insert($data);
            return $response;
        } catch (Exception $e) {
            throw new \Exception('Error in inserting/updating data: ' . $e->getMessage());
        }
    }


    public function createInvoice($userId, $price, $description)
    {
        try {
            $postData = [
                'userid' => $userId,
                'status' => 'Unpaid',
                'paymentmethod' => 'mailin',
                'itemdescription1' => $description,
                'itemamount1' => (string) $price,
            ];
            $results = localAPI("CreateInvoice", $postData);
            return $results;
        } catch (\Throwable $th) {
            //throw $th;
        }
    }
}
