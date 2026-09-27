var enjoyhint_instance = new EnjoyHint({});
var enjoyhint_script_steps = [
	{'next #pagetitle' : "Edit page title"},
	{'next #pagename' : "Edit custom URL of the page"},
	{'next .preview-btn' : "Make a preview of the page"},
	{'next .wgs-page-typ' : "Change the page type"},
	{'click .language-done-box' : "Click On Panel"},
	{'next #mceu_20' : "Click on View Then Click On Source Code to update banner html"},
	{'next #new_banner_lang' : "Select Banner language for which you want to copy the content for"},
	{'next .page-blog-right' : "Drag the blocks and drop to assigned blocks"},
	{'next .page-blog-left' : "Drop blocks here"},
	{'next #editor2' : "Update custom CSS if you have"},
	{'next .page-status-menu' : "Update status of the page"},
	{'next .upload-image-box' : "Update featured image or banner image"},
	{'next .svHint' : "Publish the page"},
	{'click .cncHint' : "Click on cancel to cancel the changes"},
];
enjoyhint_instance.set(enjoyhint_script_steps);
enjoyhint_instance.run();