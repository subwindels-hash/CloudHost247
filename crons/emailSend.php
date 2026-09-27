<?php
$whmcspath = "";
if (file_exists(dirname(__FILE__) . "/config.php"))
    require_once dirname(__FILE__) . "/config.php";
if (!empty($whmcspath)) {
    require_once $whmcspath . "/init.php";
    if (file_exists($whmcspath . '/modules/addons/soyoustart/classes/ApiCall.php')) {
        require_once($whmcspath . '/modules/addons/soyoustart/classes/ApiCall.php');
    } else {
        logActivity('OVH Cron error, File (/modules/addons/soyoustart/classes/ApiCall.php) not found');
    }
} else {
    require(__DIR__ . "/../init.php");
    if (file_exists(__DIR__ . '/../modules/addons/soyoustart/classes/ApiCall.php'))
        require_once(__DIR__ . '/../modules/addons/soyoustart/classes/ApiCall.php');
    else
        logActivity('OVH Cron error, File (/modules/addons/soyoustart/classes/ApiCall.php) not found');
}

use \WHMCS\Module\Addon\Soyoustart\Helper;
use \WGSModule\Soyoustart\classes\ApiCall;
use WHMCS\Database\Capsule;

/*  
remove existing email ids from mod_soyoustart_seenMessage table 

$valuesToRemove = [
    "<392ee04be34bbe1c3b08c3468214594a.lost-emails@undelivered-ca.ovh.ca>",
    "<50857a9edf2b89ea9323c0f4e68f7406.lost-emails@undelivered-ca.ovh.ca>"
];

// Fetch current record
$record = Capsule::table('mod_soyoustart_seenMessage')->where(['id' => 1])->first();

if ($record) {
    $currentValues = json_decode($record->value, true);
    
    // Remove specified values (non-strict)
    $filteredValues = array_values(array_diff($currentValues, $valuesToRemove));
    
    // Update the record
    Capsule::table('mod_soyoustart_seenMessage')
    ->where(['id' => 1])
    ->update([
        'value' => json_encode($filteredValues),
        'updated_at' => date('Y-m-d H:i:s'),
    ]);
    
    echo "Successfully removed values.";
} else {
    echo "Record not found.";
}

$record = Capsule::table('mod_soyoustart_seenMessage')->where(['id' => 1])->first();
echo "<pre>";
print_r($record);
echo "</pre>";
exit;



*/


/* getting data */

if (!Capsule::schema()->hasTable('mod_soyoustart_seenMessage')) {
    Capsule::schema()->create(
        'mod_soyoustart_seenMessage',
        function ($table) {
            $table->increments('id');
            $table->longText('value');
            $table->timestamp('created_at')->useCurrent();
            $table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();
        }
    );
}
$helper = new Helper();
$apiCall = new ApiCall();
try {
    $helper->insert_update("tblconfiguration", ['setting' => 'emailSendcronstatus'], ['value' => 'Configured', 'setting' => 'emailSendcronstatus', "updated_at" => date('Y-m-d H:i:s')]);
    /* getting all services related to soyoustart and soyoustart_vps server */
    $allServices = $helper->getAllServerPackages();
    if (!isset($allServices[0])) {
        logActivity("No active services found with soyoustart server module!");
        return;
    }
    $configuredImapData = Capsule::table('mod_soyoustart_imap')->whereIN("status", [1, "Active"])->get()->toArray();
    $aclSettings = Capsule::table('mod_acl_settings')->select("value")->where("key", "imap_aclSettings")->first();
    $aclSettings = json_decode($aclSettings->value, true);




    foreach ($configuredImapData as $key => $value) {

        if (!empty($value->soyouimaphost)) {
            // $userName = openssl_decrypt($value->soyouimapuser, "AES-256-CBC", "encryptionKey1234567891234567", 0, 1234567891011121);
            // $password = openssl_decrypt($value->soyouimappass, "AES-256-CBC", "encryptionKey1234567891234567", 0, 1234567891011121);

            $key = "encryptionKey1234567891234567";
            $iv  = "1234567891011121";

            $userName = openssl_decrypt(
                $value->soyouimapuser,
                "AES-256-CBC",
                $key,
                0,
                $iv
            );

            $password = openssl_decrypt(
                $value->soyouimappass,
                "AES-256-CBC",
                $key,
                0,
                $iv
            );
            $hostname = $value->soyouimaphost;
            $port = $value->soyouimapport;
            $layer = $value->soyouimapssl;
            $certvalidate = 'novalidate-cert';
            $url = '{' . $hostname . ':' . $port . '/imap/' . $layer . '/' . $certvalidate . '}INBOX';
            $inbox = \imap_open($url, $userName, $password, OP_READONLY);
            if ($inbox) {
                $emailData = imap_search($inbox, 'UNSEEN');

                if (!empty($emailData)) {
                    foreach ($emailData as $msg) {

                        $hdr_raw = imap_fetchheader($inbox, $msg);
                        $header = imap_rfc822_parse_headers($hdr_raw);
                        $structure = imap_fetchstructure($inbox, $msg);
                        $subject = '';
                        if (!empty($header->subject)) {
                            $subject = iconv_mime_decode(
                                $header->subject,
                                0,
                                "UTF-8"
                            );
                        }

                        $header->subject = $subject;
                        $body = '';
                        if (!empty($structure->parts)) {

                            foreach ($structure->parts as $index => $part) {

                                $partNumber = $index + 1;

                                $subtype = strtoupper($part->subtype ?? '');

                                if ($subtype == 'HTML' || $subtype == 'PLAIN') {

                                    $body = imap_fetchbody(
                                        $inbox,
                                        $msg,
                                        $partNumber
                                    );

                                    // BASE64
                                    if ($part->encoding == 3) {

                                        $body = base64_decode($body);

                                        // QUOTED PRINTABLE
                                    } elseif ($part->encoding == 4) {

                                        $body = quoted_printable_decode($body);
                                    }

                                    break;
                                }
                            }
                        } else {

                            $body = imap_body($inbox, $msg);

                            if ($structure->encoding == 3) {

                                $body = base64_decode($body);
                            } elseif ($structure->encoding == 4) {

                                $body = quoted_printable_decode($body);
                            }
                        }

                        /*
                        |--------------------------------------------------------------------------
                        | Clean Body
                        |--------------------------------------------------------------------------
                        */

                        $body = strip_tags($body);

                        $body = html_entity_decode(
                            $body,
                            ENT_QUOTES | ENT_HTML5,
                            'UTF-8'
                        );

                        $body = trim($body);

        
                        /* inserting the email id if Email seen*/
                        $isSeen = $helper->get_data("mod_soyoustart_seenMessage", ["id" => 1], "first");
                        if (isset($isSeen->id)) {
                            $seenIds = json_decode($isSeen->value, true);
                            if (!in_array($header->message_id, $seenIds)) {
                                $seenIds[] = $header->message_id;
                            } else {
                                continue;
                            }
                            $helper->insert_update("mod_soyoustart_seenMessage", ["id" => 1], ["value" => json_encode($seenIds)]);
                        } else {
                            $helper->insert_update("mod_soyoustart_seenMessage", ["id" => 1], ["value" => json_encode([$header->message_id])]);
                        }
                        /* end of inserting the email id if Email seen*/
                        foreach ($allServices as $service) {
                            // if ((str_contains($header->subject, $service->ovh_server_name) || str_contains($body, $service->ovh_server_name))) {
                            if (!empty($service->ovh_server_name) && (stripos($header->subject, $service->ovh_server_name) !== false || stripos($body, $service->ovh_server_name) !== false)) {
                                $accountId = $service->accountInfo->id;
                                $location = $service->accountInfo->location;
                                $ovhCustomHostname = $service->ovh_custom_hostname;
                                if (str_contains($header->subject, "Password change")) {
                                    $ftpServer = seachData($body, "FTP server:");
                                    $password = seachData($body, "Password:");
                                    $postData = ["ftp_server_name" => $ftpServer, "new_password" => $password];
                                    $sendEmailResponse = sendEmail("Ftp Backup Password change", $service->clientid, base64_encode(serialize($postData)));
                                    $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "Ftp Backup Password change"];
                                    insertLog("mod_soyoustart_email_log", $data);
                                } elseif (str_contains($header->subject, "Additional IP addresses")) {
                                    if (!isset($aclSettings["AdditionalIPaddresses"]) || $aclSettings["AdditionalIPaddresses"] == "") {
                                        $ipAddress = seachData($body, "additional IPs:", true);
                                        $postData = ["ipaddress" => $ipAddress];
                                        $sendEmailResponse = sendEmail("Additional IP addresses", $service->clientid, base64_encode(serialize($postData)));
                                        $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "Additional IP addresses"];
                                        insertLog("mod_soyoustart_email_log", $data);
                                    }
                                } elseif (str_contains($header->subject, "Anti-hack")) {
                                    if (!isset($aclSettings["Anti-hack"]) || $aclSettings["Anti-hack"] == "") {
                                        $pattern = '/START OF ADDITIONAL INFO(.*?)END OF ADDITIONAL INFO/s';
                                        preg_match($pattern, $body, $matches);
                                        $additionalInfo = isset($matches[1]) ? trim($matches[1]) : '';
                                        $additionalInfo = nl2br(htmlspecialchars($additionalInfo, ENT_QUOTES));
                                        $postData = ["detail" => $additionalInfo];
                                        $sendEmailResponse = sendEmail("Anti-hack", $service->clientid, base64_encode(serialize($postData)));
                                        $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "Anti-hack"];
                                        insertLog("mod_soyoustart_email_log", $data);
                                    }
                                } elseif (str_contains($header->subject, "Detection of an attack on IP address")) {
                                    if (!isset($aclSettings["DetectionofanattackonIPaddress"]) || $aclSettings["DetectionofanattackonIPaddress"] == "") {
                                        $ipAddress = seachData($body, "IP address");
                                        $postData = ["ipaddress" => $ipAddress];
                                        $sendEmailResponse = sendEmail("Detection of an attack on IP", $service->clientid, base64_encode(serialize($postData)));
                                        $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "Detection of an attack on IP"];
                                        insertLog("mod_soyoustart_email_log", $data);
                                    }
                                }
                                // } elseif (str_contains($header->subject, "Installation of your") || str_contains($header->subject, "Install of your VPS")) {
                                //     if (!isset($aclSettings["Installationofyouserver"]) || $aclSettings["Installationofyouserver"] == "") {
                                //         // $ipAddress = seachData($body, "IP address: ") == '' ? seachData($body, "IPv4 address: ") : "";   
                                //         // $userName = seachData($body, "user: ") == '' ? seachData($body, "Username: ") : "";
                                //         $ipAddress = seachData($body, "IP address: ");

                                //         if (empty($ipAddress)) {
                                //             $ipAddress = seachData($body, "IPv4 address: ");
                                //         }

                                //         $userName = seachData($body, "user: ");

                                //         if (empty($userName)) {
                                //             $userName = seachData($body, "Username: ");
                                //         }
                                //         $password = seachData($body, "password: ");
                                //         if (!$password) {
                                //             $parts = explode("Your password must be generated using this link:", $body);
                                //             if (count($parts) > 1) {
                                //                 $afterPhrase = trim($parts[1]);
                                //                 $words = explode(" ", $afterPhrase);
                                //                 foreach ($words as $word) {
                                //                     if (strpos($word, "https://") === 0) {
                                //                         $password = "Your password must be generated using this link: $word This link is valid for 30 days following receipt of this email. Once the link is opened, the validity period will be reduced to 7 days.";
                                //                         break;
                                //                     }
                                //                 }
                                //             }
                                //         }
                                //         $postData = ["server_ipaddress" => $ipAddress, "server_username" => $userName, "server_password" => $password];
                                //         $sendEmailResponse = sendEmail("Server Details", $service->clientid, base64_encode(serialize($postData)));
                                //         $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "Ftp Backup Password change"];
                                //         insertLog("mod_soyoustart_email_log", $data);
                                //     }
                                // } 

                                elseif (str_contains($header->subject, "Installation of your") || str_contains($header->subject, "Install of your VPS")) {
                                    if (!isset($aclSettings["Installationofyouserver"]) || $aclSettings["Installationofyouserver"] == "") {
                                        // $ipAddress = seachData($body, "IP address: ") == '' ? seachData($body, "IPv4 address: ") : "";   
                                        // $userName = seachData($body, "user: ") == '' ? seachData($body, "Username: ") : "";
                                        $ipAddress = seachData($body, "IP address: ");

                                        if (empty($ipAddress)) {
                                            $ipAddress = seachData($body, "IPv4 address: ");
                                        }

                                        $userName = seachData($body, "user: ");

                                        if (empty($userName)) {
                                            $userName = seachData($body, "Username: ");
                                        }
                                        $password = seachData($body, "password: ");
                                        if (!$password) {
                                            $parts = explode("Please generate your password using:", $body);
                                            if (count($parts) > 1) {
                                                $afterPhrase = trim($parts[1]);
                                                $words = explode(" ", $afterPhrase);
                                                foreach ($words as $word) {
                                                    if (strpos($word, "https://") === 0) {
                                                        $password = "Please generate your password using: $word This link is valid for 30 days following receipt of this email. Once the link is opened, the validity period will be reduced to 7 days.";
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                        $postData = ["server_ipaddress" => $ipAddress, "server_username" => $userName, "server_password" => $password];
                                        $sendEmailResponse = sendEmail("Server Details", $service->clientid, base64_encode(serialize($postData)));
                                        $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "Ftp Backup Password change"];
                                        insertLog("mod_soyoustart_email_log", $data);
                                    }
                                } elseif (str_contains($header->subject, "End of attack")) {
                                    if (!isset($aclSettings["EndofattackonIPaddress"]) || $aclSettings["EndofattackonIPaddress"] == "") {
                                        $ipAddress = seachData($body, "IP address");
                                        $postData = base64_encode(serialize(array("ipaddress" => $ipAddress)));
                                        $sendEmailResponse = sendEmail("End of Attack", $service->clientid, $postData);
                                        $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "End of attack"];
                                        insertLog("mod_soyoustart_email_log", $data);
                                    }
                                } elseif (str_contains($header->subject, "Rescue mode access")) {
                                    if (!isset($aclSettings["ParametersofRESCUEmodeaccess"]) || $aclSettings["ParametersofRESCUEmodeaccess"] == "") {
                                        $userName = seachData($body, "username:");
                                        $password = seachData($body, "Password:");
                                        $postData = base64_encode(serialize(array("username" => $userName, "password" => $password)));
                                        $sendEmailResponse = sendEmail("BSD10 Rescue mode", $service->clientid, $postData);
                                        $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "BSD10 Rescue mode"];
                                        insertLog("mod_soyoustart_email_log", $data);
                                    }
                                } elseif (str_contains($header->subject, "Spam detected")) {
                                    if (!isset($aclSettings["SpamdetectedfromyourIPaddress"]) || $aclSettings["SpamdetectedfromyourIPaddress"] == "") {
                                        $ipAddress = seachData($body, "IP address: ");
                                        $detectedDetail = trim(explode("If you identified and fixed the spam issue", explode("some advanced details on your emails:", $body)[1])[0]);
                                        $otherDetailsLines = explode(PHP_EOL, $detectedDetail);
                                        $otherDetailsText = '';
                                        foreach ($otherDetailsLines as $key => $otherDetailsLine) {
                                            if (!empty($otherDetailsLine) &&  ($key <= 80)) {
                                                $otherDetailsText .= $otherDetailsLine . '</br>';
                                            }
                                        }
                                        $postData = base64_encode(serialize(array("ipaddress" => $ipAddress, "detected_detail" => $otherDetailsText)));
                                        $sendEmailResponse = sendEmail("Spam Detected", $service->clientid, $postData);
                                        $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "Spam Detected"];
                                        insertLog("mod_soyoustart_email_log", $data);
                                    }
                                } elseif (str_contains($header->subject, "Hardware reboot")) {
                                    if (!isset($aclSettings["Hardwarereboot"]) || $aclSettings["Hardwarereboot"] == "") {
                                        $serverName = rtrim(seachData($body, "your server"), ".");
                                        $serverInfo = $apiCall->get("/dedicated/server/{$serverName}", $accountId, $location, "getting server details", true);
                                        if ($serverInfo["httpcode"] != 200) {
                                            logActivity($emailData["result"]->message . ", account(" . $service->ovh_account . "), service Id(" . $service->id . "), email Id(" . $emailId . ")");
                                            continue;
                                        }
                                        $osName = $serverInfo["result"]->os;
                                        $osName = ucfirst(str_replace("_", " ", $osName));
                                        $postData = base64_encode(serialize(array("custom_server_name" => $ovhCustomHostname, "operating_system" => $osName)));
                                        $sendEmailResponse = sendEmail("Hardware Reboot", $service->clientid, $postData);
                                        $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "Hardware reboot"];
                                        insertLog("mod_soyoustart_email_log", $data);
                                    }
                                } elseif (str_contains($header->subject, "Access settings for RESCUE mode")) {
                                    $ipAddress = rtrim(seachData($body, "IP:"), ".");
                                    $userName = rtrim(seachData($body, "user:"), ".");
                                    $password = rtrim(seachData($body, "Password:"), ".");
                                    $postData = base64_encode(serialize(array("ipaddress" => $ipAddress, "username" => $userName, "password" => $password)));
                                    $sendEmailResponse = sendEmail("Rescue-Pro Mode", $service->clientid, $postData);
                                    $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "Rescue-Pro Mode"];
                                    insertLog("mod_soyoustart_email_log", $data);
                                }
                            }
                        }
                    }
                }
            } else {
                logActivity("Email send cron errors: " . imap_last_error());
                return;
            }
        } else {

            $url = 'https://oauth2.googleapis.com/token';
            $data = [
                "client_id" => trim($value->gmail_clientId),
                "client_secret" => trim($value->gmail_secretkey),
                "grant_type" => "refresh_token",
                "refresh_token" => $value->refereshtoken,
            ];
            $response = $helper->getAccessToken($url, $data);
            if ($response["httpcode"] != 200) {
                logActivity("Error while fetching access token for account(" . $value->account_user . ") with email(" . $value->gmailaddr . "). Error: " . $response["result"]->error . " : " . $response["result"]->error_description);
                continue;
            }

            $accessToken = $response["result"]->access_token;
            if (!empty($accessToken)) {
                $test =  $helper->insert_update("mod_soyoustart_imap", $where = ["id" => $value->id], ["accesstoken" => $accessToken]);
                $accessToken = trim($accessToken);
                /* getting all messsages after 2024/03/20*/
                $date = new DateTime();
                $date->modify('-1 day');
                $todayDate = $date->format('Y/m/d');
                $queryParam = urlencode("in:inbox after:$todayDate");
                $apiUrl = "https://gmail.googleapis.com/gmail/v1/users/me/messages?q={$queryParam}";
                $allMessageIds = gmailApiCall("GET", $apiUrl, $accessToken, "getting all messages");
                if ($allMessageIds["httpcode"] != 200) {
                    /* need to store error message in log */
                    logActivity($allEmailIds["result"]->message . ", account(" . $service->ovh_account . "), service id(" . $service->id . ")");
                    continue;
                }
                foreach ($allMessageIds["result"]->messages as $message) {

                    /* inserting the email id if Email seen*/
                    $isSeen = $helper->get_data("mod_soyoustart_seenMessage", ["id" => 1], "first");

                    if (isset($isSeen->id)) {
                        $seenIds = json_decode($isSeen->value, true);
                        if (!in_array($message->id, $seenIds)) {
                            $seenIds[] = $message->id;
                        } else {
                            continue;
                        }
                        $helper->insert_update("mod_soyoustart_seenMessage", ["id" => 1], ["value" => json_encode($seenIds)]);
                    } else {
                        $helper->insert_update("mod_soyoustart_seenMessage", ["id" => 1], ["value" => json_encode([$message->id])]);
                    }
                    /* end of inserting the email id if Email seen*/

                    /* getting email contant of message id */
                    $apiUrl = "https://gmail.googleapis.com/gmail/v1/users/me/messages/{$message->id}?fields=payload";
                    $emailContent = gmailApiCall("GET", $apiUrl, $accessToken, "getting email content");
                    if ($emailContent["httpcode"] != 200) {
                        /* need to store error message in log */
                        logActivity($allEmailIds["result"]->message . ", account(" . $service->ovh_account . "), service id(" . $service->id . ")");
                        continue;
                    }

                    foreach ($emailContent["result"]->payload->headers as $header) {
                        if ($header->name == "Subject") {
                            foreach ($allServices as $service) {
                                /* reading message */
                                $messaage = $emailContent["result"]->payload->parts[0]->body;
                                $sanitizedData = strtr($messaage->data, '-_', '+/');
                                $decodedMessage = base64_decode($sanitizedData);
                                if ((str_contains($header->value, $service->ovh_server_name) || str_contains($decodedMessage, $service->ovh_server_name))) {
                                    $accountId = $service->accountInfo->id;
                                    $location = $service->accountInfo->location;
                                    $ovhCustomHostname = $service->ovh_custom_hostname;
                                    if (str_contains($header->value, "Password change")) {
                                        $ftpServer = seachData($decodedMessage, "FTP server:");
                                        $password = seachData($decodedMessage, "Password:");
                                        $postData = ["ftp_server_name" => $ftpServer, "new_password" => $password];
                                        $sendEmailResponse = sendEmail("Ftp Backup Password change", $service->clientid, base64_encode(serialize($postData)));
                                        $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "Ftp Backup Password change"];
                                        insertLog("mod_soyoustart_email_log", $data);
                                    } elseif (str_contains($header->value, "Installation of your")) {
                                        if (!isset($aclSettings["Installationofyouserver"]) || $aclSettings["Installationofyouserver"] == "") {
                                            $ipAddress = seachData($decodedMessage, "IP address: ");
                                            $password = seachData($decodedMessage, "Password:");
                                            $postData = ["ftp_server_name" => $ftpServer, "new_password" => $password];
                                            $sendEmailResponse = sendEmail("Ftp Backup Password change", $service->clientid, base64_encode(serialize($postData)));
                                            $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "Ftp Backup Password change"];
                                            insertLog("mod_soyoustart_email_log", $data);
                                        }
                                    } elseif (str_contains($header->value, "End of attack")) {
                                        if (!isset($aclSettings["EndofattackonIPaddress"]) || $aclSettings["EndofattackonIPaddress"] == "") {
                                            $ipAddress = seachData($decodedMessage, "IP address: ");
                                            $postData = base64_encode(serialize(array("ipaddress" => $ipAddress)));
                                            $sendEmailResponse = sendEmail("End of Attack", $service->clientid, $postData);
                                            $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "End of Attack"];
                                            insertLog("mod_soyoustart_email_log", $data);
                                        }
                                    } elseif (str_contains($header->value, "Rescue mode access")) {
                                        if (!isset($aclSettings["ParametersofRESCUEmodeaccess"]) || $aclSettings["ParametersofRESCUEmodeaccess"] == "") {
                                            $userName = seachData($decodedMessage, "username:");
                                            $password = seachData($decodedMessage, "Password:");
                                            $postData = base64_encode(serialize(array("username" => $userName, "password" => $password)));
                                            $sendEmailResponse = sendEmail("BSD10 Rescue mode", $service->clientid, $postData);
                                            $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "BSD10 Rescue mode"];
                                            insertLog("mod_soyoustart_email_log", $data);
                                        }
                                    } elseif (str_contains($header->value, "Detection of an attack on IP")) {
                                        if (!isset($aclSettings["DetectionofanattackonIPaddress"]) || $aclSettings["DetectionofanattackonIPaddress"] == "") {
                                            $ipAddress = seachData($decodedMessage, "IP address: ");
                                            $postData = base64_encode(serialize(array("ipaddress" => $ipAddress)));
                                            $sendEmailResponse = sendEmail("Detection of an attack", $service->clientid, $postData);
                                            $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "Detection of an attack"];
                                            insertLog("mod_soyoustart_email_log", $data);
                                        }
                                    } elseif (str_contains($header->value, "Spam detected")) {
                                        if (!isset($aclSettings["SpamdetectedfromyourIPaddress"]) || $aclSettings["SpamdetectedfromyourIPaddress"] == "") {
                                            $ipAddress = seachData($decodedMessage, "IP address: ");
                                            $detectedDetail = trim(explode("If you identified and fixed the spam issue", explode("some advanced details on your emails:", $decodedMessage)[1])[0]);
                                            $otherDetailsLines = explode(PHP_EOL, $detectedDetail);
                                            $otherDetailsText = '';
                                            foreach ($otherDetailsLines as $key => $otherDetailsLine) {
                                                if (!empty($otherDetailsLine) &&  ($key <= 80)) {
                                                    $otherDetailsText .= $otherDetailsLine . '</br>';
                                                }
                                            }
                                            $postData = base64_encode(serialize(array("ipaddress" => $ipAddress, "detected_detail" => $otherDetailsText)));
                                            $sendEmailResponse = sendEmail("Spam Detected", $service->clientid, $postData);
                                            $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "Spam detected"];
                                            insertLog("mod_soyoustart_email_log", $data);
                                        }
                                    } elseif (str_contains($header->value, "Additional IP addresses")) {
                                        if (!isset($aclSettings["AdditionalIPaddresses"]) || $aclSettings["AdditionalIPaddresses"] == "") {
                                            $ipAddress = seachData($decodedMessage, "additional IPs:", true);
                                            $postData = ["ipaddress" => $ipAddress];
                                            $sendEmailResponse = sendEmail("Additional IP addresses", $service->clientid, base64_encode(serialize($postData)));
                                            $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "Additional IP addresses"];
                                            insertLog("mod_soyoustart_email_log", $data);
                                        }
                                    } elseif (str_contains($header->value, "Anti-hack")) {
                                        if (!isset($aclSettings["Anti-hack"]) || $aclSettings["Anti-hack"] == "") {
                                            $pattern = '/START OF ADDITIONAL INFO(.*?)END OF ADDITIONAL INFO/s';
                                            preg_match($pattern, $decodedMessage, $matches);
                                            $additionalInfo = isset($matches[1]) ? trim($matches[1]) : '';
                                            $additionalInfo = nl2br(htmlspecialchars($additionalInfo, ENT_QUOTES));
                                            $postData = ["detail" => $additionalInfo];
                                            $sendEmailResponse = sendEmail("Anti-hack", $service->clientid, base64_encode(serialize($postData)));
                                            $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "Anti-hack"];
                                            insertLog("mod_soyoustart_email_log", $data);
                                        }
                                    } elseif (str_contains($header->value, "Hardware reboot")) {
                                        if (!isset($aclSettings["Hardwarereboot"]) || $aclSettings["Hardwarereboot"] == "") {
                                            $serverName = rtrim(seachData($decodedMessage, "your server"), ".");
                                            $serverInfo = $apiCall->get("/dedicated/server/{$serverName}", $accountId, $location, "getting server details", true);
                                            if ($serverInfo["httpcode"] != 200) {
                                                logActivity($emailData["result"]->message . ", account(" . $service->ovh_account . "), service Id(" . $service->id . "), email Id(" . $emailId . ")");
                                                continue;
                                            }
                                            $osName = $serverInfo["result"]->os;
                                            $osName = ucfirst(str_replace("_", " ", $osName));
                                            $postData = base64_encode(serialize(array("custom_server_name" => $ovhCustomHostname, "operating_system" => $osName)));
                                            $sendEmailResponse = sendEmail("Hardware Reboot", $service->clientid, $postData);
                                            $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "Hardware reboot"];
                                            insertLog("mod_soyoustart_email_log", $data);
                                        }
                                    } elseif (str_contains($emailData["result"]->subject, "Access settings for RESCUE mode")) {
                                        $ipAddress = rtrim(seachData($decodedMessage, "IP:"), ".");
                                        $userName = rtrim(seachData($decodedMessage, "user:"), ".");
                                        $password = rtrim(seachData($decodedMessage, "Password:"), ".");
                                        $postData = base64_encode(serialize(array("ipaddress" => $ipAddress, "username" => $userName, "password" => $password)));
                                        $sendEmailResponse = sendEmail("Rescue-Pro Mode", $service->clientid, $postData);
                                        $data = ["datetime" => date("Y/m/d h:i"), "account_user" => $service->ovh_account . "(" . $service->ovh_server_location . ")", "email" => $service->email, "language" => "English", "email_subject" => "Rescue-Pro Mode"];
                                        insertLog("mod_soyoustart_email_log", $data);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
} catch (\Exception $e) {
    logActivity('Cron Error: Email send(' . $e->getMessage() . ')');
}
logActivity('Email send cron completed');
function gmailApiCall($method, $apiUrl, $accessToken, $action, $data = [])
{
    $curl = curl_init();
    switch ($method) {
        case 'POST':
            curl_setopt($curl, CURLOPT_POST, 1);
            curl_setopt($curl, CURLOPT_POSTFIELDS, (count($data) ? json_encode($data) : ""));
            break;
        case 'PUT':
            curl_setopt($curl, CURLOPT_POSTFIELDS, (count($data) ? json_encode($data) : ""));
            break;
        case 'DELETE':
            curl_setopt($curl, CURLOPT_CUSTOMREQUEST, 'DELETE');
            curl_setopt($curl, CURLOPT_POSTFIELDS, (count($data) ? json_encode($data) : ""));
            break;
        default:
            curl_setopt($curl, CURLOPT_CUSTOMREQUEST, 'GET');
    }
    curl_setopt($curl, CURLOPT_URL, $apiUrl);
    curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($curl, CURLOPT_CONNECTTIMEOUT, 0);
    curl_setopt($curl, CURLOPT_MAXREDIRS, 10);
    curl_setopt($curl, CURLOPT_FOLLOWLOCATION, 1);
    curl_setopt($curl, CURLOPT_HTTP_VERSION, CURL_HTTP_VERSION_1_1);
    curl_setopt($curl, CURLOPT_HTTPHEADER, array(
        'Accept: application/json',
        'Authorization: Bearer ' . $accessToken
    ));
    $response = curl_exec($curl);
    $httpCode = curl_getinfo($curl, CURLINFO_HTTP_CODE);
    if (curl_errno($curl)) {
        throw new \Exception(curl_error($curl));
    }
    curl_close($curl);
    return ['httpcode' => $httpCode, 'result' => json_decode($response)];
}
function sendEmail($template, $clientId, $customVars)
{
    try {
        $postData = array(
            'messagename' => $template,
            'id' => $clientId,
            'customvars' => $customVars,
        );
        $results = localAPI("SendEmail", $postData);
        logModuleCall("Soyoustart", "sending email for $template", $postData, $results);
        return $results;
    } catch (\Exception $e) {
        //throw $th;
    }
}
function getIpFromEmail($string)
{
    $ipPosition = strpos($string, "IP address");
    $ipAddress = false;
    if ($ipPosition !== false) {
        $ipStart = $ipPosition + strlen(" IP address");
        $ipEnd = strpos($string, " ", $ipStart);
        if ($ipEnd === false) {
            $ipEnd = strlen($string);
        }
        $ipAddress = substr($string, $ipStart, $ipEnd - $ipStart);
        $spacePosition = strpos($ipAddress, "\n");
        if ($spacePosition !== false) {
            $ipAddress = substr($ipAddress, 0, $spacePosition);
        }
        return $ipAddress;
    } else {
        return $ipAddress;
    }
}
function seachData($string, $searchString, $lineBreck = false)
{
    if ($lineBreck) {
        $pattern = '/\b(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/';
        preg_match_all($pattern, $string, $matches);
        $additionalIPs = array_unique($matches[0]);
        $ips = '';
        foreach ($additionalIPs as $ip) {
            $ips .= $ip . "\n";
        }
        return $ips;
    }
    $searchStringPosition = strpos($string, $searchString);
    $text = false;
    if ($searchStringPosition !== false) {
        $searchStrStart = $searchStringPosition + strlen($searchString);
        $searchStrEnd = strpos($string, "\n", $searchStrStart);
        if ($searchStrEnd == false) {
            $text = trim(substr($string, $searchStrStart));
            return $text;
        }
        $text = trim(substr($string, $searchStrStart, $searchStrEnd - $searchStrStart));
        return $text;
    } else {
        return $text;
    }
}
function insertLog($tableName, $data = [])
{
    try {
        return  Capsule::table($tableName)->insert($data);
    } catch (\Illuminate\Database\QueryException $ex) {
        return $ex->getMessage();
    } catch (Exception $e) {
        return $e->getMessage();
    }
}
