/* CLI test runner. NODE_PATH may point at an external, disposable tooling install. */
const { chromium } = require('playwright');
const { default: AxeBuilder } = require('@axe-core/playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const options = { headless: true };
  if (process.env.CH247_CHROMIUM) options.executablePath = process.env.CH247_CHROMIUM;
  options.args = ['--no-sandbox', '--disable-dev-shm-usage'];
  const browser = await chromium.launch(options);
  const context = await browser.newContext();
  const page = await context.newPage();
  const origin = process.env.CH247_QA_URL || 'http://127.0.0.1:8080';
  const fixtureDir = process.env.CH247_FIXTURE_DIR;
  const routes = fs.readdirSync(fixtureDir).filter(f => f.endsWith('.php.html')).map(f => f.replace(/\.html$/, ''));
  const widths = [320, 360, 375, 390, 414, 768, 1024, 1280, 1440, 1920];
  const report = { scope: 'Real Smarty template fixtures only. No WHMCS core, sessions, database, checkout or authentication.', routes: routes.length, widths, cases: 0, overflow: [], brokenImages: [], errors: [], accessibility: [], navigation: [] };
  page.on('pageerror', error => report.errors.push(String(error)));
  for (const route of routes) {
    await page.goto(origin + '/' + route, { waitUntil: 'networkidle' });
    await page.evaluate(() => { document.querySelectorAll('img').forEach(img => img.loading = 'eager'); });
    await page.waitForLoadState('networkidle');
    const bad = await page.locator('img').evaluateAll(imgs => imgs.filter(img => img.complete && !img.naturalWidth).map(img => img.getAttribute('src')));
    if (bad.length) report.brokenImages.push({route,images:bad});
    for (const width of widths) {
      await page.setViewportSize({width, height:900});
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const result = await page.evaluate(() => ({overflow:document.documentElement.scrollWidth > innerWidth + 1, h1:document.querySelectorAll('h1').length, header:document.querySelectorAll('.ch-header').length, footer:document.querySelectorAll('.ch-footer').length}));
      if (result.overflow) report.overflow.push({route,width});
      if (result.h1 !== 1 || result.header !== 1 || result.footer !== 1) report.errors.push({route,width,structure:result});
      report.cases++;
    }
  }
  await page.goto(origin + '/index.php');
  for (const width of widths) {
    await page.setViewportSize({width,height:950});
    if (width < 1200) await page.locator('.ch-menu-toggle').click();
    const summaries = page.locator('.ch-nav-item summary');
    for (let index = 0; index < await summaries.count(); index++) {
      const summary = summaries.nth(index);
      const label = (await summary.innerText()).trim();
      await summary.click();
      await page.waitForTimeout(80);
      const opened = await page.locator('.ch-nav-item[open]').count() === 1;
      const menuOverflow = await page.evaluate(() => {
        const menu = document.querySelector('.ch-nav-item[open] .ch-mega');
        return document.documentElement.scrollWidth > innerWidth + 1 || !menu || menu.scrollWidth > menu.clientWidth + 1;
      });
      if (!opened) report.errors.push('Menu did not open: ' + label + ' at ' + width);
      if (menuOverflow) report.overflow.push({route:'index.php / ' + label + ' mega menu',width});
      await page.keyboard.press('Escape');
      const escaped = await page.locator('.ch-nav-item[open]').count() === 0;
      const focused = await summary.evaluate(element => document.activeElement === element);
      if (!escaped || !focused) report.errors.push('Escape/focus failed: ' + label + ' at ' + width);
      report.navigation.push({width,label,open:opened,escape:escaped,focus:focused});
    }
    if (width < 1200) await page.keyboard.press('Escape');
  }
  for (const route of ['index.php','web-hosting.php','vps-hosting.php','dedicated-server.php','domain.php','applications.php','operating-systems.php','privacy-policy.php','faqs.php','notfound.php','cloudhost247-hosting.php','email-hosting.php','site-search.php','site-search-unavailable.php','site-search-empty.php','site-search-long.php']) {
    await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/'+route);
    const result = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    report.accessibility.push({route,violations:result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))});
  }
  for (const [route, expected] of [
    ['site-search.php', 'Hosting for your next project.'],
    ['site-search-unavailable.php', 'Page search is temporarily unavailable.'],
    ['site-search-empty.php', 'No matching pages.'],
    ['site-search-long.php', 'CloudHost247'.repeat(8)],
  ]) {
    await page.goto(origin + '/' + route);
    if (!(await page.locator('main').innerText()).includes(expected)) report.errors.push(route + ': wrong search state');
    const expectedQuery = route === 'site-search-long.php' ? 'q'.repeat(100) : 'hosting';
    if (await page.locator('#ch-site-query').inputValue() !== expectedQuery) report.errors.push(route + ': query not retained');
    if (!['site-search.php', 'site-search-long.php'].includes(route) && await page.locator('main .ch-resource-card').count()) report.errors.push(route + ': unavailable/empty search must have no results');
  }
  if (process.env.CH247_SCREENSHOT_DIR) {
    for (const [route,width,name] of [['index.php',1440,'homepage-desktop'],['index.php',375,'homepage-mobile'],['web-hosting.php',1440,'web-hosting-desktop']]) {
      await page.setViewportSize({width,height:1000});await page.goto(origin+'/'+route,{waitUntil:'networkidle'});await page.screenshot({path:path.join(process.env.CH247_SCREENSHOT_DIR,name+'.png'),fullPage:true});
    }
  }
  report.passed=!report.errors.length && !report.overflow.length && !report.brokenImages.length && report.accessibility.every(a=>!a.violations.length);
  fs.writeFileSync(process.env.CH247_QA_REPORT || '/tmp/ch247-browser-report.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2)); await browser.close(); process.exit(report.passed?0:1);
})();
