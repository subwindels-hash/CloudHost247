<?php

define("CLIENTAREA", true);

require("init.php");

use WHMCS\ClientArea;

$ca = new ClientArea();

$ca->setPageTitle("Acceptable Use Policy (AUP)");

$ca->addToBreadCrumb("index.php", Lang::trans("globalsystemname"));
$ca->addToBreadCrumb("acceptable-use-policy.php", "Acceptable Use Policy (AUP)");

$ca->initPage();

$ca->output();
