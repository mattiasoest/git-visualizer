export interface ActorView {
  login: string;
  avatarUrl: string;
}

export interface RepoView {
  name: string;
}

export interface EventView {
  id: string;
  type: string;
  createdAt: string;
  actor: ActorView | null;
  repo: RepoView | null;
  summary: string;
  ref: string | null;
  action: string | null;
  prNumber: number | null;
  commitMessage: string | null;
}

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export const EVENT_TYPE_COLORS: Record<string, string> = {
  PushEvent: '#f85149',
  PullRequestEvent: '#a371f7',
  IssuesEvent: '#f0883e',
  IssueCommentEvent: '#f0883e',
  ForkEvent: '#58a6ff',
  WatchEvent: '#ffd33d',
  CreateEvent: '#3ddbd9',
  DeleteEvent: '#f85149',
  ReleaseEvent: '#79c0ff',
  CommitCommentEvent: '#8b949e',
  PullRequestReviewEvent: '#bc8cff',
  PullRequestReviewCommentEvent: '#bc8cff',
  MemberEvent: '#ffa657',
  PublicEvent: '#7ee787',
  GollumEvent: '#c9d1d9',
};

export function eventColor(type: string): string {
  return EVENT_TYPE_COLORS[type] ?? '#8b949e';
}

export const FILTERABLE_TYPES = [
  'PushEvent',
  'PullRequestEvent',
  'IssuesEvent',
  'ForkEvent',
  'WatchEvent',
  'CreateEvent',
  'ReleaseEvent',
] as const;
