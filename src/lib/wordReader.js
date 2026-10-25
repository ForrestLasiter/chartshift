// Loads the PaddleOCR word reader in the app: ONNX Runtime (WebAssembly,
// shipped in public/ort) and the models (public/paddleocr), all offline.
import * as ort from 'onnxruntime-web/wasm'; // the plain CPU build
import { createPaddleOcr } from './paddleocr.js';

let reader = null;

/** The word reader, loaded once (about 30 MB of models, a second or two). */
export function wordReader() {
  if (!reader) {
    reader = (async () => {
      ort.env.wasm.wasmPaths = new URL('./ort/', document.baseURI).href;
      // One thread: running more needs a cross-origin-isolated page.
      ort.env.wasm.numThreads = 1;
      const load = async (name) => {
        const response = await fetch(new URL(`./paddleocr/${name}`, document.baseURI));
        if (!response.ok) throw new Error(`The word reader's ${name} could not be loaded.`);
        return name.endsWith('.txt') ? response.text() : new Uint8Array(await response.arrayBuffer());
      };
      const [det, rec, keys] = await Promise.all([load('PP-OCRv6_det_small.onnx'), load('PP-OCRv6_rec_small.onnx'), load('rec_keys.txt')]);
      return createPaddleOcr({ ort, det, rec, keys });
    })().catch((error) => { reader = null; throw error; });
  }
  return reader;
}
