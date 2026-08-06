/** Resolve which icon file name to use for a model ID. */
export declare function resolveIconFile(modelId: string): string;
/** Get the base64 data URI for a model's icon. */
export declare function getModelIconDataUri(modelId: string): string;
/** Render an `<img>` tag for a model icon, or empty string if unavailable. */
export declare function modelIconImg(modelId: string, size?: number): string;
/** Build a JSON string mapping each model ID -> icon data URI, for use in
 *  client-side JS (e.g. ECharts rich-text background images). */
export declare function modelIconMap(modelIds: string[]): string;
