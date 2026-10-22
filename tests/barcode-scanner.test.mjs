import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createCameraScanner, createPixelDecoder, scannerErrorMessage} from '../store3d/barcode-scanner.mjs';
const require = createRequire(import.meta.url);
const ZXing = require('../store3d/vendor/zxing-library-0.21.3.min.js');
const decode = createPixelDecoder(ZXing);

// Render standard EAN bars independently of the decoder (including quiet zones).
function barcode(code) {
  const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const R = L.map(s => [...s].map(b => b === '0' ? '1' : '0').join(''));
  const G = R.map(s => [...s].reverse().join(''));
  const parity = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
  const left = code.length === 13 ? code.slice(1,7) : code.slice(0,4);
  const pattern = code.length === 13 ? parity[+code[0]] : 'LLLL';
  let bits = '000000000000101' + [...left].map((n,i) => (pattern[i] === 'L' ? L : G)[+n]).join('');
  bits += '01010' + [...code.slice(code.length === 13 ? 7 : 4)].map(n => R[+n]).join('') + '101000000000000';
  const width = bits.length * 3, height = 180, data = new Uint8ClampedArray(width * height * 4).fill(255);
  for(let y=15;y<165;y++) for(let x=0;x<width;x++) if(bits[Math.floor(x/3)] === '1') {
    const p = (y*width+x)*4; data[p]=data[p+1]=data[p+2]=0;
  }
  return {data,width,height};
}

function harness(options = {}) {
  const jobs = new Map(), results = [], errors = []; let n = 0, stops = 0, loads = 0;
  const pixels = barcode('5901234123457');
  const stream = {getTracks:() => [{stop:() => stops++}]};
  const video = {pause(){},play:async()=>{},setAttribute(){},readyState:4,videoWidth:pixels.width,videoHeight:pixels.height,srcObject:null};
  const scanner = createCameraScanner({video,onResult:c=>results.push(c),onError:e=>errors.push(e),
    mediaDevices:{getUserMedia:async constraints=>{assert.equal(constraints.audio,false);return stream;}},Detector:null,
    loadDecoder:async()=>{loads++;return decode;},
    makeCanvas:()=>({getContext:()=>({drawImage(){},getImageData:()=>pixels})}),
    schedule:fn=>{jobs.set(++n,fn);return n;},cancel:id=>jobs.delete(id),...options});
  return {scanner,video,stream,results,errors,jobs,get stops(){return stops;},get loads(){return loads;},
    async tick(){const [id,fn]=jobs.entries().next().value;jobs.delete(id);await fn();}};
}

test('Bundled fallback reads real EAN-13 and EAN-8 pixels and rejects invalid checksums',()=>{
  assert.equal(decode(barcode('5901234123457')),'5901234123457');
  assert.equal(decode(barcode('96385074')),'96385074');
  assert.equal(decode(barcode('5901234123458')),null);
});

test('Safari path without BarcodeDetector reads barcode once and releases camera',async()=>{
  const h=harness();await h.scanner.start();
  assert.equal(h.video.playsInline,true);assert.equal(h.video.muted,true);
  await h.tick();assert.deepEqual(h.results,['5901234123457']);
  assert.equal(h.loads,1);assert.equal(h.stops,1);assert.equal(h.video.srcObject,null);assert.equal(h.jobs.size,0);
});

test('Supported native detector avoids loading fallback',async()=>{
  class Detector {static async getSupportedFormats(){return ['ean_13','ean_8','upc_a','upc_e','code_128','itf'];}async detect(){return [{rawValue:'96385074'}];}}
  const h=harness({Detector});await h.scanner.start();await h.tick();
  assert.deepEqual(h.results,['96385074']);assert.equal(h.loads,0);
});

test('Incomplete native format support uses fallback',async()=>{
  class Detector {static async getSupportedFormats(){return ['qr_code'];}}
  const h=harness({Detector});await h.scanner.start();await h.tick();assert.equal(h.loads,1);assert.equal(h.results.length,1);
});

test('Native runtime failure switches to software without reopening camera',async()=>{
  class Detector {static async getSupportedFormats(){return ['ean_13','ean_8','upc_a','upc_e','code_128','itf'];}async detect(){throw Error('unsupported');}}
  const h=harness({Detector});await h.scanner.start();await h.tick();await h.tick();
  assert.deepEqual(h.results,['5901234123457']);assert.equal(h.loads,1);assert.equal(h.errors.length,0);
});

test('Closing while camera permission is pending releases the late stream',async()=>{
  let resolve;const pending=new Promise(r=>resolve=r);
  const h=harness({mediaDevices:{getUserMedia:()=>pending}});const opening=h.scanner.start();h.scanner.stop();resolve(h.stream);await opening;
  assert.equal(h.stops,1);assert.equal(h.jobs.size,0);assert.equal(h.results.length,0);assert.equal(h.video.srcObject,null);
});

test('Closing during fallback load cannot restart scanning',async()=>{
  let resolve, entered;const started=new Promise(r=>entered=r),pending=new Promise(r=>resolve=r);
  const h=harness({loadDecoder:()=>{entered();return pending;}});const opening=h.scanner.start();await started;h.scanner.stop();resolve(decode);await opening;
  assert.equal(h.stops,1);assert.equal(h.jobs.size,0);assert.equal(h.results.length,0);
});

test('Denied camera permission keeps manual entry available and allows retry',async()=>{
  let attempts=0;const denied=Object.assign(Error('denied'),{name:'NotAllowedError'});
  const h=harness({mediaDevices:{getUserMedia:async()=>{if(!attempts++)throw denied;return h.stream;}}});
  await h.scanner.start();assert.equal(h.errors[0],denied);assert.match(scannerErrorMessage(denied),/Safari/);
  await h.scanner.start();await h.tick();assert.deepEqual(h.results,['5901234123457']);
});

test('Fallback load failure stops camera and produces a retry message',async()=>{
  const h=harness({loadDecoder:async()=>{throw Error('decoder-load');}});await h.scanner.start();
  assert.ok(h.stops>=1);assert.equal(h.video.srcObject,null);assert.equal(h.jobs.size,0);assert.match(scannerErrorMessage(h.errors[0]),/โหลดตัวอ่าน/);
});

test('Pages output includes scanner and local licensed decoder',()=>{
  for(const f of ['barcode-scanner.mjs','vendor/zxing-library-0.21.3.min.js','vendor/ZXING-LICENSE'])assert.ok(existsSync(new URL('../dist/'+f,import.meta.url)));
  const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.ok(html.includes("from './barcode-scanner.mjs'"));
  assert.ok(html.includes("window.addEventListener('pagehide', closeScan)"));
});
