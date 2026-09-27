var enjoyhint_instance = new EnjoyHint({});
var enjoyhint_script_steps = [
	{'next .ch1' : "Client image"},
	{'next .ch2' : "Client name"},
	{'next .ch3' : "Review tag line"},
	{'next .ch4' : "Review description"},
	{'next .ch5' : "Review rating"},
	{'next .tm1' : "Click to view review"},
	{'next .tm2' : "Click to edit review"},
	{'next .tm3' : "Click to delete review"},
];
enjoyhint_instance.set(enjoyhint_script_steps);
enjoyhint_instance.run();