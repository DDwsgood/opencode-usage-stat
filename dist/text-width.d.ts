export declare function charWidth(code: number): number;
export declare function visualWidth(str: string): number;
/** Cut `str` to at most `width` cells, ending with `ellipsis` when cut. */
export declare function truncateToWidth(str: string, width: number, ellipsis?: string): string;
export declare function padEndToWidth(str: string, width: number): string;
/** Center within `width` cells; text wider than `width` is truncated so it never overflows. */
export declare function centerAlign(text: string, width: number): string;
