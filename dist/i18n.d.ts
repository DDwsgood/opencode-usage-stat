export type SupportedLanguage = "zh" | "en";
export declare function detectLanguage(): SupportedLanguage;
export declare function setLanguage(lang: SupportedLanguage | "auto"): void;
export declare function getCurrentLanguage(): SupportedLanguage;
export declare function t(key: string): string;
