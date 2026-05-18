export interface ApifyReelResult {
  id?: string;
  type?: string;
  shortCode?: string;
  caption?: string;
  hashtags?: string[];
  mentions?: string[];
  url?: string;
  inputUrl?: string;
  commentsCount?: number;
  likesCount?: number;
  videoViewCount?: number;
  videoPlayCount?: number;
  timestamp?: string;
  ownerFullName?: string;
  ownerUsername?: string;
  ownerId?: string;
  productType?: string;
  videoDuration?: number;
  displayUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  isCommentsDisabled?: boolean;
  error?: string;
  errorDescription?: string;
}

export type ScrapeRunScope = 'WEEKLY' | 'MANUAL' | 'FINAL' | 'PRELIM';
export type ScrapeRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
export type ScrapeResultStatus = 'OK' | 'NOT_FOUND' | 'PRIVATE' | 'PRE_CAMPAIGN' | 'ERROR';

export interface InstagramReelScraperInput {
  username: string[];
  resultsLimit?: number;
  onlyPostsNewerThan?: string;
  skipPinnedPosts?: boolean;
  includeSharesCount?: boolean;
  includeTranscript?: boolean;
  includeDownloadedVideo?: boolean;
}
