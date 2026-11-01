/**
 * Route id -> page component. The shell (LeanShell) frames every page except login, track
 * and evidence, which stand alone.
 */
import React from 'react';
import type { RouteId } from './routeConfig';
import { LoginPage } from '../pages/login/LoginPage';
import { LandingPage } from '../pages/landing/LandingPage';
import { MapPage } from '../pages/map/MapPage';
import { MyReportsPage, NotificationsPage } from '../pages/lean/CitizenPages';
import { ProfilePage } from '../pages/lean/ProfilePage';
import { SafetyPage } from '../pages/lean/SafetyPage';
import { EvidencePage } from '../pages/lean/EvidencePage';
import { UiCheckPage } from '../pages/roles/UiCheckPage';
import { CasePage, PublicTrackPage, StaffHomePage, TourPage, VerifyDocPage, VerifyPage, WhyPage } from '../pages/roles/RolePages';

export type PageComponent = React.ComponentType<{ params: Record<string, string> }>;

export const PAGE_COMPONENTS: Record<RouteId, PageComponent> = {
  landing: LandingPage,
  login: LoginPage,
  uiCheck: import.meta.env.DEV ? UiCheckPage : LandingPage,
  staffHome: StaffHomePage,
  workModule: StaffHomePage,
  workCase: CasePage,
  publicCase: PublicTrackPage,
  why: WhyPage,
  tour: TourPage,
  verify: VerifyPage,
  verifyDoc: VerifyDocPage,
  track: PublicTrackPage,
  evidence: EvidencePage,
  map: MapPage,
  myReports: MyReportsPage,
  notifications: NotificationsPage,
  safety: SafetyPage,
  // Staff work happens in the role workspaces; these older addresses open them.
  tasks: StaffHomePage,
  queue: StaffHomePage,
  analysis: StaffHomePage,
  analysisWorkspace: StaffHomePage,
  team: StaffHomePage,
  stats: StaffHomePage,
  roadDetail: MapPage,
  escalations: StaffHomePage,
  reportCard: StaffHomePage,
  profile: ProfilePage
};

/** Pages shown without the shell's bottom bar. */
export const STANDALONE_ROUTES: readonly RouteId[] = ['uiCheck', 'landing', 'login', 'track', 'evidence', 'staffHome', 'workModule', 'workCase', 'publicCase', 'why', 'tour', 'verify', 'verifyDoc'];
