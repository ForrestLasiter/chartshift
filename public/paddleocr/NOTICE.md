# Word reader models

`PP-OCRv6_det_small.onnx`, `PP-OCRv6_rec_small.onnx` and `rec_keys.txt` (the reader's character list, taken from the recogniser model's metadata) are PaddleOCR's PP-OCRv6 small text detection and recognition models, as converted to ONNX and distributed by the RapidOCR project (rapidocr 3.10.0).

- PaddleOCR: https://github.com/PaddlePaddle/PaddleOCR, Copyright PaddlePaddle Authors, licensed under the Apache License, Version 2.0.
- RapidOCR: https://github.com/RapidAI/RapidOCR, licensed under the Apache License, Version 2.0.

A copy of the licence is at https://www.apache.org/licenses/LICENSE-2.0. The models are used unchanged. ChartShift runs them with ONNX Runtime (onnxruntime-web, MIT licence) to read the words printed under hymn music.
