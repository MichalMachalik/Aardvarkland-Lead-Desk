const assert = require("node:assert/strict");
const {chromium,firefox} = require(process.env.PLAYWRIGHT_PATH || "playwright");
const base="https://michalmachalik.github.io/Aardvarkland-Lead-Desk/";
async function journey(engine,width){
  const browser=await engine.launch();
  try{
    const context=await browser.newContext({viewport:{width,height:850}});
    const page=await context.newPage();
    const errors=[];
    page.on("pageerror",e=>errors.push(e.message));
    await context.route(/https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/)/,route=>route.abort());
    if(process.env.PREVIEW_DOCS){
      const path=require("node:path");
      await context.route(base+"**",route=>{
        const rel=new URL(route.request().url()).pathname.slice(new URL(base).pathname.length)||"index.html";
        return route.fulfill({path:path.join(process.env.PREVIEW_DOCS,rel)});
      });
    }
    await page.goto(base);
    await page.locator("#fault").check();
    await page.getByRole("button",{name:"Zpracovat poptávku"}).click();
    await page.getByText("Přerušeno",{exact:true}).waitFor();
    await page.getByRole("button",{name:"Obnovit spojení a opakovat"}).click();
    await page.getByText("Úkol a návrh odpovědi připraveny").waitFor();
    await page.getByRole("button",{name:"Odeslat znovu"}).click();
    await page.getByText("Vrácena existující příležitost").waitFor();
    await page.locator("#variant").selectOption("1");
    await page.getByRole("button",{name:"Schválit do testovací schránky"}).click();
    await page.getByRole("heading",{name:"Schválená odpověď"}).waitFor();
    await page.getByRole("link",{name:"Schránka",exact:true}).click();
    assert.match(await page.locator(".entry").innerText(),/abychom mohli/);
    assert.equal(await page.locator(".entry").count(),1);
    await page.reload();await page.getByRole("button",{name:"Otevřít poptávku"}).click();
    await page.locator("#scenario").selectOption("price");
    await page.getByRole("button",{name:"Zpracovat poptávku"}).click();
    await page.getByText("Čeká na upřesnění",{exact:true}).waitFor();
    await page.getByText("Upřesnit zadání",{exact:true}).waitFor();
    await page.locator("#scenario").selectOption("booking");
    await page.getByRole("button",{name:"Zpracovat poptávku"}).click();
    await page.getByText("Příští měsíc",{exact:true}).waitFor();
    await page.getByRole("link",{name:"CRM",exact:true}).click();
    await page.getByRole("heading",{name:"Obchodní příležitosti",exact:true}).waitFor();
    assert.equal(await page.locator(".entry").count(),3);
    await page.getByRole("link",{name:"Historie",exact:true}).click();
    await page.getByRole("heading",{name:"Poslední průchody",exact:true}).waitFor();
    await page.locator("details summary").first().click();
    assert(await page.locator("details[open]").count()===1);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    console.log(engine.name(),width,"passed");
  }finally{await browser.close();}
}
Promise.all([journey(chromium,1440),journey(firefox,375)]).catch(e=>{console.error(e);process.exitCode=1;});
