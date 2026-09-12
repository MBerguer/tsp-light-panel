import type { PostId } from "./ids";

export interface MarshalPresenceEntry {
  post: PostId;
  name: string;
  online: boolean;
  checked_in_at: string;
  last_seen: string;
}
