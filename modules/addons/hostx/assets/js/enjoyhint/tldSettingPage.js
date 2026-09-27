var enjoyhint_instance = new EnjoyHint({});
var enjoyhint_script_steps = [
	{'next .frHintsSel' : "Set total TLd's to show on a single page"},
	{'next .frHints' : "Search the TLD you are looking for"},
	{'next .pagination' : "Go to next page"},
	{'next .tlm1' : "Click to Enable the TLD on the main menu"},
	{'next .tlm2' : "Click to Enable the TLD on the home page"},
	{'next .tlm3' : "Click to Enable the TLD under the domain search"},
	{'next .tlm4' : "Click to show the domain tld's icon"},
	{'next .tlm5' : "Set the TLD's price to showcase"},
	{'next .tlm6' : "Save the changes"},
	
];
enjoyhint_instance.set(enjoyhint_script_steps);
enjoyhint_instance.run();