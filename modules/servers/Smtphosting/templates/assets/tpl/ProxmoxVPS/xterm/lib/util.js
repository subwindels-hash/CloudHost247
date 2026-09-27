var msgtimeout;

function showMsg(message, timeout, msgType) {
    var status_bar = document.getElementById('status_bar');
    clearTimeout(msgtimeout);

    status_bar.classList.remove('normal');
    status_bar.classList.remove('warning');
    status_bar.classList.remove('error');

    status_bar.textContent = message;
    //normal open warning error
    status_bar.classList.add(msgType);
    status_bar.classList.add("open");

    if (timeout !== 0) {
        msgtimeout = setTimeout(hideMsg, timeout || 1500);
    }
}

function hideMsg() {
    clearTimeout(msgtimeout);
    status_bar.classList.remove('open');
}
