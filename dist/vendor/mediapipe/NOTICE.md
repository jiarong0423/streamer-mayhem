# Third-party notice: MediaPipe Tasks Vision

These files are unmodified copies of Google's MediaPipe, used for in-browser face detection and body pose tracking. Licensed under the Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0). Copyright Google LLC.

| File | Source | SHA-256 |
|---|---|---|
| `vision_bundle.mjs` | npm `@mediapipe/tasks-vision@1.2.0` (`vision_bundle.mjs`) | `870da5cfc43bfcf2a8b0f14e8152dae8c7e701722e1191b0e592b94b81b4127a` |
| `wasm/vision_wasm_internal.js` | same package (`wasm/vision_wasm_internal.js`) | `85c1a342be70427987f900969a5f26e17557351111364e6585e97fb03e93e108` |
| `wasm/vision_wasm_internal.wasm` | same package (`wasm/vision_wasm_internal.wasm`) | `bcc13df22d3d69ec8cbe8e280989356d844ae00f4523eb82072d2484f44134dc` |
| `pose_landmarker_lite.task` | https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| `blaze_face_short_range.tflite` | https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite | `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f` |

The package tarball downloaded from the npm registry had SHA-256 `535175845f4ef8509b0240a0831abe8bcb3fa882accda6d080a4ede562a50a71`.

Everything runs locally in the browser tab. No camera frame is sent to any server.
