var enjoyhint_instance = new EnjoyHint({});
var enjoyhint_script_steps = [
	{'next .addon-right-left-inner' : "Set meta tags and og tags here"},
	{'next .ast0' : "Select page name for which you need to add the meta tags"},
	{'next .ast1' : "Set robots tags"},
	{'next .ast2' : "Enable/Disable Canonical tags"},
	{'next .ast3' : "Select the language for which you need to add the meta tags for this page"},
	{'next .ast4' : "page Set meta title"},
	{'next .ast5' : "Set meta keywords"},
	{'next .ast6' : "Set meta description"},
	{'next .ast7' : "Set OG title"},
	{'next .ast8' : "Set OG image"},
	{'next .ast9' : "Set OG description "},
	{'next .ast10' : "Click to save the settings"},
	{'click .ast11' : "Cancel the changes "},
	{'click .ast12' : "Delete the tags for this page permanently"},
	{'click .ast13' : "Click to add tags"},
	{'click .ast14' : "Select the page name for which you need to set the tags"},
	{'click .ast15' : "Set total listing to showcase on a single page"},
	{'click .ast16' : "Search the page you want to change the meta and og tags"},
	{'click .ast17' : "Preview this page"},
	{'click .ast18' : "Edit the tags for this"},
];
enjoyhint_instance.set(enjoyhint_script_steps);
enjoyhint_instance.run();