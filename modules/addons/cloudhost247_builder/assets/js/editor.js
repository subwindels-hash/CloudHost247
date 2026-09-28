/*
 * CloudHost247 Website Builder - visual editor.
 *
 * The canvas is not a lookalike. Every repaint asks the server to render the
 * current document with the same renderer that serves published pages, so what
 * an administrator arranges here is literally what visitors will get. The
 * browser owns the document tree, selection, drag and drop, undo history and
 * the inspector; the server owns validation, rendering and storage.
 *
 * No dependencies, no build step, no inline event handlers.
 */
(function () {
    'use strict';

    var mount = document.getElementById('ch247-editor');
    if (!mount) { return; }

    var config = {};
    try { config = JSON.parse(mount.getAttribute('data-config') || '{}'); } catch (e) { config = {}; }

    var DEVICES = [
        { key: 'desktop', label: 'Desktop', width: '100%' },
        { key: 'tablet', label: 'Tablet', width: '1024px' },
        { key: 'mobile', label: 'Mobile', width: '390px' }
    ];

    var state = {
        document: { schema: 'cloudhost247-page/v1', version: 1, children: [], meta: {} },
        catalog: { widgets: {}, categories: {} },
        icons: [],
        templates: [],
        menus: [],
        forms: [],
        products: { available: false, items: [], reason: '' },
        groups: { available: false, items: [], reason: '' },
        media: [],
        selection: null,
        device: 'desktop',
        clipboard: null,
        history: [],
        future: [],
        dirty: false,
        saving: false,
        target: {},
        notices: [],
        panel: 'elements',
        lastSavedChecksum: '',
        autosaveSeconds: 45,
        can: { publish: false, media: false, templates: false }
    };

    /* ------------------------------------------------------------ utilities */

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) { node.className = className; }
        if (text !== undefined && text !== null) { node.textContent = String(text); }
        return node;
    }

    function clone(value) { return JSON.parse(JSON.stringify(value)); }

    function api(op, options) {
        options = options || {};
        var url = config.api + encodeURIComponent(op);
        var init = { credentials: 'same-origin', headers: {} };
        if (options.body) {
            init.method = 'POST';
            var body = options.body;
            body.append('token', config.token);
            init.body = body;
        } else if (options.post) {
            init.method = 'POST';
            var form = new FormData();
            form.append('token', config.token);
            Object.keys(options.post).forEach(function (key) { form.append(key, options.post[key]); });
            init.body = form;
        } else {
            init.method = 'GET';
        }
        if (options.query) {
            Object.keys(options.query).forEach(function (key) {
                url += '&' + encodeURIComponent(key) + '=' + encodeURIComponent(options.query[key]);
            });
        }
        return fetch(url, init).then(function (response) {
            return response.json().catch(function () {
                throw new Error('The server returned a response the editor could not read.');
            }).then(function (payload) {
                if (!response.ok || !payload.ok) {
                    throw new Error(payload && payload.error ? payload.error : 'Request failed.');
                }
                return payload;
            });
        });
    }

    /* --------------------------------------------------------- document ops */

    function walk(nodes, visit, parent) {
        nodes.forEach(function (node) {
            visit(node, parent);
            if (node.children && node.children.length) { walk(node.children, visit, node); }
        });
    }

    function findNode(id, nodes, parent) {
        nodes = nodes || state.document.children;
        var found = null;
        for (var i = 0; i < nodes.length && !found; i++) {
            if (nodes[i].id === id) { return { node: nodes[i], parent: parent || null, list: nodes, index: i }; }
            if (nodes[i].children && nodes[i].children.length) {
                found = findNode(id, nodes[i].children, nodes[i]);
            }
        }
        return found;
    }

    function pushHistory() {
        state.history.push(clone(state.document));
        if (state.history.length > 60) { state.history.shift(); }
        state.future = [];
        state.dirty = true;
    }

    function undo() {
        if (!state.history.length) { return; }
        state.future.push(clone(state.document));
        state.document = state.history.pop();
        state.dirty = true;
        repaint('Undone');
    }

    function redo() {
        if (!state.future.length) { return; }
        state.history.push(clone(state.document));
        state.document = state.future.pop();
        state.dirty = true;
        repaint('Redone');
    }

    function newId() {
        var alphabet = 'abcdefghijklmnopqrstuvwxyz';
        var id = alphabet[Math.floor(Math.random() * 26)];
        var chars = alphabet + '0123456789';
        for (var i = 0; i < 11; i++) { id += chars[Math.floor(Math.random() * chars.length)]; }
        return id;
    }

    function freshIds(node) {
        node.id = newId();
        if (node.settings) { node.settings.anchor = ''; }
        (node.children || []).forEach(freshIds);
        return node;
    }

    function widgetDefinition(key) {
        return state.catalog.widgets ? state.catalog.widgets[key] : null;
    }

    function defaultProps(key) {
        var definition = widgetDefinition(key);
        var props = {};
        if (!definition) { return props; }
        (definition.fields || []).forEach(function (field) {
            props[field.key] = field.type === 'items' ? clone(field.default || []) : clone(field.default);
        });
        return props;
    }

    function makeNode(type, widget) {
        var key = type === 'widget' ? widget : type;
        var definition = widgetDefinition(key) || {};
        return {
            id: newId(),
            type: type,
            widget: type === 'widget' ? widget : '',
            props: defaultProps(key),
            style: clone(definition.default_style || {}),
            settings: { css_class: '', anchor: '', hidden: { desktop: false, tablet: false, mobile: false } },
            children: []
        };
    }

    function makeSection() {
        var section = makeNode('section', '');
        var container = makeNode('container', '');
        var column = makeNode('column', '');
        container.children = [column];
        section.children = [container];
        return section;
    }

    function accepts(parentType, childType) {
        var rules = {
            root: ['section'],
            section: ['container'],
            container: ['container', 'column', 'widget'],
            column: ['container', 'widget'],
            widget: []
        };
        return (rules[parentType] || []).indexOf(childType) !== -1;
    }

    /**
     * Insert a node, finding the nearest ancestor that will accept it.
     * A widget dropped on a section lands in that section's first column
     * instead of being refused, which is what an administrator expects.
     */
    function insertNode(node, targetId, index) {
        if (!targetId) {
            if (!accepts('root', node.type)) {
                var wrapper = makeSection();
                wrapper.children[0].children[0].children.push(node);
                state.document.children.splice(indexOrEnd(state.document.children, index), 0, wrapper);
                return wrapper.id;
            }
            state.document.children.splice(indexOrEnd(state.document.children, index), 0, node);
            return node.id;
        }
        var found = findNode(targetId);
        if (!found) { return null; }
        var host = found.node;
        if (accepts(host.type, node.type)) {
            host.children = host.children || [];
            host.children.splice(indexOrEnd(host.children, index), 0, node);
            return node.id;
        }
        if (host.type === 'section') {
            var container = (host.children || [])[0];
            if (!container) { container = makeNode('container', ''); host.children = [container]; }
            return insertNode(node, container.id, index);
        }
        if (host.type === 'container' && node.type === 'widget') {
            var column = (host.children || []).filter(function (child) { return child.type === 'column'; })[0];
            if (!column) { column = makeNode('column', ''); host.children.push(column); }
            return insertNode(node, column.id, index);
        }
        if (host.type === 'widget' && found.parent) {
            return insertNode(node, found.parent.id, found.index + 1);
        }
        return null;
    }

    function indexOrEnd(list, index) {
        if (index === undefined || index === null || index < 0 || index > list.length) { return list.length; }
        return index;
    }

    function removeNode(id) {
        var found = findNode(id);
        if (!found) { return null; }
        found.list.splice(found.index, 1);
        return found;
    }

    function duplicateNode(id) {
        var found = findNode(id);
        if (!found) { return; }
        pushHistory();
        var copy = freshIds(clone(found.node));
        found.list.splice(found.index + 1, 0, copy);
        state.selection = copy.id;
        repaint('Duplicated');
    }

    /* ------------------------------------------------------------- rendering */

    var canvasFrame = null;
    var statusBar = null;

    function repaint(message) {
        renderStructure();
        renderInspector();
        setStatus(message || '');
        var form = new FormData();
        form.append('document', JSON.stringify(state.document));
        api('render', { body: form }).then(function (payload) {
            paintCanvas(payload.html, payload.css, payload.notices);
        }).catch(function (error) {
            setStatus(error.message, true);
        });
    }

    function paintCanvas(html, css, notices) {
        if (!canvasFrame) { return; }
        var doc = canvasFrame.contentDocument;
        if (!doc) { return; }
        var body = doc.body;
        if (!body) { return; }
        doc.getElementById('ch247-page-css').textContent = css || '';
        body.querySelector('.ch247-canvas__content').innerHTML = html || '';
        state.notices = notices || [];
        bindCanvas(doc);
        highlightSelection(doc);
        renderNotices();
        syncFrameHeight();
    }

    function syncFrameHeight() {
        if (!canvasFrame || !canvasFrame.contentDocument) { return; }
        var doc = canvasFrame.contentDocument;
        var height = Math.max(600, doc.body.scrollHeight + 80);
        canvasFrame.style.height = height + 'px';
    }

    function bindCanvas(doc) {
        var nodes = doc.querySelectorAll('[data-ch247-id]');
        Array.prototype.forEach.call(nodes, function (node) {
            node.setAttribute('draggable', 'true');
            node.addEventListener('click', function (event) {
                event.stopPropagation();
                event.preventDefault();
                select(node.getAttribute('data-ch247-id'));
            });
            node.addEventListener('dragstart', function (event) {
                event.stopPropagation();
                event.dataTransfer.setData('text/plain', JSON.stringify({ move: node.getAttribute('data-ch247-id') }));
                event.dataTransfer.effectAllowed = 'move';
            });
            node.addEventListener('dragover', function (event) {
                event.preventDefault();
                event.stopPropagation();
                node.classList.add('ch247-drop-target');
            });
            node.addEventListener('dragleave', function () { node.classList.remove('ch247-drop-target'); });
            node.addEventListener('drop', function (event) {
                event.preventDefault();
                event.stopPropagation();
                node.classList.remove('ch247-drop-target');
                handleDrop(event.dataTransfer.getData('text/plain'), node.getAttribute('data-ch247-id'));
            });
        });

        Array.prototype.forEach.call(doc.querySelectorAll('[data-ch247-inline]'), function (field) {
            var holder = field.closest('[data-ch247-id]');
            if (!holder) { return; }
            field.setAttribute('contenteditable', 'true');
            field.addEventListener('focus', function () { select(holder.getAttribute('data-ch247-id')); });
            field.addEventListener('blur', function () {
                var propName = field.getAttribute('data-ch247-inline');
                var found = findNode(holder.getAttribute('data-ch247-id'));
                if (!found) { return; }
                var value = propName === 'content' ? field.innerHTML : field.textContent;
                if (found.node.props[propName] === value) { return; }
                pushHistory();
                found.node.props[propName] = value;
                repaint('Text updated');
            });
            field.addEventListener('keydown', function (event) {
                if (event.key === 'Enter' && propIsSingleLine(field)) { event.preventDefault(); field.blur(); }
                if (event.key === 'Escape') { field.blur(); }
            });
        });

        Array.prototype.forEach.call(doc.querySelectorAll('[data-ch247-dropzone]'), function (zone) {
            zone.addEventListener('dragover', function (event) {
                event.preventDefault();
                event.stopPropagation();
                zone.classList.add('ch247-drop-target');
            });
            zone.addEventListener('dragleave', function () { zone.classList.remove('ch247-drop-target'); });
            zone.addEventListener('drop', function (event) {
                event.preventDefault();
                event.stopPropagation();
                zone.classList.remove('ch247-drop-target');
                var target = zone.getAttribute('data-ch247-dropzone');
                handleDrop(event.dataTransfer.getData('text/plain'), target === 'root' ? null : target);
            });
        });

        // Links and forms inside the canvas must not navigate the editor away.
        Array.prototype.forEach.call(doc.querySelectorAll('a, form, button'), function (node) {
            node.addEventListener('click', function (event) { event.preventDefault(); });
            node.addEventListener('submit', function (event) { event.preventDefault(); });
        });
    }

    function propIsSingleLine(field) {
        return field.getAttribute('data-ch247-inline') !== 'content';
    }

    function handleDrop(payload, targetId) {
        var data = null;
        try { data = JSON.parse(payload); } catch (e) { return; }
        if (!data) { return; }
        if (data.add) {
            pushHistory();
            var node = data.add === 'section' ? makeSection() : makeNode(data.type || 'widget', data.add);
            var inserted = insertNode(node, targetId, data.index);
            if (!inserted) { setStatus('That element cannot go there.', true); state.history.pop(); return; }
            state.selection = node.id;
            repaint('Added ' + labelFor(data.add));
            return;
        }
        if (data.move) {
            if (data.move === targetId) { return; }
            var moving = findNode(data.move);
            if (!moving) { return; }
            if (targetId && isDescendant(moving.node, targetId)) {
                setStatus('An element cannot be dropped inside itself.', true);
                return;
            }
            pushHistory();
            var copy = clone(moving.node);
            removeNode(data.move);
            if (!insertNode(copy, targetId, undefined)) {
                state.document = state.history.pop();
                setStatus('That element cannot go there.', true);
                repaint();
                return;
            }
            state.selection = copy.id;
            repaint('Moved');
        }
    }

    function isDescendant(node, id) {
        var match = false;
        walk(node.children || [], function (child) { if (child.id === id) { match = true; } });
        return match;
    }

    function labelFor(key) {
        var definition = widgetDefinition(key);
        return definition ? definition.label : key;
    }

    function select(id) {
        state.selection = id;
        state.panel = 'settings';
        renderStructure();
        renderInspector();
        if (canvasFrame && canvasFrame.contentDocument) { highlightSelection(canvasFrame.contentDocument); }
    }

    function highlightSelection(doc) {
        Array.prototype.forEach.call(doc.querySelectorAll('.ch247-selected'), function (node) {
            node.classList.remove('ch247-selected');
        });
        if (!state.selection) { return; }
        var node = doc.querySelector('[data-ch247-id="' + state.selection + '"]');
        if (node) { node.classList.add('ch247-selected'); }
    }

    /* ------------------------------------------------------------------ UI */

    function build() {
        mount.innerHTML = '';
        mount.appendChild(buildToolbar());
        var body = el('div', 'ch247-editor__body');
        body.appendChild(buildSidebar());
        body.appendChild(buildCanvas());
        body.appendChild(buildInspector());
        mount.appendChild(body);
        statusBar = el('div', 'ch247-editor__status');
        mount.appendChild(statusBar);
        document.body.classList.add('ch247-editor-open');
    }

    function buildToolbar() {
        var bar = el('header', 'ch247-editor__toolbar');
        var left = el('div', 'ch247-editor__group');
        var back = el('a', 'ch247-ebtn', 'Exit');
        back.href = config.backUrl;
        left.appendChild(back);
        left.appendChild(el('span', 'ch247-editor__title', config.title || 'Untitled'));
        var badge = el('span', 'ch247-editor__badge', config.kind === 'part' ? 'theme part' : 'page');
        left.appendChild(badge);

        var middle = el('div', 'ch247-editor__group');
        DEVICES.forEach(function (device) {
            var button = el('button', 'ch247-ebtn ch247-ebtn--device' + (device.key === state.device ? ' is-active' : ''), device.label);
            button.type = 'button';
            button.setAttribute('data-device', device.key);
            button.addEventListener('click', function () { setDevice(device.key); });
            middle.appendChild(button);
        });

        var right = el('div', 'ch247-editor__group');
        right.appendChild(toolButton('Undo', undo));
        right.appendChild(toolButton('Redo', redo));
        right.appendChild(toolButton('Save draft', saveDraft, 'ch247-ebtn--primary'));
        right.appendChild(toolButton('Preview', preview));
        if (config.kind === 'page') {
            right.appendChild(toolButton('Publish', publish, 'ch247-ebtn--go'));
            if (config.settingsUrl) {
                var settings = el('a', 'ch247-ebtn', 'Settings');
                settings.href = config.settingsUrl;
                right.appendChild(settings);
            }
        } else {
            right.appendChild(toolButton('Publish part', publish, 'ch247-ebtn--go'));
        }

        bar.appendChild(left);
        bar.appendChild(middle);
        bar.appendChild(right);
        return bar;
    }

    function toolButton(label, handler, extra) {
        var button = el('button', 'ch247-ebtn' + (extra ? ' ' + extra : ''), label);
        button.type = 'button';
        button.addEventListener('click', handler);
        return button;
    }

    function setDevice(device) {
        state.device = device;
        Array.prototype.forEach.call(mount.querySelectorAll('[data-device]'), function (button) {
            button.classList.toggle('is-active', button.getAttribute('data-device') === device);
        });
        var wrap = mount.querySelector('.ch247-editor__frame');
        DEVICES.forEach(function (entry) {
            if (entry.key === device) { wrap.style.maxWidth = entry.width; }
        });
        renderInspector();
        syncFrameHeight();
    }

    var sidebarHost = null;

    function buildSidebar() {
        var aside = el('aside', 'ch247-editor__sidebar');
        var tabs = el('div', 'ch247-editor__tabs');
        [['elements', 'Widgets'], ['structure', 'Structure'], ['templates', 'Templates']].forEach(function (entry) {
            var button = el('button', 'ch247-etab', entry[1]);
            button.type = 'button';
            button.setAttribute('data-tab', entry[0]);
            button.addEventListener('click', function () {
                state.panel = entry[0];
                renderSidebar();
            });
            tabs.appendChild(button);
        });
        aside.appendChild(tabs);
        sidebarHost = el('div', 'ch247-editor__panel');
        aside.appendChild(sidebarHost);
        return aside;
    }

    function renderSidebar() {
        if (!sidebarHost) { return; }
        Array.prototype.forEach.call(mount.querySelectorAll('[data-tab]'), function (button) {
            button.classList.toggle('is-active', button.getAttribute('data-tab') === state.panel);
        });
        sidebarHost.innerHTML = '';
        if (state.panel === 'structure') { return renderStructure(); }
        if (state.panel === 'templates') { return renderTemplates(); }
        renderWidgetList();
    }

    function renderWidgetList() {
        var search = el('input', 'ch247-einput');
        search.type = 'search';
        search.placeholder = 'Search widgets';
        sidebarHost.appendChild(search);

        var listHost = el('div', 'ch247-widgetlist');
        sidebarHost.appendChild(listHost);

        function paint(filter) {
            listHost.innerHTML = '';
            var categories = state.catalog.categories || {};
            Object.keys(categories).forEach(function (categoryKey) {
                var items = Object.keys(state.catalog.widgets || {}).filter(function (key) {
                    var definition = state.catalog.widgets[key];
                    if (definition.category !== categoryKey) { return false; }
                    if (definition.structural && key !== 'section' && key !== 'container' && key !== 'column') { return false; }
                    if (!filter) { return true; }
                    return (definition.label + ' ' + key).toLowerCase().indexOf(filter) !== -1;
                });
                if (!items.length) { return; }
                listHost.appendChild(el('h4', 'ch247-widgetlist__head', categories[categoryKey]));
                var grid = el('div', 'ch247-widgetlist__grid');
                items.forEach(function (key) {
                    var definition = state.catalog.widgets[key];
                    var tile = el('button', 'ch247-widget-tile');
                    tile.type = 'button';
                    tile.setAttribute('draggable', 'true');
                    tile.appendChild(el('span', 'ch247-widget-tile__label', definition.label));
                    if (definition.live_data) {
                        tile.appendChild(el('span', 'ch247-widget-tile__live', 'live data'));
                    }
                    tile.title = definition.description || definition.label;
                    tile.addEventListener('dragstart', function (event) {
                        event.dataTransfer.setData('text/plain', JSON.stringify({
                            add: key, type: definition.structural ? key : 'widget'
                        }));
                        event.dataTransfer.effectAllowed = 'copy';
                    });
                    tile.addEventListener('click', function () {
                        pushHistory();
                        var node = key === 'section' ? makeSection() : makeNode(definition.structural ? key : 'widget', key);
                        var targetId = state.selection;
                        if (!insertNode(node, targetId, undefined) && !insertNode(node, null, undefined)) {
                            state.history.pop();
                            setStatus('That element cannot go there.', true);
                            return;
                        }
                        state.selection = node.id;
                        repaint('Added ' + definition.label);
                    });
                    grid.appendChild(tile);
                });
                listHost.appendChild(grid);
            });
        }

        search.addEventListener('input', function () { paint(search.value.trim().toLowerCase()); });
        paint('');
    }

    function renderTemplates() {
        if (!state.templates.length) {
            sidebarHost.appendChild(el('p', 'ch247-edim', 'No templates available.'));
            return;
        }
        state.templates.forEach(function (template) {
            var card = el('div', 'ch247-template-card');
            card.appendChild(el('strong', null, template.name));
            card.appendChild(el('span', 'ch247-edim', template.category + (template.builtin ? ' - built-in' : '')));
            var insert = el('button', 'ch247-ebtn ch247-ebtn--sm', 'Insert');
            insert.type = 'button';
            insert.addEventListener('click', function () {
                api('template.insert', { post: { template_id: template.id } }).then(function (payload) {
                    pushHistory();
                    payload.children.forEach(function (child) { state.document.children.push(child); });
                    repaint('Inserted "' + payload.name + '"');
                }).catch(function (error) { setStatus(error.message, true); });
            });
            card.appendChild(insert);
            sidebarHost.appendChild(card);
        });

        if (state.can.templates) {
            var save = el('div', 'ch247-template-save');
            save.appendChild(el('h4', null, 'Save as template'));
            var name = el('input', 'ch247-einput');
            name.placeholder = 'Template name';
            var key = el('input', 'ch247-einput');
            key.placeholder = 'template-key';
            var scope = el('select', 'ch247-einput');
            [['page', 'Whole page'], ['selection', 'Selected element']].forEach(function (entry) {
                var option = el('option', null, entry[1]);
                option.value = entry[0];
                scope.appendChild(option);
            });
            var button = el('button', 'ch247-ebtn ch247-ebtn--primary ch247-ebtn--sm', 'Save template');
            button.type = 'button';
            button.addEventListener('click', function () {
                var form = new FormData();
                form.append('document', JSON.stringify(state.document));
                form.append('name', name.value);
                form.append('template_key', key.value);
                form.append('category', scope.value === 'page' ? 'page' : 'section');
                if (scope.value === 'selection' && state.selection) { form.append('node_id', state.selection); }
                api('template.save', { body: form }).then(function (payload) {
                    setStatus(payload.message);
                    loadState(false);
                }).catch(function (error) { setStatus(error.message, true); });
            });
            save.appendChild(name);
            save.appendChild(key);
            save.appendChild(scope);
            save.appendChild(button);
            sidebarHost.appendChild(save);
        }
    }

    function renderStructure() {
        if (state.panel !== 'structure' || !sidebarHost) { return; }
        sidebarHost.innerHTML = '';
        var tree = el('ul', 'ch247-tree');
        function paint(nodes, host, depth) {
            nodes.forEach(function (node) {
                var item = el('li', 'ch247-tree__item' + (node.id === state.selection ? ' is-selected' : ''));
                var row = el('button', 'ch247-tree__row');
                row.type = 'button';
                row.style.paddingLeft = (8 + depth * 12) + 'px';
                row.textContent = node.type === 'widget' ? labelFor(node.widget) : labelFor(node.type);
                row.addEventListener('click', function () { select(node.id); });
                item.appendChild(row);
                if (node.children && node.children.length) {
                    var sub = el('ul', 'ch247-tree__children');
                    paint(node.children, sub, depth + 1);
                    item.appendChild(sub);
                }
                host.appendChild(item);
            });
        }
        paint(state.document.children, tree, 0);
        if (!state.document.children.length) {
            sidebarHost.appendChild(el('p', 'ch247-edim', 'The page is empty. Add a section from the Widgets tab.'));
        }
        sidebarHost.appendChild(tree);
    }

    function buildCanvas() {
        var wrap = el('div', 'ch247-editor__canvas');
        var frameWrap = el('div', 'ch247-editor__frame');
        canvasFrame = document.createElement('iframe');
        canvasFrame.className = 'ch247-editor__iframe';
        canvasFrame.setAttribute('title', 'Page canvas');
        frameWrap.appendChild(canvasFrame);
        wrap.appendChild(frameWrap);
        var notices = el('div', 'ch247-editor__notices');
        notices.id = 'ch247-editor-notices';
        wrap.appendChild(notices);
        return wrap;
    }

    function prepareFrame(rootCss) {
        var doc = canvasFrame.contentDocument;
        doc.open();
        doc.write('<!doctype html><html><head><meta charset="utf-8">'
            + '<link rel="stylesheet" href="' + canvasAsset('runtime.css') + '">'
            + '<style id="ch247-root-css"></style><style id="ch247-page-css"></style>'
            + '<style>body{margin:0;background:var(--ch247-color-background,#f8fafc)}'
            + '[data-ch247-id]{outline:1px dashed rgba(7,86,216,.18);outline-offset:-1px;min-height:12px}'
            + '[data-ch247-id]:hover{outline:1px solid rgba(7,86,216,.5)}'
            + '.ch247-selected{outline:2px solid #0756d8 !important;outline-offset:-2px}'
            + '.ch247-drop-target{background:rgba(7,86,216,.08);outline:2px dashed #0756d8 !important}'
            + '.ch247-dropzone{padding:24px;text-align:center;color:#64748b;border:1px dashed #cbd5f5;border-radius:8px;margin:8px}'
            + '.ch247-empty-page{padding:60px 20px;text-align:center;color:#64748b}'
            + '.ch247-unavailable{display:flex;gap:8px;align-items:center;padding:10px 12px;border:1px dashed #f59f00;'
            + 'background:#fff8e6;color:#92400e;border-radius:8px;font:500 13px/1.4 system-ui,sans-serif}'
            + '[contenteditable="true"]:focus{outline:2px solid #12b886;outline-offset:2px}'
            + '</style></head><body><div class="ch247-root ch247-canvas"><div class="ch247-canvas__content"></div></div></body></html>');
        doc.close();
        doc.getElementById('ch247-root-css').textContent = rootCss || '';
        doc.addEventListener('click', function () { select(null); });
    }

    function canvasAsset(name) {
        return config.api.replace('&ajax=1&op=', '&asset=') + name;
    }

    function renderNotices() {
        var host = document.getElementById('ch247-editor-notices');
        if (!host) { return; }
        host.innerHTML = '';
        if (!state.notices.length) { return; }
        host.appendChild(el('h4', null, 'Live data notices'));
        var list = el('ul', null);
        state.notices.forEach(function (notice) { list.appendChild(el('li', null, notice)); });
        host.appendChild(list);
        host.appendChild(el('p', 'ch247-edim',
            'These blocks are shown with a notice here and are left out of the published page until the data is available.'));
    }

    /* ------------------------------------------------------------ inspector */

    var inspectorHost = null;

    function buildInspector() {
        var aside = el('aside', 'ch247-editor__inspector');
        inspectorHost = el('div', 'ch247-editor__panel');
        aside.appendChild(inspectorHost);
        return aside;
    }

    function renderInspector() {
        if (!inspectorHost) { return; }
        inspectorHost.innerHTML = '';
        if (!state.selection) {
            inspectorHost.appendChild(el('p', 'ch247-edim', 'Select an element on the canvas to edit its content and style.'));
            return;
        }
        var found = findNode(state.selection);
        if (!found) {
            state.selection = null;
            return renderInspector();
        }
        var node = found.node;
        var key = node.type === 'widget' ? node.widget : node.type;
        var definition = widgetDefinition(key) || { label: key, fields: [] };

        var head = el('div', 'ch247-inspector__head');
        head.appendChild(el('h3', null, definition.label));
        var actions = el('div', 'ch247-inspector__actions');
        actions.appendChild(smallButton('Duplicate', function () { duplicateNode(node.id); }));
        actions.appendChild(smallButton('Copy', function () {
            state.clipboard = clone(node);
            setStatus('Copied ' + definition.label);
        }));
        actions.appendChild(smallButton('Paste into', function () {
            if (!state.clipboard) { return setStatus('Nothing copied yet.', true); }
            pushHistory();
            var copy = freshIds(clone(state.clipboard));
            if (!insertNode(copy, node.id, undefined)) {
                state.history.pop();
                return setStatus('That element cannot go there.', true);
            }
            state.selection = copy.id;
            repaint('Pasted');
        }));
        actions.appendChild(smallButton('Delete', function () {
            pushHistory();
            removeNode(node.id);
            state.selection = null;
            repaint('Deleted');
        }, 'ch247-ebtn--danger'));
        head.appendChild(actions);
        inspectorHost.appendChild(head);

        var tabs = el('div', 'ch247-editor__tabs ch247-editor__tabs--sub');
        ['Content', 'Style', 'Advanced'].forEach(function (label, index) {
            var button = el('button', 'ch247-etab' + (index === 0 ? ' is-active' : ''), label);
            button.type = 'button';
            button.addEventListener('click', function () {
                Array.prototype.forEach.call(tabs.children, function (tab) { tab.classList.remove('is-active'); });
                button.classList.add('is-active');
                Array.prototype.forEach.call(inspectorHost.querySelectorAll('[data-pane]'), function (pane) {
                    pane.hidden = pane.getAttribute('data-pane') !== label.toLowerCase();
                });
            });
            tabs.appendChild(button);
        });
        inspectorHost.appendChild(tabs);

        var content = el('div', 'ch247-inspector__pane');
        content.setAttribute('data-pane', 'content');
        (definition.fields || []).forEach(function (field) {
            content.appendChild(buildField(node, field));
        });
        if (!(definition.fields || []).length) {
            content.appendChild(el('p', 'ch247-edim', 'This element has no content settings.'));
        }
        inspectorHost.appendChild(content);

        var style = el('div', 'ch247-inspector__pane');
        style.setAttribute('data-pane', 'style');
        style.hidden = true;
        style.appendChild(buildStylePane(node));
        inspectorHost.appendChild(style);

        var advanced = el('div', 'ch247-inspector__pane');
        advanced.setAttribute('data-pane', 'advanced');
        advanced.hidden = true;
        advanced.appendChild(buildAdvancedPane(node));
        inspectorHost.appendChild(advanced);
    }

    function smallButton(label, handler, extra) {
        var button = el('button', 'ch247-ebtn ch247-ebtn--sm' + (extra ? ' ' + extra : ''), label);
        button.type = 'button';
        button.addEventListener('click', handler);
        return button;
    }

    function buildField(node, field) {
        var wrap = el('label', 'ch247-efield');
        wrap.appendChild(el('span', 'ch247-efield__label', field.label));
        var value = node.props[field.key];
        var control;

        switch (field.type) {
            case 'textarea':
            case 'richtext':
                control = el('textarea', 'ch247-einput');
                control.rows = field.type === 'richtext' ? 6 : 3;
                control.value = value === undefined || value === null ? '' : value;
                control.addEventListener('change', function () { commit(node, field.key, control.value); });
                break;
            case 'toggle':
                control = el('input');
                control.type = 'checkbox';
                control.checked = !!value;
                control.addEventListener('change', function () { commit(node, field.key, control.checked); });
                break;
            case 'number':
                control = el('input', 'ch247-einput');
                control.type = 'number';
                if (field.min !== undefined) { control.min = field.min; }
                if (field.max !== undefined) { control.max = field.max; }
                control.value = value === undefined || value === null ? '' : value;
                control.addEventListener('change', function () { commit(node, field.key, control.value); });
                break;
            case 'select':
                control = el('select', 'ch247-einput');
                Object.keys(field.options || {}).forEach(function (optionKey) {
                    var option = el('option', null, field.options[optionKey]);
                    option.value = optionKey;
                    if (String(value) === optionKey) { option.selected = true; }
                    control.appendChild(option);
                });
                control.addEventListener('change', function () { commit(node, field.key, control.value); });
                break;
            case 'icon':
                control = el('select', 'ch247-einput');
                var none = el('option', null, 'None');
                none.value = '';
                control.appendChild(none);
                state.icons.forEach(function (icon) {
                    var option = el('option', null, icon);
                    option.value = icon;
                    if (value === icon) { option.selected = true; }
                    control.appendChild(option);
                });
                control.addEventListener('change', function () { commit(node, field.key, control.value); });
                break;
            case 'media':
                return buildMediaField(node, field);
            case 'items':
                return buildRepeater(node, field);
            case 'product':
                control = buildLookup(field, state.products, value, function (selected) { commit(node, field.key, selected); });
                break;
            case 'productgroup':
                control = buildLookup(field, state.groups, value, function (selected) { commit(node, field.key, selected); });
                break;
            case 'menu':
                control = buildOptionList(state.menus, value, function (selected) { commit(node, field.key, selected); },
                    'No menus yet. Create one under Navigation Menus.');
                break;
            case 'form':
                control = buildOptionList(state.forms, value, function (selected) { commit(node, field.key, selected); },
                    'No forms yet. Create one under Forms.');
                break;
            case 'color':
                control = el('input', 'ch247-einput');
                control.type = 'text';
                control.value = value === undefined || value === null ? '' : value;
                control.placeholder = 'primary, #0756d8 or rgba(...)';
                control.addEventListener('change', function () { commit(node, field.key, control.value); });
                break;
            default:
                control = el('input', 'ch247-einput');
                control.type = 'text';
                if (field.max_length) { control.maxLength = field.max_length; }
                control.value = value === undefined || value === null ? '' : value;
                control.addEventListener('change', function () { commit(node, field.key, control.value); });
        }
        wrap.appendChild(control);
        if (field.help) { wrap.appendChild(el('small', 'ch247-edim', field.help)); }
        return wrap;
    }

    function buildLookup(field, source, value, onChange) {
        if (!source.available) {
            var warning = el('div', 'ch247-ewarn');
            warning.appendChild(el('span', null, source.reason || 'Live data is unavailable, so this list cannot be populated.'));
            return warning;
        }
        var select = el('select', 'ch247-einput');
        var none = el('option', null, 'Not selected');
        none.value = '0';
        select.appendChild(none);
        source.items.forEach(function (item) {
            var label = item.name + (item.group ? ' - ' + item.group : '') + (item.price ? ' - ' + item.price : '');
            var option = el('option', null, label);
            option.value = item.id;
            if (String(value) === String(item.id)) { option.selected = true; }
            select.appendChild(option);
        });
        select.addEventListener('change', function () { onChange(select.value); });
        return select;
    }

    function buildOptionList(items, value, onChange, emptyMessage) {
        if (!items.length) {
            var warning = el('div', 'ch247-ewarn');
            warning.appendChild(el('span', null, emptyMessage));
            return warning;
        }
        var select = el('select', 'ch247-einput');
        var none = el('option', null, 'Not selected');
        none.value = '0';
        select.appendChild(none);
        items.forEach(function (item) {
            var option = el('option', null, item.name + (item.enabled === false ? ' (disabled)' : ''));
            option.value = item.id;
            if (String(value) === String(item.id)) { option.selected = true; }
            select.appendChild(option);
        });
        select.addEventListener('change', function () { onChange(select.value); });
        return select;
    }

    function buildMediaField(node, field) {
        var wrap = el('div', 'ch247-efield');
        wrap.appendChild(el('span', 'ch247-efield__label', field.label));
        var current = node.props[field.key] || { id: 0, url: '', alt: '' };
        if (current.url) {
            var preview = document.createElement('img');
            preview.className = 'ch247-media-preview';
            preview.src = current.url;
            preview.alt = current.alt || '';
            wrap.appendChild(preview);
        }
        var row = el('div', 'ch247-erow');
        var choose = smallButton(current.url ? 'Change image' : 'Choose image', function () {
            openMediaPicker(function (item) {
                commit(node, field.key, { id: item.id, url: item.url_path, alt: item.alt_text });
            });
        });
        row.appendChild(choose);
        if (current.url) {
            row.appendChild(smallButton('Remove', function () {
                commit(node, field.key, { id: 0, url: '', alt: '' });
            }));
        }
        wrap.appendChild(row);
        return wrap;
    }

    function buildRepeater(node, field) {
        var wrap = el('div', 'ch247-efield ch247-repeater');
        wrap.appendChild(el('span', 'ch247-efield__label', field.label));
        var items = Array.isArray(node.props[field.key]) ? node.props[field.key] : [];
        items.forEach(function (item, index) {
            var row = el('div', 'ch247-repeater__item');
            var header = el('div', 'ch247-repeater__head');
            header.appendChild(el('strong', null, '#' + (index + 1)));
            header.appendChild(smallButton('Up', function () {
                if (index === 0) { return; }
                pushHistory();
                items.splice(index - 1, 0, items.splice(index, 1)[0]);
                repaint('Reordered');
            }));
            header.appendChild(smallButton('Down', function () {
                if (index >= items.length - 1) { return; }
                pushHistory();
                items.splice(index + 1, 0, items.splice(index, 1)[0]);
                repaint('Reordered');
            }));
            header.appendChild(smallButton('Remove', function () {
                pushHistory();
                items.splice(index, 1);
                repaint('Removed item');
            }, 'ch247-ebtn--danger'));
            row.appendChild(header);
            (field.fields || []).forEach(function (subField) {
                var proxy = { props: item, id: node.id, type: node.type, widget: node.widget };
                row.appendChild(buildField(proxy, subField));
            });
            wrap.appendChild(row);
        });
        var add = smallButton('Add item', function () {
            pushHistory();
            var fresh = {};
            (field.fields || []).forEach(function (subField) {
                fresh[subField.key] = subField.type === 'media' ? { id: 0, url: '', alt: '' } : clone(subField.default);
            });
            if (!Array.isArray(node.props[field.key])) { node.props[field.key] = []; }
            node.props[field.key].push(fresh);
            repaint('Item added');
        }, 'ch247-ebtn--primary');
        wrap.appendChild(add);
        return wrap;
    }

    function commit(node, key, value) {
        pushHistory();
        node.props[key] = value;
        repaint('Updated');
    }

    function buildStylePane(node) {
        var pane = el('div', null);
        var deviceNote = el('p', 'ch247-edim',
            'Editing ' + state.device + ' values. Tablet and mobile inherit desktop until you set them.');
        pane.appendChild(deviceNote);

        var bucket = node.style[state.device] || {};
        var groups = {
            'Spacing': ['margin_top', 'margin_bottom', 'padding_top', 'padding_bottom', 'padding_left', 'padding_right', 'gap'],
            'Size': ['width', 'max_width', 'min_height', 'height', 'flex_basis', 'flex_grow', 'grid_columns'],
            'Layout': ['display', 'flex_direction', 'flex_wrap', 'justify_content', 'align_items', 'text_align'],
            'Typography': ['font_family', 'font_size', 'font_weight', 'line_height', 'letter_spacing', 'text_transform', 'color'],
            'Background': ['background_color', 'gradient_from', 'gradient_to', 'gradient_angle', 'background_image', 'background_size', 'background_position', 'overlay_color', 'overlay_opacity'],
            'Border': ['border_width', 'border_style', 'border_color', 'border_radius', 'box_shadow'],
            'Other': ['opacity', 'z_index', 'position', 'overflow']
        };
        Object.keys(groups).forEach(function (groupName) {
            var fields = groups[groupName].filter(function (property) {
                return (state.catalog.style_properties || []).indexOf(property) !== -1;
            });
            if (!fields.length) { return; }
            var details = el('details', 'ch247-stylegroup');
            if (groupName === 'Spacing') { details.open = true; }
            details.appendChild(el('summary', null, groupName));
            fields.forEach(function (property) {
                var row = el('label', 'ch247-efield ch247-efield--inline');
                row.appendChild(el('span', 'ch247-efield__label', property.replace(/_/g, ' ')));
                var input = el('input', 'ch247-einput');
                input.type = 'text';
                input.value = bucket[property] === undefined ? '' : bucket[property];
                input.placeholder = 'inherit';
                input.addEventListener('change', function () {
                    pushHistory();
                    if (!node.style[state.device]) { node.style[state.device] = {}; }
                    if (input.value.trim() === '') {
                        delete node.style[state.device][property];
                    } else {
                        node.style[state.device][property] = input.value.trim();
                    }
                    repaint('Style updated');
                });
                row.appendChild(input);
                details.appendChild(row);
            });
            pane.appendChild(details);
        });

        var visibility = el('div', 'ch247-stylegroup');
        visibility.appendChild(el('h4', null, 'Visibility'));
        DEVICES.forEach(function (device) {
            var row = el('label', 'ch247-echeck');
            var input = el('input');
            input.type = 'checkbox';
            input.checked = !!(node.settings.hidden && node.settings.hidden[device.key]);
            input.addEventListener('change', function () {
                pushHistory();
                if (!node.settings.hidden) { node.settings.hidden = {}; }
                node.settings.hidden[device.key] = input.checked;
                repaint('Visibility updated');
            });
            row.appendChild(input);
            row.appendChild(el('span', null, 'Hide on ' + device.label.toLowerCase()));
            visibility.appendChild(row);
        });
        pane.appendChild(visibility);
        return pane;
    }

    function buildAdvancedPane(node) {
        var pane = el('div', null);
        [['css_class', 'CSS classes', 'space separated'], ['anchor', 'Anchor id', 'used for #links']].forEach(function (entry) {
            var wrap = el('label', 'ch247-efield');
            wrap.appendChild(el('span', 'ch247-efield__label', entry[1]));
            var input = el('input', 'ch247-einput');
            input.type = 'text';
            input.placeholder = entry[2];
            input.value = node.settings[entry[0]] || '';
            input.addEventListener('change', function () {
                pushHistory();
                node.settings[entry[0]] = input.value;
                repaint('Updated');
            });
            wrap.appendChild(input);
            pane.appendChild(wrap);
        });
        pane.appendChild(el('p', 'ch247-edim', 'Element id: ' + node.id));
        return pane;
    }

    /* --------------------------------------------------------- media picker */

    function openMediaPicker(onPick) {
        var overlay = el('div', 'ch247-modal');
        var panel = el('div', 'ch247-modal__panel');
        panel.appendChild(el('h3', null, 'Media library'));
        var grid = el('div', 'ch247-modal__grid');
        panel.appendChild(grid);

        if (state.can.media) {
            var upload = el('input');
            upload.type = 'file';
            upload.className = 'ch247-einput';
            upload.addEventListener('change', function () {
                if (!upload.files || !upload.files[0]) { return; }
                var form = new FormData();
                form.append('file', upload.files[0]);
                api('upload', { body: form }).then(function (payload) {
                    setStatus(payload.duplicate ? 'That file was already in the library.' : 'Uploaded.');
                    load();
                }).catch(function (error) { setStatus(error.message, true); });
            });
            panel.appendChild(upload);
        }

        var close = el('button', 'ch247-ebtn', 'Close');
        close.type = 'button';
        close.addEventListener('click', function () { document.body.removeChild(overlay); });
        panel.appendChild(close);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        function load() {
            grid.innerHTML = 'Loading...';
            api('media', { query: { images_only: 1 } }).then(function (payload) {
                grid.innerHTML = '';
                if (!payload.items.length) {
                    grid.appendChild(el('p', 'ch247-edim', 'Nothing in the media library yet.'));
                    return;
                }
                payload.items.forEach(function (item) {
                    var tile = el('button', 'ch247-modal__tile');
                    tile.type = 'button';
                    var image = document.createElement('img');
                    image.src = item.url_path;
                    image.alt = item.alt_text || '';
                    tile.appendChild(image);
                    tile.appendChild(el('span', null, item.file_name));
                    tile.addEventListener('click', function () {
                        onPick(item);
                        document.body.removeChild(overlay);
                    });
                    grid.appendChild(tile);
                });
            }).catch(function (error) {
                grid.innerHTML = '';
                grid.appendChild(el('p', 'ch247-ewarn', error.message));
            });
        }
        load();
    }

    /* -------------------------------------------------------------- actions */

    function setStatus(message, isError) {
        if (!statusBar) { return; }
        statusBar.textContent = message || (state.dirty ? 'Unsaved changes' : 'All changes saved');
        statusBar.className = 'ch247-editor__status' + (isError ? ' is-error' : '');
    }

    function saveDraft(silent) {
        if (state.saving) { return Promise.resolve(); }
        state.saving = true;
        setStatus('Saving...');
        var form = new FormData();
        form.append('document', JSON.stringify(state.document));
        if (config.kind === 'part') { form.append('part_id', config.partId); }
        form.append('page_id', config.pageId);
        var operation = config.kind === 'part' ? 'part.save' : (silent === true ? 'autosave' : 'save');
        return api(operation, { body: form }).then(function (payload) {
            state.saving = false;
            state.dirty = false;
            state.lastSavedChecksum = payload.checksum || state.lastSavedChecksum;
            setStatus(payload.message || 'Saved');
        }).catch(function (error) {
            state.saving = false;
            setStatus(error.message, true);
        });
    }

    function publish() {
        var label = config.kind === 'part' ? 'Publish this theme part?' : 'Publish this page to the live site?';
        if (!window.confirm(label)) { return; }
        var form = new FormData();
        form.append('document', JSON.stringify(state.document));
        form.append('page_id', config.pageId);
        form.append('part_id', config.partId);
        api(config.kind === 'part' ? 'part.publish' : 'publish', { body: form }).then(function (payload) {
            state.dirty = false;
            setStatus(payload.message || 'Published');
        }).catch(function (error) { setStatus(error.message, true); });
    }

    function preview() {
        var form = new FormData();
        form.append('document', JSON.stringify(state.document));
        form.append('page_id', config.pageId);
        api('preview', { body: form }).then(function (payload) {
            window.open(payload.url, '_blank', 'noopener');
            setStatus('Preview link opened. It expires in ' + Math.round(payload.expires_in / 60) + ' minutes.');
        }).catch(function (error) { setStatus(error.message, true); });
    }

    /* ----------------------------------------------------------------- boot */

    function loadState(initial) {
        return api('state', {
            query: config.kind === 'part' ? { part_id: config.partId } : { page_id: config.pageId }
        }).then(function (payload) {
            state.document = payload.document;
            state.catalog = payload.catalog;
            state.icons = payload.icons || [];
            state.templates = payload.templates || [];
            state.menus = payload.menus || [];
            state.forms = payload.forms || [];
            state.products = payload.products || { available: false, items: [], reason: '' };
            state.groups = payload.product_groups || { available: false, items: [], reason: '' };
            state.target = payload.target || {};
            state.lastSavedChecksum = payload.checksum;
            state.autosaveSeconds = payload.autosave_seconds || 45;
            state.can = {
                publish: !!payload.can_publish,
                media: !!payload.can_media,
                templates: !!payload.can_templates
            };
            if (initial) {
                build();
                prepareFrame(payload.root_css);
                renderSidebar();
            }
            paintCanvas(payload.html, payload.css, payload.notices);
            renderInspector();
            setStatus('Loaded ' + (state.target.title || ''));
        }).catch(function (error) {
            mount.innerHTML = '';
            var box = el('div', 'ch247-editor__error');
            box.appendChild(el('h2', null, 'The editor could not start'));
            box.appendChild(el('p', null, error.message));
            var back = el('a', 'ch247-ebtn', 'Back');
            back.href = config.backUrl;
            box.appendChild(back);
            mount.appendChild(box);
        });
    }

    document.addEventListener('keydown', function (event) {
        if (!(event.ctrlKey || event.metaKey)) { return; }
        var key = event.key.toLowerCase();
        if (key === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
        else if ((key === 'z' && event.shiftKey) || key === 'y') { event.preventDefault(); redo(); }
        else if (key === 's') { event.preventDefault(); saveDraft(false); }
        else if (key === 'd' && state.selection) { event.preventDefault(); duplicateNode(state.selection); }
    });

    window.addEventListener('beforeunload', function (event) {
        if (!state.dirty) { return; }
        event.preventDefault();
        event.returnValue = '';
    });

    window.setInterval(function () {
        if (state.dirty && !state.saving) { saveDraft(true); }
    }, 45000);

    loadState(true);
}());
