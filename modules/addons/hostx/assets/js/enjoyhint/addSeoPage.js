var enjoyhint_instance = new EnjoyHint({});
var enjoyhint_script_steps = [
	{'next #pagetitle' : "Add page title"},
	{'next #pagename' : "Set custom URL of the page"},
	{'next .wgs-page-typ' : "Select the page type"},
	{'next #new_banner_lang' : "Select Banner language for which you want to add the content for"},
	{'next #mceu_20' : "Click on View Then Click On Source Code to change banner html"},
	{'next .page-blog-right' : "Drag the blocks and drop to assigned blocks"},
	{'next .page-blog-left' : "Drop blocks here"},
	{'next #editor2' : "Add custom CSS if you have"},
	{'next .main-ul' : "Assign the menu for the page"},
	{'next .page-status-menu' : "Set status of the page"},
	{'next .upload-image-box' : "Set featured image or banner image"},
	{'next .svHint' : "Publish the page"},
	{'click .cncHint' : "Click on cancel to cancel the changes"},
];
enjoyhint_instance.set(enjoyhint_script_steps);
enjoyhint_instance.run();