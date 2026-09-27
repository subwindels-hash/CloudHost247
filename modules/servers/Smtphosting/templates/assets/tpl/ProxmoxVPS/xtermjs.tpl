<!doctype html>
<html>
<head>
    <link rel="stylesheet" href="{$appUrl}/xterm/css/xterm.css"/>
    <link rel="stylesheet" href="{$appUrl}/xterm/css/style.css"/>
    <script src="{$appUrl}/xterm/lib/xterm.js"></script>
    <script src="{$appUrl}/xterm/lib/util.js"></script>
    <script src="{$appUrl}/xterm-addon-fit/lib/xterm-addon-fit.js"></script>
</head>
<body>
<div id="status_bar" class="normal"></div>
<div id="wrap">
    <div id="terminal-container">
        <div dir="ltr" class="terminal xterm" tabindex="0">
            <div class="xterm-viewport" style="background-color: rgb(0, 0, 0);">
                <div class="xterm-scroll-area" style="height: 457px;"></div>
            </div>
            <div class="xterm-screen">
                <div class="xterm-helpers"><textarea class="xterm-helper-textarea" aria-label="Terminal input"
                                                     aria-multiline="false" autocorrect="off" autocapitalize="off"
                                                     spellcheck="false" tabindex="0" style=""></textarea><span
                            class="xterm-char-measure-element" aria-hidden="true"
                            style="font-family: courier-new, courier, monospace; font-size: 15px;">W</span>
                    <div class="composition-view"></div>
                </div>
                <canvas class="xterm-text-layer" width="1827" height="500"
                        style="z-index: 0; width: 1670px; height: 457px;"></canvas>
                <canvas class="xterm-selection-layer" width="1827" height="500"
                        style="z-index: 1; width: 1670px; height: 457px;"></canvas>
                <canvas class="xterm-link-layer" width="1827" height="500"
                        style="z-index: 2; width: 1670px; height: 457px;"></canvas>
                <canvas class="xterm-cursor-layer" width="1827" height="500"
                        style="z-index: 3; width: 1670px; height: 457px;"></canvas>
            </div>
        </div>
    </div>
</div>
{literal}
<script type="module">

    var states = {
        start: 1,
        connecting: 2,
        connected: 3,
        disconnecting: 4,
        disconnected: 5,
        reconnecting: 6,
    };
    var term, socket, state = states.start, ping, fitAddon;
    try {
        term = new Terminal();
        fitAddon = new FitAddon.FitAddon();
        term.loadAddon(fitAddon)
        var error = "{/literal}{$error}{literal}";
        if (error && error !== undefined && error !== null) {
            throw new Error(error);
        }
        socket = new WebSocket('{/literal}{$websocketUrl}{literal}', 'binary');
        socket.binaryType = 'arraybuffer';
        term.open(document.getElementById('terminal-container'), true);
        socket.onopen = runTerminal;
        socket.onerror = onError;
        state = states.connecting;
        showMsg("Connecting...", 1500, "warning");
    } catch (e) {
        showMsg(e, 20 * 1000, "error");
    }

    function runTerminal() {
        socket.onmessage = function (event) {
            var answer = new Uint8Array(event.data);
            if (state === states.connected) {
                term.write(answer);
            } else if (state === states.connecting) {
                if (answer[0] === 79 && answer[1] === 75) { // "OK"
                    state = states.connected;
                    showMsg("Connected", 1000, "normal");
                    term.write(answer.slice(2));
                } else {
                    socket.close();
                }
            }
        };
        term.onData(function (data) {
            if (state === states.connected) {
                socket.send("0:" + unescape(encodeURIComponent(data)).length.toString() + ":" + data);
            }
        });
        ping = setInterval(function () {
            socket.send("2");
        }, 30 * 1000);

        window.addEventListener('resize', function () {
            clearTimeout(resize);
            resize = setTimeout(function () {
                // done resizing
                fitAddon.fit();
            }, 250);
        });
        var user = "{/literal}{$user}{literal}";
        var password = "{/literal}{$password}{literal}";
        socket.send(user + ':' + password + "\n");
        // initial focus and resize
        setTimeout(function () {
            term.focus();
            fitAddon.fit();
        }, 250);
    }

    function onError(event) {
        showMsg("Connection failed", 20 * 1000, "error");
        socket.close();
    }
</script>
{/literal}
</body>
</html>
