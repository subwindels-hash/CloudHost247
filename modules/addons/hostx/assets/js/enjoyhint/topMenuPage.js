var enjoyhint_instance = new EnjoyHint({});
var enjoyhint_script_steps = [
	{'next .frHintsSel' : "Set the total menu listing you want to show on a single page"},
	{'next .frHints' : "Search the menu you are looking for"},
	{'next .tm1' : "Edit the menu"},
	{'next .tm2' : "Enable/Disable the menu"},
	{'next .tm3' : "Delete the menu permanently"},
	{'next .pagination' : "Go to next page"},
	{'click .tm4' : "Click to add a new page"},
];
enjoyhint_instance.set(enjoyhint_script_steps);
enjoyhint_instance.run();