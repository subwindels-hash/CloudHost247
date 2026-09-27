var enjoyhint_instance = new EnjoyHint({});
var enjoyhint_script_steps = [
	{'next .pdr0' : "Select Dedicated Type Page"},
	{'next .pdr1' : "Select the product group to assign"},
	{'next .pdr11' : "Select the Disk types comes with this plan"},
	{'next .pdr12' : "Set the Ram Size"},
	{'next .pdr13' : "Select the location"},
	{'next .pdr14' : "Enter plan configuration eg Intel Xeon E3-1225v2 4c / 4t 3.2GHz,16GB DDR3 1333 MHz,SoftRAID 3x2TB SATA"},
	{'next .savebtn' : "Click on Save Changes Button to save"},
	{'click .pdrBck' : "Click to set the product group for VPS page"},
];
enjoyhint_instance.set(enjoyhint_script_steps);
enjoyhint_instance.run();