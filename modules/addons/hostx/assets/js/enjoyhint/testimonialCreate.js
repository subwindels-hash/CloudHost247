var enjoyhint_instance = new EnjoyHint({});
var enjoyhint_script_steps = [
	{'next .ch1' : "Add testimonial name here."},
	{'next .ch2' : "Select page name for testimonial."},
	{'next .ch3' : "Select status for testimonial."},
	{'next .ch4' : "Select testimonial style."},
	{'next .ch5' : "Enable testimonial for pages."},
	{'next .ch6' : "Select review to show (Multi select)"},
	{'next .ch7' : "Click to save testimonial"},
	{'next .ch8' : "Click to cancel"},
];
enjoyhint_instance.set(enjoyhint_script_steps);
enjoyhint_instance.run();