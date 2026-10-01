// Prints the instructor guides (guides/*.html) to A4 PDFs beside them, so the website's
// "Download PDF" links always match the pages. Run it after editing a guide, and commit the PDFs:
//
//     cd tests && npm ci && cd .. && node scripts/build-guides.mjs
//
// It uses the Playwright Chromium the tests already install. Netlify does not run it.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'tests', 'package.json'));
const { chromium } = require('playwright');

const GUIDES = [
    { page: 'quick-start.html', pdf: 'EM-Evidence-Sim-Quick-Start-Guide.pdf', title: 'Quick Start Guide' },
    { page: 'instructor-guide.html', pdf: 'EM-Evidence-Sim-Full-Instructor-Guide.pdf', title: 'Full Instructor Guide' }
];

const footer = (title) => `<div style="width:100%;font:8px system-ui,sans-serif;color:#64748b;padding:0 14mm;display:flex;justify-content:space-between;">
    <span>EM Evidence Sim · ${title}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

const browser = await chromium.launch();
try {
    const page = await browser.newPage();
    for (const g of GUIDES) {
        await page.goto(pathToFileURL(path.join(ROOT, 'guides', g.page)).href, { waitUntil: 'load' });
        await page.pdf({
            path: path.join(ROOT, 'guides', g.pdf),
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: true,
            headerTemplate: '<div></div>',
            footerTemplate: footer(g.title)
        });
        console.log('[guides] wrote guides/' + g.pdf);
    }
} finally {
    await browser.close();
}
