var enjoyhint_instance = new EnjoyHint({});
var enjoyhint_script_steps = [
	{'next .frHintsSel' : "Set the total pages listing you want to show on a single page"},
	{'next .frHints' : "Search the page you are looking for"},
	{'next .seoPrev' : "Make a preview of the page"},
	{'next .seoEdit' : "Edit the page"},
	{'next .seoDis' : "Enable/Disable the Page"},
	{'next .seoDl' : "Delete the page permanently"},
	{'next .pagination' : "Go to next page"},
	{'click .wgs-scs-btn' : "Click to add a new page"},
];
enjoyhint_instance.set(enjoyhint_script_steps);
enjoyhint_instance.run();