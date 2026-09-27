var enjoyhint_instance = new EnjoyHint({});
var enjoyhint_script_steps = [
	{'next .lm1' : "Select the language for which you need to edit lang variables"},
	{'next .lm2' : "Change the text in the language variables"},
];
enjoyhint_instance.set(enjoyhint_script_steps);
enjoyhint_instance.run();