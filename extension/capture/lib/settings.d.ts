export declare const PRODUCTION_ORIGIN: 'https://onbijjang-production.up.railway.app'
export declare const DEV_ORIGIN: 'http://localhost:5173'
export interface CaptureSettings {
  origin: string
  footer: boolean
  waitMode: 'normal' | 'slow'
}
export declare const DEFAULT_SETTINGS: Readonly<CaptureSettings>
export declare function cleanSaved(raw: unknown): Record<string, unknown>
export declare function loadSettings(): Promise<CaptureSettings>
export declare function saveSettings(patch: Partial<CaptureSettings> & { originSet?: boolean }): Promise<CaptureSettings>
export declare function saveOrigin(origin: string): Promise<CaptureSettings>
export declare function resetOrigin(): Promise<CaptureSettings>
export declare function waitTimes(waitMode: string): { settle: number; images: number }
