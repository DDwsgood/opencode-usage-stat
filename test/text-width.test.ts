import { test } from "node:test"
import assert from "node:assert/strict"
import { charWidth, visualWidth, truncateToWidth, centerAlign, padEndToWidth } from "../src/text-width.js"

test("visualWidth counts ASCII, CJK, fullwidth, CJK punctuation and emoji", () => {
  assert.equal(visualWidth("Weekly"), 6)
  assert.equal(visualWidth("分布"), 4)
  assert.equal(visualWidth("ｇｐｔ"), 6)          // FF00–FF60 fullwidth
  assert.equal(visualWidth("￥"), 2)              // FFE0–FFE6
  assert.equal(visualWidth("ｶ"), 1)              // halfwidth katakana stays narrow
  assert.equal(visualWidth("「」。"), 6)          // 3000–303F
  assert.equal(visualWidth("🚀✅"), 4)
  assert.equal(visualWidth("██░●▾▸◌◆▤…"), 10)     // ambiguous symbols stay 1
  assert.equal(visualWidth("e\u0301"), 1)         // combining mark
  assert.equal(visualWidth("❤\uFE0F"), 1 + 0)     // variation selector adds nothing
  assert.equal(charWidth(0x1F600), 2)
})

test("truncateToWidth respects cell width and adds ellipsis", () => {
  assert.equal(truncateToWidth("short", 10), "short")
  assert.equal(truncateToWidth("abcdefghij", 5), "abcd…")
  assert.equal(truncateToWidth("模型名称很长", 7), "模型名…")
  assert.equal(visualWidth(truncateToWidth("模型名称很长", 6)), 5)
  assert.equal(truncateToWidth("abc", 0), "")
  for (let w = 1; w < 20; w++) {
    assert.ok(visualWidth(truncateToWidth("deepseek/深度求索-🚀-model", w)) <= w)
  }
})

test("centerAlign never overflows its width", () => {
  assert.equal(centerAlign("ab", 6), "  ab  ")
  assert.equal(centerAlign("输入", 6), " 输入 ")
  assert.equal(visualWidth(centerAlign("TOTAL TOKENS", 5)), 5)
  assert.equal(visualWidth(centerAlign("会话累计总量", 5)), 5)
  assert.equal(centerAlign("x", 0), "")
})

test("padEndToWidth pads by cells", () => {
  assert.equal(padEndToWidth("分布:", 6), "分布: ")
  assert.equal(padEndToWidth("Cost:", 6), "Cost: ")
})
