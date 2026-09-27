var enjoyhint_instance = new EnjoyHint({});
var enjoyhint_script_steps = [
	{'next .frHintsSel' : "Set the total block listing you want to show on a single page"},
	{'next .frHints' : "Search the block you are looking for"},
	{'next .pg0' : "Copy this block"},
	{'next .pg1' : "Edit this block"},
	{'next .pg2' : "Enable/Disable this block"},
	{'next .pg3' : "Delete this block permanently"},
	{'next .pagination' : "Go to next page"},
	{'click .pg4' : "Clik to Copy a block and select the layout you want to copy with selected language"},
];
enjoyhint_instance.set(enjoyhint_script_steps);
enjoyhint_instance.run();