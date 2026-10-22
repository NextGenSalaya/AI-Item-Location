const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf'];
let libraryPromise;

function loadLibrary() {
  if (globalThis.ZXing) return Promise.resolve(globalThis.ZXing);
  if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => { clearTimeout(timer); script.remove(); libraryPromise = null; reject(new Error('decoder-load')); };
    const timer = setTimeout(fail, 15000);
    script.src = new URL('./vendor/zxing-library-0.21.3.min.js', import.meta.url).href;
    script.onload = () => {
      if (!globalThis.ZXing) return fail();
      clearTimeout(timer); resolve(globalThis.ZXing);
    };
    script.onerror = fail;
    document.head.append(script);
  });
  return libraryPromise;
}

// Shared by the camera adapter and real barcode-fixture tests. No network or DOM access.
export function createPixelDecoder(ZXing) {
  const reader = new ZXing.MultiFormatReader();
  const hints = new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS,
    ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'ITF'].map(k => ZXing.BarcodeFormat[k])]]);
  return ({data, width, height}) => {
    const grey = new Uint8ClampedArray(width * height);
    for (let i = 0, p = 0; i < grey.length; i++, p += 4) grey[i] = (data[p] + 2 * data[p + 1] + data[p + 2]) / 4;
    try {
      const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.RGBLuminanceSource(grey, width, height)));
      return reader.decode(bitmap, hints).getText();
    } catch (error) {
      if (error instanceof ZXing.NotFoundException || error instanceof ZXing.ChecksumException || error instanceof ZXing.FormatException) return null;
      throw error;
    } finally { reader.reset(); }
  };
}

async function loadFallback() { return createPixelDecoder(await loadLibrary()); }

export function scannerErrorMessage(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'ไม่ได้รับอนุญาตให้ใช้กล้อง กรุณาอนุญาตกล้องใน Safari แล้วกดลองเปิดกล้องใหม่ หรือพิมพ์เลขบาร์โค้ด';
  if (error?.name === 'NotFoundError') return 'ไม่พบกล้องบนเครื่องนี้ พิมพ์เลขบาร์โค้ดด้านล่างเพื่อค้นหาได้';
  if (error?.name === 'NotReadableError') return 'กล้องอาจถูกใช้งานอยู่ กรุณาปิดแอพที่ใช้กล้องแล้วลองใหม่';
  if (error?.message === 'decoder-load') return 'โหลดตัวอ่านบาร์โค้ดไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่ หรือพิมพ์เลขบาร์โค้ด';
  if (error?.message === 'camera-unavailable') return 'กรุณาเปิดลิงก์ HTTPS ใน Safari หรือ Chrome เพื่อใช้กล้อง หรือพิมพ์เลขบาร์โค้ดด้านล่าง';
  return 'เปิดตัวสแกนไม่สำเร็จ กรุณาลองใหม่ หรือพิมพ์เลขบาร์โค้ดด้านล่าง';
}

export function createCameraScanner({video, onResult, onStatus = () => {}, onError = () => {},
  mediaDevices = globalThis.navigator?.mediaDevices, Detector = globalThis.BarcodeDetector,
  loadDecoder = loadFallback, makeCanvas = () => document.createElement('canvas'),
  schedule = setTimeout, cancel = clearTimeout}) {
  let generation = 0, stream = null, timer = null;
  const release = s => s?.getTracks().forEach(t => t.stop());
  function stop() {
    generation++;
    cancel(timer); timer = null;
    release(stream); stream = null;
    video.pause(); video.srcObject = null;
  }
  async function start() {
    stop();
    const id = generation;
    let ownedStream;
    const current = () => id === generation;
    try {
      if (!mediaDevices?.getUserMedia) throw new Error('camera-unavailable');
      onStatus('กำลังเปิดกล้อง… กรุณาอนุญาตให้ใช้กล้อง');
      // Request within the button gesture; no library download delays camera permission.
      ownedStream = await mediaDevices.getUserMedia({audio:false, video:{facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720}}});
      if (!current()) { release(ownedStream); return; }
      stream = ownedStream;
      video.muted = true; video.autoplay = true; video.playsInline = true;
      video.setAttribute('playsinline', ''); video.srcObject = stream;
      await video.play();
      if (!current()) return;
      let detector = null, decode = null, canvas, context;
      const fallback = async () => {
        onStatus('กำลังเตรียมตัวอ่านบาร์โค้ด…');
        decode = await loadDecoder();
        if (!current()) return;
        canvas = makeCanvas(); context = canvas.getContext('2d', {willReadFrequently:true});
        if (!context) throw new Error('canvas-unavailable');
        detector = null;
      };
      if (Detector) {
        try {
          const supported = await Detector.getSupportedFormats();
          if (FORMATS.every(f => supported.includes(f))) detector = new Detector({formats:FORMATS});
        } catch { /* Safari can expose an incomplete experimental detector. */ }
      }
      if (!current()) return;
      if (!detector) await fallback();
      if (!current()) return;
      const ready = () => onStatus('เล็งกล้องให้เห็นบาร์โค้ดครบทั้งแถบ ในที่มีแสงเพียงพอ');
      ready();
      const tick = async () => {
        if (!current()) return;
        try {
          let code = null;
          if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
            if (detector) {
              try { code = (await detector.detect(video))[0]?.rawValue; }
              catch { if (current()) { await fallback(); if (current()) ready(); } }
            } else {
              const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
              const width = Math.round(video.videoWidth * scale), height = Math.round(video.videoHeight * scale);
              if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
              context.drawImage(video, 0, 0, width, height);
              code = decode(context.getImageData(0, 0, width, height));
            }
          }
          if (!current()) return;
          if (code) { stop(); onResult(code); return; }
          timer = schedule(tick, 250);
        } catch (error) { if (current()) { stop(); onError(error); } }
      };
      timer = schedule(tick, 0);
    } catch (error) {
      release(ownedStream);
      if (current()) { stop(); onError(error); }
    }
  }
  return {start, stop};
}
