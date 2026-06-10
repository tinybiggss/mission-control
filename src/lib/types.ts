export interface Draft {
  id: string;
  filePath: string;
  status: 'draft' | 'approved' | 'rejected' | 'scheduled' | 'published' | 'tracked';
  created: string;
  source_signal: string;
  source_signal_url: string;
  source_score: number;
  pillar: string;
  target_platforms: string[];
  headline_formula: string;
  content_type: 'text-draft' | 'visual-brief' | 'article-outline' | 'video-brief';
  visual_brief: string;
  video_brief: string;
  napkin_asset: string;
  gamma_asset: string;
  discord_thread_url: string;
  body: string;
}

export interface AdaptedVersion {
  id: string;
  draftId: string;
  platform: string;
  filePath: string;
  status: 'pending-approval' | 'approved' | 'rejected' | 'scheduled' | 'published' | 'publish-failed';
  scheduled_date: string;
  published_date: string;
  platform_post_id: string;
  publish_error: string;
  character_count: number;
  visual_required: boolean;
  visual_brief: string;
  subreddit: string;
  body: string;
}

export interface DraftGroup {
  draft: Draft;
  versions: AdaptedVersion[];
}

export interface FilterState {
  status: 'all' | 'pending-approval' | 'approved' | 'rejected';
  platform: 'all' | string;
  pillar: 'all' | string;
  scoreMin: number | null;
  scoreMax: number | null;
}

export type DraftStatus = Draft['status'];
export type AdaptedStatus = AdaptedVersion['status'];
