var enjoyhint_instance = new EnjoyHint({});
var enjoyhint_script_steps = [
	{'next .sma1' : "Enter Menu Name"},
	{'next .sma2' : "Set Menu Icon"},
	{'next .sma3' : "Set URL type"},
	{'next .sma4' : "Set URL target to"},
	{'next .sma5' : "Set parent menu item"},
	{'next .sma6' : "Set Status of the menu item"},
	{'next .sma7' : "Set menu sort order"},
	{'next .sma8' : "Define class to the menu"},
	{'next .sma9' : "Set whether to show/hide this menu item from guests or clients"},
	{'click .sma10' : "Save the menu item"},
];
enjoyhint_instance.set(enjoyhint_script_steps);
enjoyhint_instance.run();