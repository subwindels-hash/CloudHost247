var enjoyhint_instance = new EnjoyHint({});
var enjoyhint_script_steps = [
	{'next .hm0' : "Select the Home Page Pricing Table Style"},
	{'next .hm1' : "Enter Plan Heading name"},
	{'next .hm2' : "Set the product for which you want to showcase the price here"},
	{'next .hm3' : "Enter Link of page to redirect"},
	{'next .hm4' : "Change the text of button"},
	{'next .hm5' : "Change Head Sort Description"},
	{'next .hm6' : "Change Footer Caption"},
	{'next .hm7' : "Change Footer Description"},
	{'next .hm8' : "Change full description of the plan list"},
	{'click .savebtn' : "Click to save the changes"},
];
enjoyhint_instance.set(enjoyhint_script_steps);
enjoyhint_instance.run();