import type { Lesson } from "../types";
import { sevenSegmentLesson } from "./seven-segment";

/**
 * Built-in demo lessons shipped with the framework (issue #54). A future lesson
 * gallery imports this catalog directly; the array order is the display order.
 */
export const seedLessons: Lesson[] = [sevenSegmentLesson];

export { sevenSegmentLesson };
