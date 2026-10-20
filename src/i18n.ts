export type Translator = (message: string, ...args: (string | number)[]) => string;

export const formatMessage: Translator = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (placeholder, index: string) => String(args[Number(index)] ?? placeholder));

let translate: Translator = formatMessage;
let language = 'en';

// The engine and HTML renderer also run outside VS Code in tests. The extension supplies
// VS Code's own bundle resolver at activation; English remains the standalone fallback.
export function configureLocalization(locale: string, translator: Translator): void {
  language = locale.toLowerCase() === 'zh-cn' ? 'zh-CN' : 'en';
  translate = translator;
}

export function t(message: string, ...args: (string | number)[]): string { return translate(message, ...args); }
export function languageTag(): string { return language; }
