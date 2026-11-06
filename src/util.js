// Small DOM and formatting helpers. Text is always set with textContent (never innerHTML).

import { colorVar } from "./constants.js";

export const $ = (id) => document.getElementById(id);

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export const uid = () => Math.random().toString(36).slice(2, 10);

/** Small square/circle showing a color token; no color → neutral theme color. */
export function colorDot(token, className = "tdot") {
  const dot = el("span", className);
  dot.style.background = colorVar(token) ?? "var(--gutter)";
  return dot;
}

/** Animated "running" indicator shown on tabs with a command in progress. */
export function spinner() {
  const node = el("span", "spinner");
  node.title = "Running… (Ctrl+C to stop)";
  return node;
}

export function timeAgo(timestamp) {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
