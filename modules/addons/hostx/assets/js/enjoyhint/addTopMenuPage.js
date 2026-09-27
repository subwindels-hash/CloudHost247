var enjoyhint_instance = new EnjoyHint({});
var enjoyhint_script_steps = [
	{'next .adm1' : "Enter Menu Name"},
	{'next .adm2' : "Select Menu Type"},
	{'next .adm3' : "Set Menu URL"},
	{'next .adm4' : "Select Parent Menu"},
	{'next .adm5' : "Enable this option if the menu item URL is from third party website"},
	{'next .adm6' : "Enable to open the menu link to open in new tab"},
	{'next .adm7' : "Enable/Disable the status of the menu"},
	{'next .adm8' : "Set menu icons"},
	{'next .adm9' : "Set the sort order of the menu item"},
	{'next .adm10' : "Set whether to show/hide this menu item from guests or clients"},
	{'next .adm11' : "Enable if you need to show VPS pricing table"},
	{'next .adm12' : "Enable if you need to show Dedicated pricing table"},
	{'next .adm13' : "Set caption button name"},
	{'next .adm14' : "Set caption URL"},
	{'next .adm15' : "Set caption text"},
	{'click .adm16' : "Save the menu item"},
];
enjoyhint_instance.set(enjoyhint_script_steps);
enjoyhint_instance.run();