var enjoyhint_instance = new EnjoyHint({});
if(jQuery(".edit_widget").length > 0){
	var enjoyhint_script_steps = [
		{'click .panel-heading' : "Select the language in which you want to edit the block"},
		{'next #title' : "Change Block Title"},
		{'next .editSubt' : "Change block Sub title"},
		{'next #status' : "Change Status of the block"},
		{'next #mceu_20' : "Click on View > Source Code to customize the block"},
		{'next .edit_widget' : "Edit the widget"},
		{'next .btn-danger' : "Delete the Widget"},
		{'next .add-widget' : "Click to add new widget"},
		{'next .submit_blocks' : "Click to update the changes"},
		{'next .btn-block' : "Click to cancel the changes"},
		{'click #add-language' : "Select other language in which you want to edit the block"},
	];	
}else{
	var enjoyhint_script_steps = [
		{'click .panel-heading' : "Select the language in which you want to edit the block"},
		{'next #title' : "Change Block Title"},
		{'next .editSubt' : "Change block Sub title"},
		{'next #status' : "Change Status of the block"},
		{'next #mceu_20' : "Click on View > Source Code to customize the block"},
		{'next .add-widget' : "Click to add new widget"},
		{'next .submit_blocks' : "Click to update the changes"},
		{'next .btn-block' : "Click to cancel the changes"},
		{'click #add-language' : "Select other language in which you want to edit the block"},
	];
}

enjoyhint_instance.set(enjoyhint_script_steps);
enjoyhint_instance.run();