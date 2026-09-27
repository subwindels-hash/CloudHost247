<?php

namespace WGSModule\Soyoustart\classes;

use WHMCS\Module\Addon\Soyoustart\Helper;
use WHMCS\Database\Capsule;

class EmailTemplates extends Helper
{
    public function customEmailTempaltes()
    {
        try {
            return [
                [
                    "name" => "Hardware Reboot",
                    "type" => "general",
                    "subject" => "Hardware Reboot Notification",
                    "message" => 'Dear Customer,<br /><br /><span>You have requested a remote</span><span class="il">hardware</span><span></span><span class="il">reboot</span><span>for your server {$custom_server_name}.<br />We have successfully rebooted your Server.<br />Operating System : {$operating_system}<br /><br />.Thanks for using our service.<br /><br /><br /><br /></span>',
                    "custom" => "1",
                    "plaintext" => 0
                ],
                [
                    "type" => "general",
                    "name" => "Server Re-installed",
                    "subject" => "Server Installed Notification",
                    "message" => '<br /><span>Dear Customer,</span><br /><br /><span>We would like to thank you for choosing an dedicated</span><span class="il">server.<br /><br /></span>Your Server has been re-insalled successfully.Thenecessary Information for your Server are given below:-<br /><br /><div><span>IP address: {$ip_address}</span><br /><span class="il">Server</span><span>name: {$custom_server_name}<br />Operating System : {$operating_system}<br /></span></div> <div><br /><span>The following root account has been configured on the</span><span class="il">server</span><span>:<br /></span><br /><span>Username: {$custom_user_account}</span><br /><span>Password: {$new_password}</span><br /><br /></div>',
                    "custom" => 1,
                    "plaintext" => 0
                ],
                [
                    "type" => "general",
                    "name" => "Ftp Backup Password change",
                    "subject" => "Ftp Backup Password change",
                    "message" => '<span><br />Dear Customer,<br /><br />As per your request we are sending you this mail for the <strong>FTP Backup Password Changed</strong>.<br />This is to inform you that yo have successfully changed the password for your FTP Backup.<br /><br /><br /></span><div><span>You will find all the necessary information below:</span><br /><br /><strong>FTP Server</strong> : {$ftp_server_name}<br /><strong>New Password</strong> : {$new_password}</div>',
                    "custom" => 1,
                    "plaintext" => 0
                ],
                [
                    "type" => "general",
                    "name" => "FTP Backup Configured",
                    "subject" => "Backup FTP configured on your server",
                    "message" => '<br /><span>Dear Sir or Madam,</span><br /><br />Your FTP Backup has been successfully created .<br /><br /><div><span>Necessary information are below:<br /><br /><span>login: {$custom_server_name}</span><br /><span>password: {$new_password}</span><br /><span>FTP server: {$ftp_server_name}</span><br /></span></div>',
                    "custom" => 1,
                    "plaintext" => 0
                ],
                [
                    "type" => "general",
                    "name" => "Server Details",
                    "subject" => "Server Details",
                    "message" => '<span><br />Dear Customer,<br /><br /></span><div><span>Your Server Details:</span><br /><br /><strong>IP Address</strong> : {$server_ipaddress}<br /><strong>Username </strong> : {$server_username}<br /><strong>Password</strong> : {$server_password}<br /></div>',
                    "custom" => 1,
                    "plaintext" => 0
                ],
                [
                    "type" => "general",
                    "name" => "Rescue-Pro Mode",
                    "subject" => "Rescue-Pro Mode",
                    "message" => '<span><br />Dear Customer,<br /><br /></span>
                <div><span>Your server has been started in Rescue mode.<br /><br /> This mode means that a basic Linux/BSD system has been launched on your server through the network. This is not the system installed on your server and none of your disks have been mounted.</span><br /><br /><span>You may connect to your server through SSH with the following details: </span><br /><br /><strong> IP Address</strong> : {$ipaddress}<br /><strong> Username </strong> : {$username}<br /><strong> Password</strong> : {$password}</div>',
                    "custom" => 1,
                    "plaintext" => 0
                ],
                [
                    "type" => "general",
                    "name" => "BSD10 Rescue mode",
                    "subject" => "BSD10 Rescue mode",
                    "message" => '<span><br />Dear Customer,<br /><br /></span>
                <div><span>Your server has started in Rescue mode; that means that </span><span>core Linux/BSD system was launched on your server through the</span><span>network. This is not the system, which is normally installed</span><span>on your server, none of your hard disks has been reached.<br /></span><br /><strong> Username </strong> : {$username}<br /><strong> Password</strong> : {$password}</div>',
                    "custom" => 1,
                    "plaintext" => 0
                ],
                [
                    "type" => "general",
                    "name" => "Service Monitoring",
                    "subject" => "Service Monitoring",
                    "message" => '<span><br />Dear Customer,<br /><br /></span><span>The service monitoring system has detected that some services are not working properly on the server. The current status.
                <br /><strong> Details </strong> : <br /> {$details}
                </span>',
                    "custom" => 1,
                    "plaintext" => 0
                ],
                [
                    "type" => "general",
                    "name" => "Detection of an attack on IP",
                    "subject" => "Detection of an attack on IP",
                    "message" => '<span><br />Dear Customer,<br /><br /></span><span>
                Just detect an attack on the IP address {$ipaddress}.<br /><br />So that we can protect their infrastructure, we hope your trafficour mitigation infrastructure.<br />All attacks will be filtered by our infrastructure, and only thelegitimate traffic will come to your servers.<br />After the end of its infrastructure attack will be immediately withdrawn from themitigation.
                </span>',
                    "custom" => 1,
                    "plaintext" => 0
                ],
                [
                    "type" => "general",
                    "name" => "Spam Detected",
                    "subject" => "Spam Detected",
                    "message" => '<span><br />Dear Customer,<br /><br /></span><span>Our anti-spam protection layer has detected that your IP{$ipaddress}</span><span>is sending spam.</span><br /><br /><span>In order to protect our network, we have blocked the port 25 of your server, at the</span><br /><span>network level.</span><br /><br /><span>To help you investigate about this problem and fix it, here are a sample</span><br /><span>are some advanced details on your emails:</span><br /><br /><span>{$detected_detail}</span>',
                    "custom" => 1,
                    "plaintext" => 0
                ],
                [
                    "type" => "general",
                    "name" => "Anti-hack",
                    "subject" => "Anti-hack",
                    "message" => '<span><br />Dear Customer ,<br /></span>
                <p><span>We have detected unusual activity on your server<span>{$server_name}</span></span><span>.</span><br /><span>Please do not hesitate to contact our technical support so that this</span><br /><span>situation does not become critical.</span><br /><br /><span>You can find the logs brought up by our system below which led to this alert.</span><br /><br /><span>- START OF ADDITIONAL INFORMATION -</span><br /><br />{$detail}</p>',
                    "custom" => 1,
                    "plaintext" => 0
                ],
                [
                    "type" => "general",
                    "name" => "End of Attack",
                    "subject" => "End of Attack",
                    "message" => 'Dear Customer,<br /><br />We are no longer able to detect any attack on IP address {$ipaddress}<br /><br /> Your infrastructure has now been withdrawn from our mitigation system.',
                    "custom" => 1,
                    "plaintext" => 0
                ],
                [
                    "type" => "general",
                    "name" => "Monitoring Online",
                    "subject" => "Monitoring Online",
                    "message" => 'Dear Customer,<br /><br />We noticed a fault on your server and we have scheduled an intervention in order to fix this fault. <br /><br />Our monitoring system did not detect any fault on your dedicated server {$server_name} <br /><br /><strong> Details </strong> : <br /> {$details} .',
                    "custom" => 1,
                    "plaintext" => 0
                ],
                [
                    "type" => "general",
                    "name" => "Detection of an attack",
                    "subject" => "Detection of an attack",
                    "message" => '<span><br />Dear Customer,<br /><br /></span><span> We have just detected an attack on IP address {$ipaddress} .
                <br /><br /> In order to protect your infrastructure, we vacuumed up your traffic onto our mitigation infrastructure.<br /><br />
                The entire attack will thus be filtered by our infrastructure, and only legitimate traffic will reach your servers</span>',
                    "custom" => 1,
                    "plaintext" => 0
                ],
                [
                    "type" => "general",
                    "name" => "Additional IP addresses",
                    "subject" => "Additional IP addresses",
                    "message" => 'Dear Customer,<br /><br />You have subscribed to our additional IP service on your VPS Server.<br /><br /> We are pleased to inform you that this service is now active. <br> <br>Summary of additional IPs: <br> {$ipaddress}',
                    "custom" => 1,
                    "plaintext" => 0
                ],
                [
                    "type" => "general",
                    "name" => "Additional Disk",
                    "subject" => "Additional Disk",
                    "message" => 'Dear Customer,<br /><br />An additional disk has been attached to your VPS.<br /><br /> You can mount this disk in Linux by using the following commands: <br><br> {$diskDetail} <br><br> In Windows, you may need to restart your VPS.',
                    "custom" => 1,
                    "plaintext" => 0
                ],
                [
                    "type" => "admin",
                    "name" => "Product Hidden(Depricated on OVH)",
                    "subject" => "Product Hidden(Depricated on OVH)",
                    "message" => 'Dear Admin,<br /><br />These products has been marked as hidden in your WHMCS because they are no longer available at OVH.<br /><br />{$productDetails}',
                    "custom" => 1,
                    "plaintext" => 0
                ]
            ];
        } catch (\Exception $e) {
            throw new \Exception('Error while creating custom email templates: ' . $e->getMessage());
        }
    }

    public function getAllCustomEmailTemp(){

        try {
            $custommailTemplate = Capsule::table("tblemailtemplates")->where(["type"=>"general", "custom" => "1"])->whereIn("name", ['Hardware Reboot','Server Re-installed','Ftp Backup Password change','FTP Backup Configured','Server Details','Rescue-Pro Mode','BSD10 Rescue mode','Service Monitoring','Detection of an attack on IP','Spam Detected','Anti-hack','Monitoring Online','End of Attack','Detection of an attack','Operation Hard Reboot Finished','Additional IP addresses','Additional Disk'])->get()->toArray();

            return $custommailTemplate;

        } catch (\Exception $e) {
            throw new \Exception('Error while getting all email templates: ' . $e->getMessage());
        }
    }

}
