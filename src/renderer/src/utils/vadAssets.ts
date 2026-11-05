/**
 * Absolute URL of the VAD/ONNX assets (`public/vad`, copied next to index.html). A bare './vad/' would be resolved by
 * onnxruntime against the bundled script (`assets/`), which breaks the production build loaded from file://.
 */
export function vadAssetBaseUrl(pageUrl: string): string {
  return new URL('./vad/', pageUrl).href
}
