// Turns a self-contained HTML report (the debrief's "Download PDF") into an A4 PDF in the
// browser, so the download opens in any PDF viewer instead of as a web page.
//
// The report is laid out in an off-screen frame at a fixed desktop width, drawn page by page with
// html2canvas and placed on A4 pages with jsPDF. Page breaks fall between cards, or between table
// rows / list items inside a long card, never through a line of text. The pages are pictures of
// the report, so the text in the PDF cannot be selected or searched.
//
// Both libraries are loaded on the first download only (vendor/, stored by the service worker for
// offline use). window.reportToPdf(html, filename) resolves once the file has been handed to the
// browser and rejects if anything fails, so the caller can fall back to the HTML file.
(function () {
    var loading = {};
    var load = function (src) {
        if (!loading[src]) {
            loading[src] = new Promise(function (resolve, reject) {
                var s = document.createElement('script');
                s.src = src;
                s.onload = function () { resolve(); };
                s.onerror = function () { delete loading[src]; s.remove(); reject(new Error('Could not load ' + src)); };
                document.head.appendChild(s);
            });
        }
        return loading[src];
    };

    // The report's body is max 1000px wide with 24px padding either side.
    var FRAME_W = 1048;
    // A4 in mm, with a margin all round and room at the bottom for the page number.
    var PAGE_W = 210, PAGE_H = 297, MARGIN = 10, FOOTER = 6;
    var CONTENT_W = PAGE_W - 2 * MARGIN;
    var CONTENT_H = PAGE_H - 2 * MARGIN - FOOTER;
    var PX_PER_MM = FRAME_W / CONTENT_W;
    var PAGE_PX = Math.floor(CONTENT_H * PX_PER_MM);

    // Where a page may end: just above a card (preferred), or above a row, list item, chart or
    // heading inside one. Positions are in CSS px from the top of the report.
    var breakPoints = function (doc) {
        var top = function (el) { return Math.round(el.getBoundingClientRect().top + doc.defaultView.scrollY); };
        var cards = Array.prototype.map.call(doc.querySelectorAll('.card, h1'), top);
        var minor = Array.prototype.map.call(doc.querySelectorAll('tr, li, .mini, .timeline, h3, h4, p'), top);
        return { cards: cards.sort(function (a, b) { return a - b; }), minor: minor.sort(function (a, b) { return a - b; }) };
    };

    var nextBreak = function (start, total, points) {
        var limit = start + PAGE_PX;
        if (limit >= total) return total;
        var best = function (list, floor) {
            var pick = -1;
            for (var i = 0; i < list.length; i++) { if (list[i] > floor && list[i] <= limit) pick = list[i]; }
            return pick;
        };
        // A card break wins if it still fills at least a third of the page.
        var c = best(points.cards, start + PAGE_PX / 3);
        if (c > 0) return c;
        var m = best(points.minor, start + 40);
        return m > 0 ? m : limit;
    };

    var safeName = function (name) {
        var n = String(name || 'Report').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
        return /\.pdf$/i.test(n) ? n : n + '.pdf';
    };

    window.reportToPdf = function (html, filename) {
        var frame;
        return Promise.all([load('vendor/html2canvas.min.js'), load('vendor/jspdf.umd.min.js')]).then(function () {
            if (!window.html2canvas || !window.jspdf || !window.jspdf.jsPDF) throw new Error('PDF libraries unavailable');
            frame = document.createElement('iframe');
            frame.setAttribute('aria-hidden', 'true');
            frame.tabIndex = -1;
            frame.style.cssText = 'position:fixed;left:-20000px;top:0;width:' + FRAME_W + 'px;height:800px;border:0;pointer-events:none;';
            document.body.appendChild(frame);
            var doc = frame.contentDocument;
            doc.open(); doc.write(html); doc.close();
            // html2canvas misplaces text with line-height "normal" and draws list numbers out of
            // line, so the PDF copy gets explicit line heights and written-out list numbers.
            var fix = doc.createElement('style');
            fix.textContent = 'body{line-height:1.4}.chip{white-space:nowrap;border-radius:0!important;padding:0 0 0 5px!important}ol{list-style:none;padding-left:0!important}ol>li>.pdf-num{display:inline-block;min-width:28px;text-align:right;padding-right:6px;color:#475569}';
            doc.head.appendChild(fix);
            // html2canvas draws a small pill's text below its background, so each coloured pill
            // becomes a colour bar beside dark text.
            Array.prototype.forEach.call(doc.querySelectorAll('.chip'), function (chip) {
                var bg = chip.style.backgroundColor || chip.style.background;
                chip.style.background = 'none'; chip.style.color = '#334155';
                if (bg) chip.style.borderLeft = '6px solid ' + bg;
            });
            Array.prototype.forEach.call(doc.querySelectorAll('ol'), function (ol) {
                var n = ol.start || 1;
                Array.prototype.forEach.call(ol.children, function (li) {
                    if (li.tagName !== 'LI') return;
                    if (li.hasAttribute('value')) n = li.value;
                    var num = doc.createElement('span'); num.className = 'pdf-num'; num.textContent = n + '.';
                    li.insertBefore(num, li.firstChild);
                    n++;
                });
            });
            // Let the frame lay out (and any web fonts settle) before measuring.
            return new Promise(function (resolve) { setTimeout(resolve, 50); }).then(function () {
                return doc.fonts && doc.fonts.ready ? doc.fonts.ready : null;
            }).then(function () { return doc; });
        }).then(function (doc) {
            var body = doc.body;
            var total = Math.ceil(Math.max(body.scrollHeight, doc.documentElement.scrollHeight));
            frame.style.height = total + 'px';
            var points = breakPoints(doc);
            var slices = [];
            for (var y = 0; y < total;) { var end = nextBreak(y, total, points); slices.push([y, end]); y = end; }
            var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
            pdf.setProperties({ title: String(filename || 'Report').replace(/\.pdf$/i, ''), creator: 'EM Simulator' });
            var draw = function (i) {
                if (i >= slices.length) return pdf;
                var y0 = slices[i][0], h = slices[i][1] - slices[i][0];
                return window.html2canvas(doc.documentElement, {
                    backgroundColor: '#ffffff', scale: 2, logging: false, useCORS: true,
                    x: 0, y: y0, width: FRAME_W, height: h,
                    windowWidth: FRAME_W, windowHeight: total, scrollX: 0, scrollY: 0
                }).then(function (canvas) {
                    if (i > 0) pdf.addPage();
                    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN, MARGIN, CONTENT_W, h / PX_PER_MM, undefined, 'FAST');
                    pdf.setFontSize(8); pdf.setTextColor(100, 116, 139);
                    pdf.text('Page ' + (i + 1) + ' of ' + slices.length, PAGE_W - MARGIN, PAGE_H - MARGIN / 2 - 1, { align: 'right' });
                    canvas.width = canvas.height = 0;
                    return draw(i + 1);
                });
            };
            return draw(0);
        }).then(function (pdf) {
            pdf.save(safeName(filename));
        }).finally(function () {
            if (frame) frame.remove();
        });
    };
})();
