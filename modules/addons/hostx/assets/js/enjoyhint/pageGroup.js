var enjoyhint_instance = new EnjoyHint({});
var enjoyhint_script_steps = [
	{'next .pgr0' : "Select page to which you need to assign the product group"},
	{'next .pgr1' : "Select the product group you want to assign to this page"},
	{'next .pgr11' : "Enter Head Sort Description"},
	{'next .pgr12' : "Enter Footer Caption"},
	{'next .pgr13' : "Enter Footer Sort Description"},
	{'next .pgr14' : "Change Plan List Description"},
	{'next .savebtn' : "Click on Save Changes Button to save"},
	{'click .pgr5' : "Now Assigning Product Groups to Dedicated Pages"},
];
enjoyhint_instance.set(enjoyhint_script_steps);
enjoyhint_instance.run();