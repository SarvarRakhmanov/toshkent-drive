const pw = require(process.env.PW);
(async () => { const b = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
 const p = await b.newPage({ viewport: { width: 1800, height: 300 } });
 const side = process.env.SIDE ? "&side=1" : "";
 await p.goto("http://127.0.0.1:4180/index.html?f=" + process.argv[2] + side); await p.waitForFunction(() => document.title === "done", null, { timeout: 120000 });
 await p.screenshot({ path: process.argv[3] }); await b.close(); })();
