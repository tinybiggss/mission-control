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
  body: string;
}

export interface AdaptedVersion {
  id: string;
  draftId: string;
  platform: string;
  filePath: string;
  status: 'pending-approval' | 'approved' | 'rejected' | 'scheduled' | 'published';
  scheduled_date: string;
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
}

export type DraftStatus = Draft['status'];
export type AdaptedStatus = AdaptedVersion['status'];
