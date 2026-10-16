// Full workflow against Django's disposable live test database, never the dev API.
import assert from 'node:assert/strict';
const { chromium, expect }=await import(process.env.PLAYWRIGHT_MODULE || '../../../gasbook-customer/node_modules/@playwright/test/index.mjs');
const live=process.env.PAYMENT_LIVE_URL;
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(live||''))throw Error('Isolated live test server required');
const users=JSON.parse(process.env.PAYMENT_FIXTURES);
const browser=await chromium.launch({headless:true});
const errors=[];
async function app(role){
 const context=await browser.newContext({viewport:{width:390,height:900}});
 await context.addInitScript(({role,user})=>{
  if(role==='customer')localStorage.setItem('gasbook_customer_auth',JSON.stringify({accessToken:user.access,refreshToken:user.access}));
  else{localStorage.setItem('gasbook_access',user.access);localStorage.setItem('gasbook_role',role);}
 },{role,user:users[role]});
 await context.route('**/api/**',route=>{const u=new URL(route.request().url());return route.continue({url:live+u.pathname+u.search});});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return page;
}
async function responsive(page){
 for(const width of [320,375,390,414,768,1024,1440]){
  await page.setViewportSize({width,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Overflow at ${width}`);
 }
 await page.setViewportSize({width:390,height:900});
}
const pages=[];
try{
 const staff=await app('staff');pages.push(staff);
 await staff.goto('http://localhost:5173/staff-dashboard');
 const summary=staff.locator('.ui-card').filter({hasText:"Today's Collection"});
 await expect(summary).toContainText('₹0');
 // Delivery total 360: only 100 cash + 100 UPI received initially.
 await staff.getByRole('radio',{name:'Split payment',exact:true}).first().click();
 await staff.getByLabel('Cash received (Rs.)',{exact:true}).first().fill('100');
 await staff.getByLabel('UPI / GPay received (Rs.)',{exact:true}).first().fill('100');
 await staff.getByRole('checkbox',{name:/I confirm the amount actually received/}).first().check();
 await responsive(staff);
 await staff.getByRole('button',{name:'Complete Delivery',exact:true}).first().click();
 await expect(staff.getByText('Delivery completed successfully!',{exact:true})).toBeVisible();
 await expect(summary).toContainText('₹200');
 await staff.getByRole('button',{name:'History',exact:true}).last().click();
 const order=staff.locator('.sa-history-card').first();
 await order.locator('.sa-history-card__details > summary').click();
 await expect(order).toContainText('₹160');
 await order.getByRole('button',{name:'Collect outstanding balance'}).click();
 const dialog=staff.getByRole('dialog');
 await dialog.getByRole('radio',{name:'Bank Transfer',exact:true}).click();
 await dialog.getByLabel('Bank Transfer received (Rs.)').fill('160');
 await dialog.getByRole('button',{name:'Record payment'}).click();
 await expect(dialog).not.toBeVisible();
 await staff.getByRole('button',{name:'Home',exact:true}).click();
 await expect(summary).toContainText('₹360');
 await staff.getByRole('navigation',{name:'Staff navigation'}).getByRole('button',{name:'Sale',exact:true}).click();
 await staff.getByLabel('Search by name or phone').fill('payment-customer');
 await staff.getByRole('button',{name:/Payment customer|payment-customer/}).click();
 await staff.getByRole('button',{name:'Continue to items',exact:true}).click();
 await staff.getByRole('button',{name:'Add cylinder',exact:true}).click();
 await staff.getByRole('button',{name:'Add accessory',exact:true}).click();
 await staff.getByRole('button',{name:'Continue to payment',exact:true}).click();
 await expect(staff.getByLabel('Order summary')).toContainText('Test regulator');
 await expect(staff.getByLabel('Order summary')).toContainText('1 × ₹250');
 await staff.getByRole('radio',{name:'UPI / GPay',exact:true}).click();
 await staff.getByLabel('UPI / GPay received (Rs.)').fill('400');
 await expect(staff.getByRole('button',{name:'Complete sale',exact:true})).toBeEnabled();
 await responsive(staff);
 // Simulate a lost response AFTER the backend commits; reload then retry saved request.
 let lost=false;
 await staff.route('**/api/staff-sales/',async route=>{
  if(route.request().method()!=='POST'||lost)return route.fallback();
  lost=true;await route.fetch({url:live+'/api/staff-sales/'});await route.abort('failed');
 });
 await staff.getByRole('button',{name:'Complete sale',exact:true}).click();
 await expect(staff.getByRole('button',{name:'Retry saved sale'})).toBeVisible();
 await staff.reload();await staff.getByRole('navigation',{name:'Staff navigation'}).getByRole('button',{name:'Sale',exact:true}).click();
 await staff.getByRole('button',{name:'Retry saved sale'}).click();
 await expect(staff.getByText(/Direct Sale #\d+ completed/)).toBeVisible();
 await expect(staff.getByLabel('Payment details')).toContainText('₹210');
 await staff.getByRole('button',{name:'Back to Home',exact:true}).click();
 await expect(summary).toContainText('₹760');
 const customer=await app('customer');pages.push(customer);
 await customer.goto('http://localhost:5174/#orders');
 const visible=locator=>locator.filter({visible:true});
 await expect(visible(customer.getByText(/Direct Sale #/))).toHaveCount(1);
 const paymentDetails=visible(customer.getByLabel('Payment details'));
 await expect(paymentDetails).toHaveCount(2);
 await paymentDetails.filter({hasText:'₹210.00 outstanding'}).locator('summary').click();
 await expect(paymentDetails.filter({hasText:'₹210.00 outstanding'})).toContainText('₹400.00');
 await responsive(customer);
 const admin=await app('admin');pages.push(admin);await admin.goto('http://localhost:5173/sales');
 await admin.getByRole('tab',{name:'History',exact:true}).click();
 await expect(admin.getByRole('row').filter({hasText:'payment-customer'})).toHaveCount(2);
 await admin.getByText('Payment details',{exact:true}).first().click();
 await expect(admin.getByLabel('Payment details').first()).toContainText('Outstanding balance');
 assert.deepEqual(errors,[]);
 console.log('PASS real API: split/partial COD, bank balance settlement, mixed staff Direct Sale, lost-response/reload retry, today totals, customer/admin history, seven responsive widths.');
}catch(error){
 for(let i=0;i<pages.length;i++){console.error((await pages[i].locator('body').innerText()).slice(0,7000));await pages[i].screenshot({path:`/private/tmp/payment-browser-failure-${i}.png`,fullPage:true});}
 throw error;
}finally{await browser.close();}
