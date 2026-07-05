import type { Lesson } from "@openbench/lesson";
import { decodeJson, encodeJson, type ShareError } from "../share";

/**
 * Stateless lesson sharing (issue #92), per .context/design/teaching-mode.md §6.
 *
 * A {@link Lesson} serializes through the **same** #40 share codec as a bare
 * project bundle — gzip + URL-safe base64, no backend, one size budget
 * ({@link import("../share").SHARE_URL_LIMIT}). The `targetBundle` (and optional
 * `startBundle`) ride along inside the payload, so a `.openbench-lesson.json`
 * file and a compressed URL fragment are the same bytes. Over the cap ⇒ a
 * structured {@link ShareError} (never throws) and the caller falls back to a
 * file export, exactly like bundle sharing.
 */
export async function encodeLessonShare(lesson: Lesson): Promise<string | ShareError> {
  return encodeJson(lesson);
}

/** Inverse of {@link encodeLessonShare}: decode + decompress + parse a lesson. */
export async function decodeLessonShare(payload: string): Promise<Lesson> {
  return decodeJson<Lesson>(payload);
}
