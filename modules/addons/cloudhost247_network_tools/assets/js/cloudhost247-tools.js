/*
 * CloudHost247 Network Tools — client-side behaviour.
 *
 * Responsibilities, all optional for reading a result:
 *   1. A QR encoder (versions 1-10, byte mode, EC levels L/M/Q/H) so QR codes
 *      are produced on the user's device and never uploaded.
 *   2. PNG/SVG export of a drawn QR code.
 *   3. Camera/upload scanning with the browser's BarcodeDetector API, with an
 *      honest message when the browser has no decoder.
 *   4. Copy-to-clipboard buttons, client-only tool handling and small helpers.
 *
 * No third-party code, no network calls, no analytics.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * QR encoder                                                         *
   * ------------------------------------------------------------------ */

  var ECC_CODEWORDS_PER_BLOCK = {
    L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
    M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
    Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
    H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28]
  };
  var NUM_ECC_BLOCKS = {
    L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
    M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
    Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
    H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8]
  };

  function numRawDataModules(version) {
    var result = (16 * version + 128) * version + 64;
    if (version >= 2) {
      var numAlign = Math.floor(version / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (version >= 7) {
        result -= 36;
      }
    }
    return result;
  }

  function numDataCodewords(version, ecl) {
    return Math.floor(numRawDataModules(version) / 8)
      - ECC_CODEWORDS_PER_BLOCK[ecl][version] * NUM_ECC_BLOCKS[ecl][version];
  }

  // Alignment pattern centres, versions 2-10 (ISO/IEC 18004 table E.1). The
  // table is written out rather than computed, because a formula that is off by
  // two modules silently produces a code that some scanners cannot read.
  var ALIGNMENT_POSITIONS = {
    2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  function alignmentPositions(version) {
    return ALIGNMENT_POSITIONS[version] || [];
  }

  function gfMultiply(a, b) {
    var result = 0;
    for (var i = 7; i >= 0; i--) {
      result = ((result << 1) ^ ((result >>> 7) * 0x11D)) & 0xFF;
      result ^= ((b >>> i) & 1) * a;
    }
    return result & 0xFF;
  }

  function reedSolomonDivisor(degree) {
    var result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < degree; j++) {
        result[j] = gfMultiply(result[j], root);
        if (j + 1 < degree) {
          result[j] ^= result[j + 1];
        }
      }
      root = gfMultiply(root, 0x02);
    }
    return result;
  }

  function reedSolomonRemainder(data, divisor) {
    var result = new Array(divisor.length).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ result.shift();
      result.push(0);
      for (var j = 0; j < divisor.length; j++) {
        result[j] ^= gfMultiply(divisor[j], factor);
      }
    }
    return result;
  }

  function encodeQr(text, ecl) {
    if (!ECC_CODEWORDS_PER_BLOCK[ecl]) {
      throw new Error('Unknown error-correction level.');
    }
    var bytes = [];
    for (var i = 0; i < text.length; i++) {
      var code = text.codePointAt(i);
      if (code > 0xFFFF) {
        i++;
      }
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
      } else if (code < 0x10000) {
        bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      } else {
        bytes.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      }
    }
    var version = 0;
    for (var candidate = 1; candidate <= 10; candidate++) {
      var capacityBits = numDataCodewords(candidate, ecl) * 8;
      var countBits = candidate <= 9 ? 8 : 16;
      if (4 + countBits + bytes.length * 8 <= capacityBits) {
        version = candidate;
        break;
      }
    }
    if (version === 0) {
      throw new Error('That payload is too long for the in-browser encoder (it supports up to version 10). Shorten it, or use a shorter link.');
    }
    var capacity = numDataCodewords(version, ecl) * 8;
    var bits = [];
    function append(value, length) {
      for (var i = length - 1; i >= 0; i--) {
        bits.push((value >>> i) & 1);
      }
    }
    append(0x4, 4);
    append(bytes.length, version <= 9 ? 8 : 16);
    for (var b = 0; b < bytes.length; b++) {
      append(bytes[b], 8);
    }
    append(0, Math.min(4, capacity - bits.length));
    while (bits.length % 8 !== 0) {
      bits.push(0);
    }
    var dataCodewords = [];
    for (var p = 0; p < bits.length; p += 8) {
      var value = 0;
      for (var q = 0; q < 8; q++) {
        value = (value << 1) | bits[p + q];
      }
      dataCodewords.push(value);
    }
    for (var pad = 0; dataCodewords.length < numDataCodewords(version, ecl); pad++) {
      dataCodewords.push(pad % 2 === 0 ? 0xEC : 0x11);
    }

    var rawCodewords = Math.floor(numRawDataModules(version) / 8);
    var numBlocks = NUM_ECC_BLOCKS[ecl][version];
    var eccPerBlock = ECC_CODEWORDS_PER_BLOCK[ecl][version];
    // Short blocks hold one data codeword fewer than long blocks (ISO/IEC 18004
    // 8.6). The shorter blocks come first, the padding is virtual only — it is
    // never transmitted, so the total is exactly rawCodewords.
    var numLongBlocks = rawCodewords % numBlocks;
    var numShortBlocks = numBlocks - numLongBlocks;
    var shortBlockDataLength = Math.floor(rawCodewords / numBlocks) - eccPerBlock;
    var divisor = reedSolomonDivisor(eccPerBlock);
    var blocks = [];
    for (var block = 0, offset = 0; block < numBlocks; block++) {
      var isShort = numLongBlocks > 0 && block < numShortBlocks;
      var dataLength = shortBlockDataLength + (numLongBlocks > 0 && !isShort ? 1 : 0);
      var data = dataCodewords.slice(offset, offset + dataLength);
      offset += dataLength;
      var ecc = reedSolomonRemainder(data, divisor);
      blocks.push({ data: data, ecc: ecc, short: isShort });
    }
    var interleaved = [];
    var maxData = Math.max.apply(null, blocks.map(function (block) { return block.data.length; }));
    for (var index = 0; index < maxData; index++) {
      for (var blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        if (index < blocks[blockIndex].data.length) {
          interleaved.push(blocks[blockIndex].data[index]);
        }
      }
    }
    for (var eccIndex = 0; eccIndex < eccPerBlock; eccIndex++) {
      for (var blockEcc = 0; blockEcc < blocks.length; blockEcc++) {
        interleaved.push(blocks[blockEcc].ecc[eccIndex]);
      }
    }

    var size = version * 4 + 17;
    var modules = [];
    var reserved = [];
    for (var row = 0; row < size; row++) {
      modules.push(new Array(size).fill(false));
      reserved.push(new Array(size).fill(false));
    }
    function setFunction(x, y, dark) {
      if (x < 0 || y < 0 || x >= size || y >= size) {
        return;
      }
      modules[y][x] = dark;
      reserved[y][x] = true;
    }
    function drawFinder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var distance = Math.max(Math.abs(dx), Math.abs(dy));
          setFunction(cx + dx, cy + dy, distance !== 2 && distance !== 4);
        }
      }
    }
    drawFinder(3, 3);
    drawFinder(size - 4, 3);
    drawFinder(3, size - 4);
    for (var timing = 8; timing < size - 8; timing++) {
      setFunction(timing, 6, timing % 2 === 0);
      setFunction(6, timing, timing % 2 === 0);
    }
    var positions = alignmentPositions(version);
    for (var ai = 0; ai < positions.length; ai++) {
      for (var aj = 0; aj < positions.length; aj++) {
        if ((ai === 0 && aj === 0) || (ai === 0 && aj === positions.length - 1) || (ai === positions.length - 1 && aj === 0)) {
          continue;
        }
        for (var ay = -2; ay <= 2; ay++) {
          for (var ax = -2; ax <= 2; ax++) {
            setFunction(positions[ai] + ax, positions[aj] + ay, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
          }
        }
      }
    }
    setFunction(8, size - 8, true);
    // Reserve format information areas. The two timing-pattern cells that sit
    // inside those areas ((6,8) and (8,6)) are deliberately skipped: writing a
    // placeholder there would break the timing pattern and misread as a damaged
    // code by some scanners.
    for (var fi = 0; fi <= 8; fi++) {
      if (fi === 6) {
        continue;
      }
      setFunction(fi, 8, false);
      setFunction(8, fi, false);
    }
    for (var fj = 0; fj < 8; fj++) {
      setFunction(size - 1 - fj, 8, false);
      setFunction(8, size - 1 - fj, false);
    }
    if (version >= 7) {
      for (var vi = 0; vi < 18; vi++) {
        setFunction(size - 11 + (vi % 3), Math.floor(vi / 3), false);
        setFunction(Math.floor(vi / 3), size - 11 + (vi % 3), false);
      }
    }

    // Place data bits in the zigzag order.
    var bitIndex = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) {
        right = 5;
      }
      for (var vertical = 0; vertical < size; vertical++) {
        for (var columnOffset = 0; columnOffset < 2; columnOffset++) {
          var x = right - columnOffset;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vertical : vertical;
          if (!reserved[y][x] && bitIndex < interleaved.length * 8) {
            var bit = (interleaved[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1;
            modules[y][x] = bit === 1;
            bitIndex++;
          }
        }
      }
    }

    function maskCondition(mask, x, y) {
      switch (mask) {
        case 0: return (x + y) % 2 === 0;
        case 1: return y % 2 === 0;
        case 2: return x % 3 === 0;
        case 3: return (x + y) % 3 === 0;
        case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
        case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
        case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
        default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
    }

    function drawFormat(mask) {
      var data = (function () {
        var eclBits = { L: 1, M: 0, Q: 3, H: 2 }[ecl];
        var value = (eclBits << 3) | mask;
        var remainder = value;
        for (var i = 0; i < 10; i++) {
          remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
        }
        return ((value << 10) | remainder) ^ 0x5412;
      })();
      var read = function (index) { return ((data >>> index) & 1) === 1; };
      for (var i = 0; i <= 5; i++) { setFunction(8, i, read(i)); }
      setFunction(8, 7, read(6));
      setFunction(8, 8, read(7));
      setFunction(7, 8, read(8));
      for (var j = 9; j <= 14; j++) { setFunction(14 - j, 8, read(j)); }
      for (var k = 0; k <= 7; k++) { setFunction(size - 1 - k, 8, read(k)); }
      for (var m = 8; m <= 14; m++) { setFunction(8, size - 15 + m, read(m)); }
      setFunction(8, size - 8, true);
    }

    function drawVersion() {
      if (version < 7) {
        return;
      }
      var remainder = version;
      for (var i = 0; i < 12; i++) {
        remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1F25);
      }
      var data = (version << 12) | remainder;
      for (var index = 0; index < 18; index++) {
        var bit = ((data >>> index) & 1) === 1;
        setFunction(size - 11 + (index % 3), Math.floor(index / 3), bit);
        setFunction(Math.floor(index / 3), size - 11 + (index % 3), bit);
      }
    }

    function penalty() {
      var score = 0;
      var dark = 0;
      for (var y = 0; y < size; y++) {
        var runColour = modules[y][0];
        var runLength = 1;
        for (var x = 1; x < size; x++) {
          if (modules[y][x] === runColour) {
            runLength++;
            if (runLength === 5) { score += 3; } else if (runLength > 5) { score++; }
          } else {
            runColour = modules[y][x];
            runLength = 1;
          }
          if (modules[y][x]) { dark++; }
        }
        if (modules[y][0]) { dark++; }
      }
      for (var xc = 0; xc < size; xc++) {
        var colour = modules[0][xc];
        var length = 1;
        for (var yc = 1; yc < size; yc++) {
          if (modules[yc][xc] === colour) {
            length++;
            if (length === 5) { score += 3; } else if (length > 5) { score++; }
          } else {
            colour = modules[yc][xc];
            length = 1;
          }
        }
      }
      for (var by = 0; by < size - 1; by++) {
        for (var bx = 0; bx < size - 1; bx++) {
          var first = modules[by][bx];
          if (first === modules[by][bx + 1] && first === modules[by + 1][bx] && first === modules[by + 1][bx + 1]) {
            score += 3;
          }
        }
      }
      var finderPattern = [true, false, true, true, true, false, true, false, false, false, false];
      var inverse = finderPattern.map(function (value) { return !value; });
      function matchesAt(get, start, pattern) {
        for (var i = 0; i < pattern.length; i++) {
          if (get(start + i) !== pattern[i]) {
            return false;
          }
        }
        return true;
      }
      for (var row = 0; row < size; row++) {
        for (var startX = 0; startX + 11 <= size; startX++) {
          var sequence = [];
          for (var sx = 0; sx < 11; sx++) { sequence.push(modules[row][startX + sx]); }
          if (matchesAt(function (i) { return sequence[i]; }, 0, finderPattern) || matchesAt(function (i) { return sequence[i]; }, 0, inverse)) {
            score += 40;
          }
        }
        for (var startY = 0; startY + 11 <= size; startY++) {
          var column = [];
          for (var sy = 0; sy < 11; sy++) { column.push(modules[startY + sy][row]); }
          if (matchesAt(function (i) { return column[i]; }, 0, finderPattern) || matchesAt(function (i) { return column[i]; }, 0, inverse)) {
            score += 40;
          }
        }
      }
      var total = size * size;
      var percent = dark / total * 100;
      score += Math.floor(Math.abs(percent - 50) / 5) * 10;
      return score;
    }

    var best = null;
    var base = modules.map(function (row) { return row.slice(); });
    for (var mask = 0; mask < 8; mask++) {
      modules = base.map(function (row) { return row.slice(); });
      for (var my = 0; my < size; my++) {
        for (var mx = 0; mx < size; mx++) {
          if (!reserved[my][mx] && maskCondition(mask, mx, my)) {
            modules[my][mx] = !modules[my][mx];
          }
        }
      }
      drawFormat(mask);
      drawVersion();
      var candidateScore = penalty();
      if (best === null || candidateScore < best.score) {
        best = { score: candidateScore, modules: modules.map(function (row) { return row.slice(); }), mask: mask };
      }
    }
    modules = best.modules;
    return { version: version, size: size, modules: best.modules, mask: best.mask, ecl: ecl, interleaved: interleaved.slice() };
  }

  function qrToSvg(qr, border) {
    border = border === undefined ? 4 : border;
    var size = qr.size + border * 2;
    var path = '';
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) {
          path += 'M' + (x + border) + ' ' + (y + border) + 'h1v1h-1z';
        }
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" width="' + size * 8 + '" height="' + size * 8 + '" shape-rendering="crispEdges">'
      + '<rect width="100%" height="100%" fill="#ffffff"/><path d="' + path + '" fill="#000000"/></svg>';
  }

  function qrToCanvas(qr, canvas, scale) {
    scale = scale || 6;
    var border = 4;
    var size = qr.size + border * 2;
    canvas.width = size * scale;
    canvas.height = size * scale;
    var context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000000';
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) {
          context.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
        }
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Helpers                                                            *
   * ------------------------------------------------------------------ */

  function fieldValue(form, name) {
    var element = form.querySelector('[name="fields[' + name + ']"]');
    return element ? element.value : '';
  }

  function notice(message, tone) {
    var box = document.createElement('p');
    box.className = 'alert alert-' + (tone || 'info');
    box.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
    box.textContent = message;
    return box;
  }

  function addCopyButtons() {
    document.querySelectorAll('.ch247-tools code, .ch247-tools pre').forEach(function (block) {
      if (block.dataset.ch247Copy === '1') {
        return;
      }
      block.dataset.ch247Copy = '1';
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'ch247-button ch247-button--ghost';
      button.textContent = 'Copy';
      button.addEventListener('click', function () {
        navigator.clipboard.writeText(block.textContent).then(function () {
          button.textContent = 'Copied';
          window.setTimeout(function () { button.textContent = 'Copy'; }, 1500);
        }, function () {
          button.textContent = 'Press Ctrl+C';
        });
      });
      block.insertAdjacentElement('afterend', button);
    });
  }

  /* ------------------------------------------------------------------ *
   * Client-only tools: QR generator and scanner                        *
   * ------------------------------------------------------------------ */

  function setupQrGenerator(form) {
    var container = document.createElement('section');
    container.className = 'ch247-tools__result';
    var heading = document.createElement('h3');
    heading.textContent = 'QR code (generated on this device)';
    container.appendChild(heading);
    var canvas = document.createElement('canvas');
    canvas.style.maxWidth = '100%';
    canvas.setAttribute('role', 'img');
    container.appendChild(canvas);
    var actions = document.createElement('div');
    actions.className = 'ch247-tools__chips';
    var png = document.createElement('button');
    png.type = 'button';
    png.className = 'ch247-button';
    png.textContent = 'Download PNG';
    var svg = document.createElement('button');
    svg.type = 'button';
    svg.className = 'ch247-button ch247-button--ghost';
    svg.textContent = 'Download SVG';
    var print = document.createElement('button');
    print.type = 'button';
    print.className = 'ch247-button ch247-button--ghost';
    print.textContent = 'Print';
    actions.appendChild(png);
    actions.appendChild(svg);
    actions.appendChild(print);
    container.appendChild(actions);
    var status = document.createElement('div');
    container.appendChild(status);
    form.insertAdjacentElement('afterend', container);

    function render() {
      status.innerHTML = '';
      var kind = fieldValue(form, 'kind') || 'url';
      var payload = fieldValue(form, 'payload') || '';
      var ecl = (fieldValue(form, 'error_correction') || 'M').toUpperCase();
      var value = payload;
      if (kind === 'url') {
        value = /^[a-z][a-z0-9+.\-]*:\/\//i.test(payload) ? payload : 'https://' + payload.replace(/^\/+/, '');
      } else if (kind === 'email') {
        var lines = payload.split(/\r?\n/);
        value = 'mailto:' + (lines[0] || '') + (lines[1] ? '?subject=' + encodeURIComponent(lines[1]) : '');
      } else if (kind === 'phone') {
        value = 'tel:' + payload.replace(/[^0-9+]/g, '');
      } else if (kind === 'sms') {
        var smsLines = payload.split(/\r?\n/);
        value = 'SMSTO:' + (smsLines[0] || '').replace(/[^0-9+]/g, '') + ':' + (smsLines[1] || '');
      } else if (kind === 'wifi') {
        var wifi = payload.split(/\r?\n/);
        var escape = function (text) { return (text || '').replace(/([\\;,:"])/g, '\\$1'); };
        var encryption = (wifi[2] || 'WPA').toUpperCase();
        value = 'WIFI:T:' + encryption + ';S:' + escape(wifi[0]) + ';'
          + (encryption === 'NOPASS' ? '' : 'P:' + escape(wifi[1]) + ';') + ';';
      } else if (kind === 'vcard') {
        var card = payload.split(/\r?\n/);
        value = 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:' + (card[0] || '')
          + (card[1] ? '\r\nORG:' + card[1] : '') + (card[2] ? '\r\nTITLE:' + card[2] : '')
          + (card[3] ? '\r\nTEL;TYPE=CELL:' + card[3] : '') + (card[4] ? '\r\nEMAIL:' + card[4] : '')
          + '\r\nEND:VCARD';
      }
      if (value.trim() === '') {
        status.appendChild(notice('Enter the content you want encoded.', 'warning'));
        return;
      }
      try {
        var qr = encodeQr(value, ecl);
        qrToCanvas(qr, canvas, 6);
        status.appendChild(notice('Encoded locally: version ' + qr.version + ', ' + qr.size + '×' + qr.size + ' modules, error correction ' + ecl + '. Scan the code with a phone camera to verify it decodes to the value you expect.', 'success'));
        png.onclick = function () {
          var link = document.createElement('a');
          link.download = 'cloudhost247-qr.png';
          link.href = canvas.toDataURL('image/png');
          link.click();
        };
        svg.onclick = function () {
          var blob = new Blob([qrToSvg(qr)], { type: 'image/svg+xml' });
          var link = document.createElement('a');
          link.download = 'cloudhost247-qr.svg';
          link.href = URL.createObjectURL(blob);
          link.click();
        };
        print.onclick = function () { window.print(); };
      } catch (error) {
        status.appendChild(notice(error.message, 'danger'));
      }
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      render();
    });
    render();
  }

  function setupQrScanner(form) {
    var container = document.createElement('section');
    container.className = 'ch247-tools__result';
    container.innerHTML = '<h3>Scan a QR code (on this device)</h3>';
    var video = document.createElement('video');
    video.setAttribute('playsinline', 'true');
    video.style.maxWidth = '100%';
    video.hidden = true;
    container.appendChild(video);
    var controls = document.createElement('div');
    controls.className = 'ch247-tools__chips';
    var start = document.createElement('button');
    start.type = 'button';
    start.className = 'ch247-button';
    start.textContent = 'Start camera';
    var upload = document.createElement('input');
    upload.type = 'file';
    upload.accept = 'image/*';
    controls.appendChild(start);
    controls.appendChild(upload);
    container.appendChild(controls);
    var output = document.createElement('div');
    container.appendChild(output);
    form.insertAdjacentElement('afterend', container);

    if (typeof window.BarcodeDetector === 'undefined') {
      output.appendChild(notice('This browser has no built-in QR decoder (BarcodeDetector). The scanner cannot read a code here — that is a browser limitation, not a result. Any recent Chrome, Edge or Android browser supports it.', 'warning'));
      start.disabled = true;
      return;
    }
    var detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    var stream = null;
    function report(text) {
      output.innerHTML = '';
      var paragraph = document.createElement('p');
      paragraph.className = 'alert alert-success';
      paragraph.textContent = 'Decoded locally: ' + text;
      output.appendChild(paragraph);
      output.appendChild(notice('Nothing was uploaded. If you ticked "Include the decoded value in my history", only the tool and time are recorded, never this value.', 'info'));
    }
    start.addEventListener('click', function () {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (mediaStream) {
        stream = mediaStream;
        video.srcObject = mediaStream;
        video.hidden = false;
        return video.play();
      }).then(function () {
        var loop = function () {
          if (!stream) {
            return;
          }
          detector.detect(video).then(function (codes) {
            if (codes.length > 0) {
              report(codes[0].rawValue);
              stream.getTracks().forEach(function (track) { track.stop(); });
              stream = null;
              video.hidden = true;
            } else {
              window.requestAnimationFrame(loop);
            }
          }).catch(function () {
            window.requestAnimationFrame(loop);
          });
        };
        loop();
      }).catch(function () {
        output.appendChild(notice('The camera could not be started. Grant camera permission, or upload an image instead.', 'warning'));
      });
    });
    upload.addEventListener('change', function () {
      var file = upload.files && upload.files[0];
      if (!file) {
        return;
      }
      var image = new Image();
      image.onload = function () {
        detector.detect(image).then(function (codes) {
          if (codes.length > 0) {
            report(codes[0].rawValue);
          } else {
            output.appendChild(notice('No QR code was found in that image.', 'warning'));
          }
        }).catch(function () {
          output.appendChild(notice('The decoder could not read that image.', 'warning'));
        });
      };
      image.src = URL.createObjectURL(file);
    });
  }

  /* ------------------------------------------------------------------ *
   * Boot                                                               *
   * ------------------------------------------------------------------ */

  function boot() {
    addCopyButtons();
    var forms = document.querySelectorAll('form.ch247-tools__form');
    forms.forEach(function (form) {
      var slugField = form.querySelector('input[name="tool"]');
      var slug = slugField ? slugField.value : '';
      if (slug === 'productivity/qr-generator' || slug === 'productivity/wifi-qr') {
        setupQrGenerator(form);
      } else if (slug === 'productivity/qr-scanner') {
        setupQrScanner(form);
      }
    });
  }

  if (typeof document === 'undefined') {
    // Node (tests, tooling): expose the encoder without touching a DOM.
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = {
        encodeQr: encodeQr, qrToSvg: qrToSvg, qrToCanvas: qrToCanvas,
        // Exposed for tests/network_tools/qr_selfcheck.js only.
        _internal: {
          reedSolomonDivisor: reedSolomonDivisor,
          reedSolomonRemainder: reedSolomonRemainder,
          numDataCodewords: numDataCodewords,
          numRawDataModules: numRawDataModules,
          eccTable: { ecc: ECC_CODEWORDS_PER_BLOCK, blocks: NUM_ECC_BLOCKS }
        }
      };
    }
    return;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
