/**
 * Route id -> page component. The shell (LeanShell) frames every page except login, track
 * and evidence, which stand alone.
 */
import React from 'react';
import type { RouteId } from './routeConfig';
import { LoginPage } from '../pages/login/LoginPage';
import { LandingPage } from '../pages/landing/LandingPage';
import { TrackPage } from '../pages/track/TrackPage';
import { MapPage } from '../pages/map/MapPage';
import { MyReportsPage, NotificationsPage } from '../pages/lean/CitizenPages';
import { StatsPage, TeamPage } from '../pages/lean/CoordinatorPages';
import { EscalationsPage, ReportCardPage } from '../pages/lean/LeaderPages';
import { ProfilePage } from '../pages/lean/ProfilePage';
import { SafetyPage } from '../pages/lean/SafetyPage';
import { EvidencePage } from '../pages/lean/EvidencePage';
import { WorkOrdersPage } from '../pages/engineering/WorkOrdersPage';
import { PinnIndexPage } from '../pages/operations/PinnIndexPage';
import { PinnWorkspacePage } from '../pages/operations/PinnWorkspacePage';
import { RoadDetailPage } from '../pages/roads/RoadDetailPage';
import { CasePage, PublicTrackPage, RolesPage, TourPage, VerifyDocPage, VerifyPage, WhyPage } from '../pages/roles/RolePages';

export type PageComponent = React.ComponentType<{ params: Record<string, string> }>;

export const PAGE_COMPONENTS: Record<RouteId, PageComponent> = {
  landing: LandingPage,
  login: LoginPage,
  roles: RolesPage,
  workCase: CasePage,
  publicCase: PublicTrackPage,
  why: WhyPage,
  tour: TourPage,
  verify: VerifyPage,
  verifyDoc: VerifyDocPage,
  track: TrackPage,
  evidence: EvidencePage,
  map: MapPage,
  myReports: MyReportsPage,
  notifications: NotificationsPage,
  safety: SafetyPage,
  tasks: WorkOrdersPage,
  queue: WorkOrdersPage,
  analysis: PinnIndexPage,
  analysisWorkspace: PinnWorkspacePage,
  team: TeamPage,
  stats: StatsPage,
  roadDetail: RoadDetailPage,
  escalations: EscalationsPage,
  reportCard: ReportCardPage,
  profile: ProfilePage
};

/** Pages shown without the shell's bottom bar. */
export const STANDALONE_ROUTES: readonly RouteId[] = ['landing', 'login', 'track', 'evidence', 'roles', 'workCase', 'publicCase', 'why', 'tour', 'verify', 'verifyDoc'];
