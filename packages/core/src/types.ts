/** Shared transcript types for the Second Seat workspace. */

export interface TranscriptSegment {
  id: string;
  speaker: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface Frame {
  id: string;
  segments: TranscriptSegment[];
}
