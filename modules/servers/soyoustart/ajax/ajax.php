<?php



require_once dirname(dirname(dirname(dirname(__DIR__)))) . "/init.php";

require_once dirname(dirname(dirname(__DIR__))) . "/addons/soyoustart/classes/ApiCall.php";



use \WGSModule\Soyoustart\classes\ApiCall;



global $whmcs;

$apiCall = new ApiCall();



if ($whmcs->get_req_var("getCompatibleOS") == "getCompatibleOS") {





    $ovhServerName = $whmcs->get_req_var("ovhServerName");

    $accountId = $whmcs->get_req_var("accountId");

    $location = $whmcs->get_req_var("location");



    $compatibleOs = $apiCall->get("/dedicated/server/{$ovhServerName}/install/compatibleTemplates", $accountId, $location, "Getting compatible OS", true);

    $installationStatus = $apiCall->get("/dedicated/server/{$ovhServerName}/install/status", $accountId, $location, "Getting installation status", true);

    $html = '';

    foreach ($compatibleOs["result"]->ovh  as $value) {

        $html .= '<option value="' . $value . '">' . ucfirst(str_replace('-', " ", str_replace('_', " ", $value))) . '</option>';

    }

    echo json_encode(["html" => $html, "installationStatus" => $installationStatus]);

    exit;

} elseif ($whmcs->get_req_var("installOs") == "installOs") {



    $location = $whmcs->get_req_var("location");

    $accountId = $whmcs->get_req_var("accountId");

    $ovhServerName = $whmcs->get_req_var("ovhServerName");



    $response = $apiCall->post("/dedicated/server/{$ovhServerName}/install/start", $accountId, $location, ["templateName" => $whmcs->get_req_var("templateName")], "reinstalling os", true);

    if($response["httpcode"] == 200){

        $_SESSION["installationTaskId"] = $response["result"]->taskId;

    }

    echo json_encode($response);

    exit;

} 

elseif ($whmcs->get_req_var("cancleReinstallation") == "cancleReinstallation") {



    $location = $whmcs->get_req_var("location");

    $accountId = $whmcs->get_req_var("accountId");

    $ovhServerName = $whmcs->get_req_var("ovhServerName");



    $taskId = (!isset($_SESSION["installationTaskId"])? 12345 :$_SESSION["installationTaskId"]);

    $response = $apiCall->post("/dedicated/server/{$ovhServerName}/task/{$taskId}/cancel", $accountId, $location, [], "Cancel Re-intallation", true);



    echo json_encode($response);

    exit;

} 





elseif ($whmcs->get_req_var("getInstallationStatus") == "getInstallationStatus") {



    $location = $whmcs->get_req_var("location");

    $accountId = $whmcs->get_req_var("accountId");

    $ovhServerName = $whmcs->get_req_var("ovhServerName");



    $installationStatus = $apiCall->get("/dedicated/server/{$ovhServerName}/install/status", $accountId, $location, "Getting installation status", true);

    if($installationStatus["httpcode"] != 200){

        unset($_SESSION["installationTaskId"]);

    }

    echo json_encode($installationStatus);

    exit;

} 

elseif ($whmcs->get_req_var("iPaction") == "getFirewallRules") {





    $accountId = $whmcs->get_req_var("accountId");

    $location = $whmcs->get_req_var("location");

    $ipblock = urlencode($whmcs->get_req_var("ipblock"));

                  

    $ipReverse = str_replace("::", "", explode("/", $whmcs->get_req_var("ipblock")));

    $endPoint = "/ip/{$ipblock}/firewall/{$ipReverse["0"]}/rule";

    $response = $apiCall->get($endPoint, $accountId, $location, "getting firewall rules", true);





    if ($response["httpcode"] != 200) {

        echo json_encode($response);

        exit;

    }

    $html = [];

    foreach ($response["result"] as $value) {

        $endPoint = "/ip/{$ipblock}/firewall/{$ipReverse["0"]}/rule/{$value}";

        $response = $apiCall->get($endPoint, $accountId, $location, "getting firewall rules", true);

        $state = '-';

        $action = "";

        if ($response["result"]->state == "ok") {

            $state = "<span class=\"badge bg-success\">Active</span>";

            $action = "<i class=\"fas fa-trash-alt deleteFirewallRule\"></i>";

        } elseif ($response["result"]->state == "creationPending") {

            $state = "<span class=\"badge bg-secondary\">Creating</span>";

        } else {

            $state = "<span class=\"badge bg-danger\">Deleting</span>";

        }



        $html[] = [

            "sequence" => $response["result"]->sequence,

            "action" => strtoupper($response["result"]->action),

            "protocol" => strtoupper($response["result"]->protocol),

            "destination" => $response["result"]->destination,

            "sourcePort" => (is_null($response["result"]->sourcePort) ? "-" : $response["result"]->sourcePort),

            "destinationPort" => is_null($response["result"]->destinationPort) ? "-" : $response["result"]->destinationPort,

            "tcpOption" => ($response["result"]->fragments) ? "Fragments" : "-",

            "state" => $state,

            "delete" => $action,

        ];

    }



    echo json_encode(["data" => $html]);

    exit;

} 

