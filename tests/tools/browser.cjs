/* Real production build + real API. Fixtures are used only for the WHMCS-owned shell. */
const {chromium}=require('playwright');
const {default:AxeBuilder}=require('@axe-core/playwright');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
 const origin=process.env.CH247_QA_URL || 'http://127.0.0.1:3000';
 const embedded=process.env.CH247_EMBEDDED==='1';
 const api=origin+(embedded?'/platform':'')+'/api/tools';
 const browser=await chromium.launch({headless:true,executablePath:process.env.CH247_CHROMIUM,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext();
 const page=await context.newPage();
 page.setDefaultTimeout(15000);
 const report={scope:embedded?'Production React + real API in rendered WHMCS Smarty shell; no licensed WHMCS core':'Production Node SPA + real Tools API + migrated PGlite',widths:[320,375,390,414,768,1024,1280,1440],cases:0,errors:[],overflow:[],accessibility:[],checks:[],toolRoutes:[]};
 page.on('pageerror',e=>report.errors.push(String(e)));
 const catalog=await (await page.request.get(api+'/catalog')).json();
 const navigation=await(await page.request.get(api+'/navigation')).json();
 async function checkWidths(route){for(const width of report.widths){await page.setViewportSize({width,height:900});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const result=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,h1:document.querySelectorAll('main h1').length}));if(result.overflow)report.overflow.push({route,width});if(result.h1!==1)report.errors.push({route,width,h1:result.h1});report.cases++;}}
 async function axe(route){const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();if(result.violations.length)report.accessibility.push({route,violations:result.violations.map(x=>({id:x.id,impact:x.impact,nodes:x.nodes.map(n=>n.target)}))});}
 await page.goto(origin+'/tools');await page.waitForSelector('.tools-card');await checkWidths('/tools');await axe('/tools');
 await page.getByRole('searchbox',{name:'Search tools'}).fill('uuid');
 if(await page.locator('.tools-card').count()!==1)report.errors.push('Search did not filter UUID');
 await page.getByRole('searchbox',{name:'Search tools'}).fill('not-a-real-tool-xyz');
 await page.getByText(/No tool matches/).waitFor();report.checks.push('Search filters and empty state');
 await page.getByRole('searchbox',{name:'Search tools'}).fill('');
 await page.getByLabel('Show unavailable tools').check();await page.getByRole('link',{name:'WHOIS Lookup',exact:true}).first().count();
 await page.getByRole('link',{name:'Developer',exact:true}).click();await page.waitForURL('**/tools/category/developer');await checkWidths('category/developer');
 // Check every runnable registry route through real client routing; API never mocked.
 for(const tool of catalog.tools.filter(t=>!t.slug.startsWith('tool-'))){
   await page.evaluate(path=>{history.pushState({},'',path);dispatchEvent(new PopStateEvent('popstate'));},tool.path);
   await page.getByRole('heading',{level:1,name:tool.name,exact:true}).waitFor();
   await checkWidths(tool.path);report.toolRoutes.push(tool.path);console.log('Checked',tool.path);
 }
 await page.goto(origin+'/tools/uuid-generator');await page.getByRole('button',{name:'Run tool',exact:true}).click();
 await page.getByRole('button',{name:'Copy result',exact:true}).waitFor();
 if(!await page.locator('.tools-result').innerText().then(x=>/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/i.test(x)))report.errors.push('No UUID v4 in real result');
 await checkWidths('UUID result');await axe('UUID result');report.checks.push('Actual UUID generation through HTTP API');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download JSON'}).click();const file=await download;report.checks.push('Download '+file.suggestedFilename());
 await page.getByRole('button',{name:'Copy result'}).click();await page.getByText(/Result copied|Copy unavailable/).waitFor();report.checks.push('Copy result or explicit permission failure');
 await page.goto(origin+'/tools/speed-test');await page.getByRole('button',{name:'Run tool',exact:true}).click();
 await page.getByRole('button',{name:'Copy result'}).waitFor({timeout:35000});
 if(!(await page.locator('.tools-result').innerText()).includes('downloadMbps'))report.errors.push('Speed tool did not produce a browser measurement');
 report.checks.push('Real bounded browser download/upload/latency measurement');
 await page.goto(origin+'/tools/domain-health');await page.getByLabel('Domain',{exact:false}).first().waitFor();
 if(await page.getByRole('button',{name:'Run tool',exact:true}).isEnabled())report.errors.push('Owned-domain health must require a platform session');
 report.checks.push('Domain health uses shared runner, not an embedded route handoff');
 await page.goto(origin+'/tools/qr-generator');await page.getByLabel('Content',{exact:false}).first().fill('CloudHost247 browser verification');await page.getByRole('button',{name:'Run tool',exact:true}).click();
 await page.getByRole('link',{name:'Download QR image'}).waitFor();
 const image=page.locator('.tools-qr img');await expectImage();report.checks.push('QR real encoder image is rendered and downloadable');
 async function expectImage(){await page.waitForFunction(()=>{const img=document.querySelector('.tools-qr img');return img && img.complete && img.naturalWidth>0;});}
 await page.goto(origin+'/tools/dns-lookup');await page.getByLabel(/Domain or hostname/).fill('example.com');await page.getByRole('button',{name:'Run tool',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.tools-result')?.textContent.includes('Checking…'),{timeout:30000});
 await page.locator('.tools-result').getByText(/DNS_LOOKUP_FAILED|TIMEOUT|PROVIDER_ERROR|CONFIGURATION_REQUIRED|Raw response data/).first().waitFor({timeout:35000});
 report.checks.push('Actual DNS execution returned data or explicit backend failure (no substituted result)');await axe('DNS result');
 await page.goto(origin+'/tools/whois');await page.getByRole('heading',{level:1}).waitFor();
 if(await page.getByRole('button',{name:'Run tool',exact:true}).isEnabled())report.errors.push('Unconfigured WHOIS run enabled');report.checks.push('Unconfigured WHOIS disabled');
 // Exercise disclosure navigation at all widths and verify links against the actual runtime registry.
 await page.goto(origin+'/tools');await page.waitForSelector('.tools-card');
 const menu=page.locator(embedded?'[data-ch-tools-menu]':'details.tools-nav-disclosure');
 for(const width of report.widths){await page.setViewportSize({width,height:900});
   const toggle=page.locator(embedded?'.ch-menu-toggle':'.ch247-menu-toggle');
   if(await toggle.isVisible() && await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
   await menu.locator('summary').focus();await page.keyboard.press('Enter');
   if(!await menu.evaluate(e=>e.open))report.errors.push('Tools menu did not open at '+width);
   if(width===1440 || width===320)await axe('open menu '+width);
   for(const link of await menu.locator('a').evaluateAll(links=>links.map(x=>new URL(x.href).pathname))){if(link!='/tools'&&!navigation.tools.some(t=>t.path===link))report.errors.push('Unrunnable menu link '+link);}
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))report.overflow.push({route:'open menu',width});
   await page.keyboard.press('Escape');if(await menu.evaluate(e=>e.open))report.errors.push('Tools menu Escape failed at '+width);
 }
 report.checks.push('Keyboard Tools menu and runtime-filtered destinations at all widths');
 const footer=page.locator(embedded?'[data-ch-tools-footer]':'nav.tools-footer-links');
 for(const link of await footer.locator('a').evaluateAll(links=>links.map(x=>new URL(x.href).pathname))){if(link!='/tools'&&!navigation.tools.some(t=>t.path===link))report.errors.push('Unrunnable footer '+link);}
 report.checks.push('Permanent Tools footer with runtime-filtered destinations');
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:process.env.CH247_SCREENSHOT || '.cache/tools/tools-browser.png',fullPage:false});
 const output=process.env.CH247_QA_OUTPUT || '.cache/tools/browser-report.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
 console.log(JSON.stringify({cases:report.cases,routes:report.toolRoutes.length,errors:report.errors,overflow:report.overflow,accessibility:report.accessibility},null,2));
 await browser.close();if(report.errors.length||report.overflow.length||report.accessibility.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exit(1);});
