import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const EmojiRegex = "(\\p{Extended_Pictographic})";

export function containsEmojis(str: string) {
  const regex = RegExp(EmojiRegex, "u");
  return regex.test(str);
}

export function replaceEmojis (s: string, replacement: string) {
  const regex = RegExp(EmojiRegex, "gu");
  return s.replace(regex, replacement);
};
