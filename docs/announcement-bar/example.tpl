{* Example data for development/template use.
   In production, assign this array from a WHMCS hook or module. *}
{assign var="announcements" value=[
    [
        "text" => "Save 20% on annual cloud hosting plans",
        "url" => "store/cloud-hosting"
    ],
    [
        "text" => "New Lagos and London regions are now available"
    ],
    [
        "text" => "View scheduled maintenance and service updates",
        "url" => "serverstatus.php"
    ],
    [
        "text" => "Read the latest CloudHost247 news",
        "url" => "https://example.com/news",
        "external" => true
    ]
]}

{* Place immediately after the opening body tag and before navbar includes. *}
{include file="$template/includes/announcementbar.tpl"}
