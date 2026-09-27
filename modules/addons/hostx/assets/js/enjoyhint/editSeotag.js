var enjoyhint_instance = new EnjoyHint({});
var enjoyhint_script_steps = [
	{'next .ast0' : "Set robots tags"},
	{'next .ast1' : "Enable/Disable Canonical tags"},
	{'next .ast2' : "Set meta title"},
	{'next .ast3' : "Set meta keywords"},
	{'next .ast4' : "Set meta description"},
	{'next .ast5' : "Set OG title"},
	{'next .ast6' : "Set OG image"},
	{'next .ast7' : "Set OG description"},
    {'next .ast8' : "Update settings"},
	{'next .ast9' : "Cancel the changes"},
	{'click .ast10' : "Edit page title"},
];
enjoyhint_instance.set(enjoyhint_script_steps);
enjoyhint_instance.run();