process.chdir('/home/user/CloudHost247/platform');
const path=require('path'); const fs=require('fs'); const os=require('os');
const { loadConfig } = require('./src/core/config');
const { buildApp } = require('./src/app');
(async()=>{
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(),'ch247-dump-'));
  const { config } = loadConfig({ cwd: __dirname, overrides: { NODE_ENV:'test', LOG_LEVEL:'silent', DATA_DIR:dataDir, SANDBOX_GATEWAY_WEBHOOK_SECRET:'test-sandbox-webhook-secret-0123456789', SANDBOX_PAYMENTS:'true' }});
  const app = await buildApp(config);
  const lines = app.router.list().map(r=>r.method+' '+r.path).sort();
  console.log(lines.join('\n'));
  await app.close();
  fs.rmSync(dataDir,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exit(1)});
