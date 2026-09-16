import { en } from "@/locales/en";

export { en };

export function t(key: string): string {
  return en[key] || key;
}
