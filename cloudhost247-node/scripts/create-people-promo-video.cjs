/* Original stylized workspace animation, rendered to MP4/WebM. Requires Playwright Chromium,
 * ffmpeg and ImageMagick. FFMPEG and CH247_CHROMIUM_PATH can point to local binaries. */
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const { readFileSync, unlinkSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dest = path.join(root, 'frontend/public/media/cloudhost247/promo');
const image = readFileSync(path.join(dest, 'workspace-background.webp')).toString('base64');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const html = `<!doctype html><html><head><style>*{margin:0}canvas{display:block;width:100vw;height:100vh}</style></head><body><canvas></canvas><script>
const c=document.querySelector('canvas'),ctx=c.getContext('2d'),img=new Image();
c.width=innerWidth;c.height=innerHeight;img.src='data:image/webp;base64,${image}';
function oval(x,y,rx,ry,fill){ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill()}
function stroke(points,color,width){ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);for(let i=1;i<points.length;i++)ctx.lineTo(points[i][0],points[i][1]);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke()}
function figure(x,y,size,phase,dir,style){ctx.save();ctx.translate(x,y);ctx.scale(size*dir,size);let step=Math.sin(phase);oval(0,1,40,6,'#5a4e6040');
// Back leg and arm follow an articulated walk cycle.
const leg=(v,back)=>{let thigh=v*21,kneeY=-57+Math.abs(v)*4,footX=v*42,footY=-7-Math.max(0,-v)*12;stroke([[0,-104],[thigh,kneeY],[footX,footY]],back?style.trouserBack:style.trouser,14);stroke([[footX,footY],[footX+17,footY+1]],'#39343d',10)};
leg(-step,true);stroke([[-7,-164],[-18-step*10,-130],[-20-step*15,-107]],style.coatBack,10);
// Body: an open tailored jacket, shirt and neck, all rendered as solid original artwork.
ctx.fillStyle=style.shirt;ctx.beginPath();ctx.moveTo(-16,-165);ctx.lineTo(13,-165);ctx.lineTo(18,-107);ctx.lineTo(-20,-107);ctx.closePath();ctx.fill();
ctx.fillStyle=style.coat;ctx.beginPath();ctx.moveTo(-16,-165);ctx.quadraticCurveTo(-28,-158,-24,-138);ctx.lineTo(-24,-105);ctx.lineTo(-6,-105);ctx.lineTo(-2,-142);ctx.lineTo(5,-162);ctx.closePath();ctx.fill();
ctx.beginPath();ctx.moveTo(12,-165);ctx.quadraticCurveTo(25,-157,22,-137);ctx.lineTo(23,-106);ctx.lineTo(8,-105);ctx.lineTo(4,-144);ctx.lineTo(1,-160);ctx.closePath();ctx.fill();
ctx.fillStyle=style.skin;ctx.fillRect(-5,-179,10,15);oval(0,-188,13,17,style.skin);
// Hair and profile make the figures visibly human rather than stick figures.
ctx.fillStyle=style.hair;ctx.beginPath();ctx.moveTo(-13,-187);ctx.quadraticCurveTo(-17,-207,-2,-207);ctx.quadraticCurveTo(16,-208,13,-188);ctx.quadraticCurveTo(7,-192,4,-197);ctx.quadraticCurveTo(-1,-190,-13,-187);ctx.fill();
ctx.fillStyle=style.skin;oval(12,-186,3,4,style.skin);oval(13,-184,2,2,style.skin);
stroke([[13,-159],[22+step*10,-132],[20+step*16,-111]],style.coat,10);oval(20+step*16,-109,4,5,style.skin);
leg(step,false);ctx.restore()}
function frame(x,y,w,h,angle){ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.shadowColor='#42325f32';ctx.shadowBlur=20;ctx.shadowOffsetY=8;ctx.fillStyle='#fffc';ctx.beginPath();ctx.roundRect(-w/2,-h/2,w,h,10);ctx.fill();ctx.shadowColor='transparent';ctx.fillStyle='#eee8f7';ctx.fillRect(-w/2+5,-h/2+6,w-10,16);for(let i=0;i<3;i++)oval(-w/2+13+i*7,-h/2+14,2,2,'#afa2bb');ctx.fillStyle='#d5c7e9';ctx.beginPath();ctx.roundRect(-w/2+15,-h/2+34,w*.48,7,3);ctx.fill();ctx.fillStyle='#ebe3f4';ctx.beginPath();ctx.roundRect(-w/2+15,-h/2+48,w*.67,5,3);ctx.fill();ctx.beginPath();ctx.roundRect(-w/2+15,-h/2+58,w*.57,5,3);ctx.fill();ctx.fillStyle='#7759aa';ctx.beginPath();ctx.roundRect(-w/2+15,h*.19,w*.27,12,6);ctx.fill();ctx.restore()}
window.renderFrame=(t)=>{const w=c.width,h=c.height,a=t*Math.PI*2,mobile=w<h;ctx.clearRect(0,0,w,h);
// Cover the canvas with a gentle camera drift. One cycle is periodic, avoiding a loop jump.
const ratio=Math.max(w/img.width,h/img.height),iw=img.width*ratio*1.05,ih=img.height*ratio*1.05;ctx.drawImage(img,(w-iw)/2+Math.sin(a)*8,(h-ih)/2+Math.cos(a)*3,iw,ih);
const wash=ctx.createRadialGradient(w*.5,h*.39,0,w*.5,h*.39,w*.48);wash.addColorStop(0,'#fffaf4bb');wash.addColorStop(1,'#fffaf400');ctx.fillStyle=wash;ctx.fillRect(0,0,w,h);
// People walk continuously in the side regions so the central HTML stays legible.
const y=mobile?h*.79:h*.86;const scale=mobile?h/1200:h/900;const distance=mobile?22:42;
const firstX=(mobile?.35:.16)*w+Math.sin(a)*distance;const secondX=(mobile?.65:.84)*w-Math.sin(a)*distance;
figure(firstX,y,scale*1.12,a*4,1,{coat:'#756083',coatBack:'#5d4a70',shirt:'#f8f1eb',trouser:'#4d4659',trouserBack:'#3e394d',skin:'#a96e53',hair:'#302635'});
figure(secondX,y+3,scale*1.06,a*4+Math.PI,-1,{coat:'#6b8193',coatBack:'#526b7f',shirt:'#f8f4ed',trouser:'#544a5c',trouserBack:'#443e4f',skin:'#d7a17e',hair:'#49372f'});
if(!mobile){frame(w*.10,h*.25,170,105,-.08+Math.sin(a)*.02);frame(w*.89,h*.25,165,105,.08+Math.cos(a)*.02)}
};</script></body></html>`;
async function render(browser,name,w,h){
 const page=await browser.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});await page.setContent(html);await page.evaluate(()=>document.querySelector('canvas') && document.images[0]?.decode().catch(()=>{}));
 // Wait for the data-URL image used by the canvas.
 await page.evaluate(()=>new Promise(resolve=>{if(img.complete)resolve();else img.onload=resolve}));
 const out=path.join(dest,name+'.mp4');const proc=spawn(ffmpeg,['-y','-loglevel','error','-f','image2pipe','-vcodec','png','-framerate','18','-i','-','-an','-c:v','libx264','-preset','medium','-crf','25','-pix_fmt','yuv420p','-movflags','+faststart',out],{stdio:['pipe','inherit','inherit']});
 const done=new Promise((resolve,reject)=>{proc.on('error',reject);proc.on('close',code=>code===0?resolve():reject(Error('ffmpeg '+code)))});
 for(let i=0;i<180;i++){await page.evaluate(t=>window.renderFrame(t),i/180);const frame=await page.screenshot({type:'png'});if(i===0)await page.screenshot({path:path.join(dest,name+'-poster.png')});if(!proc.stdin.write(frame))await new Promise(r=>proc.stdin.once('drain',r));}
 proc.stdin.end();await done;await page.close();const png=path.join(dest,name+'-poster.png');execFileSync('convert',[png,'-quality','78',path.join(dest,name+'-poster.webp')]);unlinkSync(png);execFileSync(ffmpeg,['-y','-loglevel','error','-i',out,'-an','-c:v','libvpx-vp9','-deadline','good','-cpu-used','5','-crf','34','-b:v','0',path.join(dest,name+'.webm')]);console.log('Rendered',out)
}
(async()=>{const b=await chromium.launch({executablePath:process.env.CH247_CHROMIUM_PATH||undefined,args:['--no-sandbox']});try{if (process.env.PROMO_MOBILE_ONLY !== '1') await render(b,'people-desktop',1280,640);await render(b,'people-mobile',600,800)}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
