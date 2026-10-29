// Retest after Vercel automation bypass credential update (2026-10-19).
// Manual rerun requested 2026-10-19; test-mode Stripe keys still required.
// Validate updated Stripe test credentials on the freshly deployed Preview.
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.env.WH_TEST_URL || 'https://selectservicepros-pages-git-feat-wa-0f295d-davemoradis-projects.vercel.app';
const runs = Number(process.env.WH_SMOKE_RUNS || 2);
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS5kAAAAASUVORK5CYII=', 'base64');
(async () => {
  fs.mkdirSync('wh-test-results', { recursive: true });
  const browser = await chromium.launch({headless:true});
  const results = [];
  for (let i=0; i<runs; i++) {
    const page = await browser.newPage({viewport:{width:1280,height:900},extraHTTPHeaders:bypass?{'x-vercel-protection-bypass':bypass,'x-vercel-set-bypass-cookie':'true'}:undefined});
    const result = {attempt:i+1,base,stage:'starting'};
    page.on('pageerror', err => {result.browserError = String(err.message).slice(0,200)});
    page.on('response', async response => {
      if(response.url().includes('/api/create-lead?pilot=water_heater') && response.request().postData()?.includes('"action":"checkout"')){
        const data=await response.json().catch(()=>null);
        result.checkoutHttpStatus=response.status();
        result.checkoutError=data?.error||null;
        if(data?.error==='stripe_test_keys_required'){
          result.stripeSecretKeyMode=data.secretKeyMode||'unknown';
          result.stripePublishableKeyMode=data.publishableKeyMode||'unknown';
        }
      }
    });
    try {
      await page.goto(base+'/water-heaters.html', {waitUntil:'domcontentloaded',timeout:45000});
      result.httpStatus = (await page.request.get(base+'/water-heaters.html')).status();
      result.pageTitle = (await page.title()).slice(0,100);
      result.bypassConfigured = Boolean(bypass);
      result.bypassLengthValid = bypass.length === 32;
      result.finalUrlHost = new URL(page.url()).hostname;
      if ((await page.title()).toLowerCase().includes('vercel') && (await page.locator('text=Log in to Vercel').count())) throw Error('Vercel Deployment Protection blocked automated browser. Configure GitHub Actions secret WH_VERCEL_AUTOMATION_BYPASS_SECRET.');
      result.stage='form';
      if(!(await page.locator('input[name="capacity_gallons"][value="40"]').count()))throw Error('Expected water-heater form missing; page title: '+result.pageTitle+'; HTTP '+result.httpStatus+'; bypassConfigured '+result.bypassConfigured);
      await page.locator('input[name="capacity_gallons"][value="40"]').check();
      await page.locator('.wizard-step[data-step="1"] button').click();
      await page.locator('#customer_name').fill('Automated Test Order');
      await page.locator('#customer_phone').fill('2125550100');
      await page.locator('#customer_email').fill('waterheater-test-'+Date.now()+'-'+i+'@example.com');
      await page.locator('#street_address').fill('123 Test Street');
      await page.locator('#city').fill('Brooklyn');
      await page.locator('#zip_code').fill('11234');
      await page.locator('#location_detail').selectOption('Basement');
      await page.locator('#consent').check();
      await page.locator('.wizard-step[data-step="2"] button.btn').click();
      await page.locator('#file-tag').setInputFiles({name:'tag.png',mimeType:'image/png',buffer:png});
      await page.locator('#file-heater').setInputFiles({name:'heater.png',mimeType:'image/png',buffer:png});
      result.stage='upload';
      await page.locator('#submit').click();
      await page.locator('.premium-checkout').waitFor({timeout:90000});
      result.stage='stripe';
      const end=Date.now()+60000;
      let stripeVisible=false;
      while(Date.now()<end){
        const err=(await page.locator('#checkout-message').textContent().catch(()=>''))||'';
        if(await page.locator('#retry-payment').isVisible().catch(()=>false))throw Error('Checkout API: '+err);
        const frame=page.locator('#embedded-checkout iframe');
        if(await frame.count()>0 && await frame.first().isVisible()){stripeVisible=true;break}
        await page.waitForTimeout(1200);
      }
      await page.screenshot({path:'wh-test-results/checkout-'+(i+1)+'.png',fullPage:true});
      if(!stripeVisible)throw Error('Stripe iframe did not appear');
      result.stage='embedded_form_visible';result.ok=true;
    } catch(e) {
      result.ok=false;result.error=String(e.message).slice(0,700);
      await page.screenshot({path:'wh-test-results/failure-'+(i+1)+'.png',fullPage:true}).catch(()=>{});
    }
    results.push(result);
    await page.close();
  }
  fs.writeFileSync('wh-test-results/results.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
  await browser.close();
  if(results.some(r=>!r.ok))process.exit(1);
})().catch(e=>{console.error(e);process.exit(1)});
