<?php
use WHMCS\ClientArea;
use WHMCS\Database\Capsule;
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new ClientArea();
$ca->setPageTitle('Blog');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('blog.php', 'Blog');
$ca->initPage();
$result = Capsule::table("tblannouncements")->where('published','!=', '')->get();
$blogs = [];
foreach($result as $value)
{
     $id = $value->id;
	 $date = $value->date;
	
	 $title = $value->title;
	 
	 $link = preg_replace("/[^a-zA-z0-9\s\+]/", "", $title);

	 $link = preg_replace("/[\+]/", "plus", $link); 
	 $link = preg_replace("/[\s]/", "-", $link); 
	 $announcement = $value->announcement;
	 $dom = new DOMDocument('1.0', 'UTF-8');
	 $dom->loadHTML($announcement, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
     $arrayOfSources = array();
     foreach( $dom->getElementsByTagName("img") as $image )
        {
     $arrayOfSources[] = $image->getAttribute("src");  
        }

    $result2 = Capsule::table("tblannouncements")->where('parentid', $id)->where("language", $_SESSION['Language'])->first();
	$result2 = (array) $result2;
	if ($result2['title'])
	 {
			$title = $result2['title'];
	 }
	if ($result2['announcement']) 
	{
		$announcement = $result2['announcement'];
	}
	$timestamp = strtotime($date);
	$date = fromMySQLDate($date, true);
	$blogs[] = array("id" => $id, "date" => $date, "timestamp" => $timestamp, "image" => $arrayOfSources[0], "title" => $title, "text" => $announcement, "link"=>"index.php/announcements/$id/$link.html");
}
$ca->assign('blogs', $blogs);
$ca->assign('sidebarHostxRemove', 'true');
$ca->setTemplate('blog');

$ca->output();

?>