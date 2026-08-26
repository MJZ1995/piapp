import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("renders temporary notices once at the top right of the chat column", () => {
  const noticeShelfUsages = source.match(/<NoticeShelf notices=\{notices\}/g) ?? [];

  assert.equal(noticeShelfUsages.length, 1);
  assert.match(
    source,
    /position: "absolute",\s*top: 12,\s*left: 0,\s*right: isMobile \? 0 : CHAT_MINIMAP_WIDTH,[\s\S]*?justifyContent: "flex-end",[\s\S]*?<NoticeShelf notices=\{notices\} floating[^>]*\/>/,
  );
});
